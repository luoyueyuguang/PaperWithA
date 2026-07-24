import type {
  AgentRuntimeAdapter,
  AgentRuntimeSessionPort,
  RuntimeAgentDescriptor,
  RuntimeEventListener,
  RuntimePromptInput,
  RuntimeSessionCreateInput,
} from "@paperwitha/agent-core";
import { JsonlRpcProcess } from "./rpc-process.js";

const DEFAULT_OMP_COMMAND = "omp";

export function createOmpRpcAdapter(options: { command?: string; cwd?: string } = {}): AgentRuntimeAdapter {
  const command = options.command ?? DEFAULT_OMP_COMMAND;
  return {
    runtimeProfileId: "omp-rpc",
    displayName: "OMP (RPC)",

    async discoverAgents(signal: AbortSignal): Promise<RuntimeAgentDescriptor[]> {
      if (signal.aborted) throw new Error("aborted");
      try {
        const process = await JsonlRpcProcess.spawn({
          command,
          args: ["--mode", "rpc"],
          readyEvent: "ready",
          readyTimeoutMs: 15000,
        });
        const response = await process.request({ type: "get_available_agents" });
        await process.request({ type: "session_dispose" });
        process.dispose().catch(() => {});
        const agents = (response.data as Record<string, unknown>)?.agents as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(agents)) {
          return agents.map((agent) => ({
            agentId: String(agent.id ?? agent.name ?? ""),
            name: String(agent.name ?? agent.id ?? ""),
            description: String(agent.description ?? ""),
            runtimeProfileId: "omp-rpc",
            models: Array.isArray(agent.models) ? agent.models.map(String) : [],
            capabilities: Array.isArray(agent.capabilities) ? agent.capabilities.map(String) : [],
          }));
        }
        return [];
      } catch (error) {
        return [
          {
            agentId: "task",
            name: "Task Agent",
            description: "General-purpose OMP coding agent",
            runtimeProfileId: "omp-rpc",
            models: [],
            capabilities: ["read", "edit", "bash", "search"],
          },
        ];
      }
    },

    async createSession(input: RuntimeSessionCreateInput, signal: AbortSignal): Promise<AgentRuntimeSessionPort> {
      if (signal.aborted) throw new Error("aborted");
      const process = await JsonlRpcProcess.spawn({
        command,
        args: ["--mode", "rpc"],
        readyEvent: "ready",
        readyTimeoutMs: 15000,
      });

      await process.request({ type: "new_session" });

      if (input.model) {
        const [provider, modelId] = input.model.includes("/") ? input.model.split("/", 2) : ["openai", input.model];
        await process.request({ type: "set_model", provider: provider!, modelId: modelId ?? provider! });
      }

      return createOmpSession(process, input.sessionId, input.agentId);
    },
  };
}

function createOmpSession(process: JsonlRpcProcess, sessionId: string, agentId: string): AgentRuntimeSessionPort {
  let runCount = 0;
  let activeAbort: AbortController | null = null;

  return {
    sessionId,
    runtimeSessionId: `omp:${process.pid}`,
    runtimeProfileId: "omp-rpc",
    agentId,

    async prompt(input: RuntimePromptInput, listener: RuntimeEventListener, signal: AbortSignal): Promise<void> {
      const message = input.contextText
        ? `${input.contextText}\n\n---\n\n${input.message}`
        : input.message;

      const unsubscribe = process.subscribe((event) => {
        if (event.type === "message_update") {
          const deltaEvent = (event as Record<string, unknown>).assistantMessageEvent as Record<string, unknown> | undefined;
          if (deltaEvent?.type === "text_delta" && typeof deltaEvent.delta === "string") {
            listener({ kind: "text-delta", text: deltaEvent.delta });
          }
        } else if (event.type === "tool_execution_start") {
          listener({
            kind: "tool-started",
            toolCallId: String(event.toolCallId ?? ""),
            toolName: String(event.toolName ?? ""),
            input: (event as Record<string, unknown>).input ?? {},
          });
        } else if (event.type === "tool_execution_end") {
          listener({
            kind: "tool-completed",
            toolCallId: String(event.toolCallId ?? ""),
            output: (event as Record<string, unknown>).result ?? null,
            isError: Boolean((event as Record<string, unknown>).isError),
          });
        } else if (event.type === "agent_end") {
          listener({ kind: "completed" });
        } else if (event.type === "error") {
          listener({ kind: "failed", message: String((event as Record<string, unknown>).error ?? "unknown OMP error") });
        }
      });

      const abortHandler = () => { process.request({ type: "abort" }).catch(() => {}); };
      signal.addEventListener("abort", abortHandler, { once: true });

      try {
        const response = await process.request({
          type: "prompt",
          message: `I'm working with a shared context. Use the provided context and respond to: ${message}`,
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
      await process.request({ type: "steer", message });
    },

    async followUp(message: string): Promise<void> {
      await process.request({ type: "follow_up", message });
    },

    async cancel(): Promise<void> {
      await process.request({ type: "abort" });
    },

    async dispose(): Promise<void> {
      await process.dispose();
    },
  };
}
