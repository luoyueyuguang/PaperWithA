import { execSync } from "node:child_process";
import type {
  AgentRuntimeAdapter,
  AgentRuntimeSessionPort,
  RuntimeAgentDescriptor,
  RuntimeEventListener,
  RuntimePromptInput,
  RuntimeSessionCreateInput,
} from "@paperwitha/agent-core";
import { JsonlRpcProcess } from "./rpc-process.js";

const DEFAULT_PI_COMMAND = "pi";

function resolveCwd(): string {
  try {
    return execSync("pwd", { encoding: "utf8" }).trim();
  } catch {
    return process.cwd();
  }
}

export function createPiRpcAdapter(options: { command?: string; cwd?: string } = {}): AgentRuntimeAdapter {
  const command = options.command ?? DEFAULT_PI_COMMAND;
  return {
    runtimeProfileId: "pi-rpc",
    displayName: "Pi (RPC)",

    async discoverAgents(signal: AbortSignal): Promise<RuntimeAgentDescriptor[]> {
      if (signal.aborted) throw new Error("aborted");
      try {
        const rpcProcess = await JsonlRpcProcess.spawn({
          command,
          args: ["--mode", "rpc"],
          readyEvent: "ready",
          readyTimeoutMs: 15000,
        });
        const response = await rpcProcess.request({ type: "get_available_models" });
        await rpcProcess.request({ type: "session_dispose" });
        rpcProcess.dispose().catch(() => {});
        const models = (response.data as Record<string, unknown>)?.models as Array<Record<string, unknown>> | undefined;
        const modelLabels = Array.isArray(models) ? models.map((m) => String(m.id ?? m.name ?? "")) : [];
        return [
          {
            agentId: "pi-coding-agent",
            name: "Pi Coding Agent",
            description: "Interactive coding agent with tool calling and state management",
            runtimeProfileId: "pi-rpc",
            models: modelLabels,
            capabilities: ["read", "edit", "write", "bash", "grep", "glob", "task"],
          },
        ];
      } catch {
        return [
          {
            agentId: "pi-coding-agent",
            name: "Pi Coding Agent",
            description: "Interactive coding agent (offline discovery)",
            runtimeProfileId: "pi-rpc",
            models: [],
            capabilities: ["read", "edit", "write", "bash", "grep", "glob", "task"],
          },
        ];
      }
    },

    async createSession(input: RuntimeSessionCreateInput, signal: AbortSignal): Promise<AgentRuntimeSessionPort> {
      if (signal.aborted) throw new Error("aborted");
      const cwd = input.cwd ?? resolveCwd();
      const rpcProcess = await JsonlRpcProcess.spawn({
        command,
        args: ["--mode", "rpc"],
        cwd,
        readyEvent: "ready",
        readyTimeoutMs: 15000,
      });

      if (input.model) {
        const [provider, modelId] = input.model.includes("/") ? input.model.split("/", 2) : [undefined, input.model];
        if (provider && modelId) {
          await rpcProcess.request({ type: "set_model", provider, modelId }).catch(() => {});
        } else if (modelId) {
          await rpcProcess.request({ type: "set_model", provider: "openai", modelId }).catch(() => {});
        }
      }

      return createPiSession(rpcProcess, input.sessionId, input.agentId);
    },
  };
}

function createPiSession(rpcProcess: JsonlRpcProcess, sessionId: string, agentId: string): AgentRuntimeSessionPort {
  return {
    sessionId,
    runtimeSessionId: `pi:${rpcProcess.pid}`,
    runtimeProfileId: "pi-rpc",
    agentId,

    async prompt(input: RuntimePromptInput, listener: RuntimeEventListener, signal: AbortSignal): Promise<void> {
      const message = input.contextText
        ? `Context provided by PaperWithA:\n\n${input.contextText}\n\n---\n\nUser request: ${input.message}`
        : input.message;

      const unsubscribe = rpcProcess.subscribe((event) => {
        switch (event.type) {
          case "message_update": {
            const deltaEvent = (event as Record<string, unknown>).assistantMessageEvent as Record<string, unknown> | undefined;
            if (deltaEvent?.type === "text_delta" && typeof deltaEvent.delta === "string") {
              listener({ kind: "text-delta", text: deltaEvent.delta });
            }
            break;
          }
          case "tool_execution_start":
            listener({
              kind: "tool-started",
              toolCallId: String(event.toolCallId ?? ""),
              toolName: String(event.toolName ?? ""),
              input: (event as Record<string, unknown>).input ?? {},
            });
            break;
          case "tool_execution_end":
            listener({
              kind: "tool-completed",
              toolCallId: String(event.toolCallId ?? ""),
              output: (event as Record<string, unknown>).result ?? null,
              isError: Boolean((event as Record<string, unknown>).isError),
            });
            break;
          case "agent_end":
            listener({ kind: "completed" });
            break;
          case "compaction_start":
          case "compaction_end":
            break;
          default:
            if (event.type === "error" || (event as Record<string, unknown>).error) {
              listener({
                kind: "failed",
                message: String((event as Record<string, unknown>).error ?? "unknown Pi error"),
              });
            }
        }
      });

      const abortHandler = () => { rpcProcess.request({ type: "abort" }).catch(() => {}); };
      signal.addEventListener("abort", abortHandler, { once: true });

      try {
        const response = await rpcProcess.request({
          type: "prompt",
          message,
        });
        if (!response.success) {
          listener({ kind: "failed", message: String(response.error ?? "prompt rejected") });
        }
      } catch (error) {
        if (!signal.aborted) {
          listener({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
        }
      } finally {
        signal.removeEventListener("abort", abortHandler);
        unsubscribe();
      }
    },

    async steer(message: string): Promise<void> {
      await rpcProcess.request({ type: "steer", message });
    },

    async followUp(message: string): Promise<void> {
      await rpcProcess.request({ type: "follow_up", message });
    },

    async cancel(): Promise<void> {
      await rpcProcess.request({ type: "abort" });
    },

    async dispose(): Promise<void> {
      await rpcProcess.dispose();
    },
  };
}
