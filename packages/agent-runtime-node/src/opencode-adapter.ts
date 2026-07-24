import type {
  AgentRuntimeAdapter,
  AgentRuntimeSessionPort,
  RuntimeAgentDescriptor,
  RuntimeEventListener,
  RuntimePromptInput,
  RuntimeSessionCreateInput,
} from "@paperwitha/agent-core";

const DEFAULT_OPENCODE_URL = "http://127.0.0.1:4096";

export function createOpenCodeHttpAdapter(options: { baseUrl?: string; fetchImpl?: typeof fetch } = {}): AgentRuntimeAdapter {
  const baseUrl = (options.baseUrl ?? DEFAULT_OPENCODE_URL).replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  return {
    runtimeProfileId: "opencode-http",
    displayName: "OpenCode (HTTP)",

    async discoverAgents(signal: AbortSignal): Promise<RuntimeAgentDescriptor[]> {
      try {
        const response = await fetchImpl(`${baseUrl}/agent`, { signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const agents = await response.json() as Array<Record<string, unknown>>;
        if (Array.isArray(agents)) {
          return agents.map((agent) => ({
            agentId: String(agent.name ?? agent.id ?? ""),
            name: String(agent.name ?? agent.id ?? ""),
            description: String(agent.description ?? ""),
            runtimeProfileId: "opencode-http",
            models: [],
            capabilities: [],
          }));
        }
        return [];
      } catch {
        return [
          {
            agentId: "task",
            name: "Task Agent",
            description: "General-purpose OpenCode agent",
            runtimeProfileId: "opencode-http",
            models: [],
            capabilities: ["read", "edit", "bash", "glob", "grep", "task"],
          },
        ];
      }
    },

    async createSession(input: RuntimeSessionCreateInput, signal: AbortSignal): Promise<AgentRuntimeSessionPort> {
      const createResponse = await fetchImpl(`${baseUrl}/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: input.title }),
        signal,
      });
      if (!createResponse.ok) throw new Error(`create session failed: HTTP ${createResponse.status}`);
      const session = await createResponse.json() as { id: string };
      const runtimeSessionId = session.id;

      return {
        sessionId: input.sessionId,
        runtimeSessionId,
        runtimeProfileId: "opencode-http",
        agentId: input.agentId,

        async prompt(promptInput: RuntimePromptInput, listener: RuntimeEventListener, promptSignal: AbortSignal): Promise<void> {
          const message = promptInput.contextText
            ? `Context from PaperWithA workspace:\n\n${promptInput.contextText}\n\n---\n\nUser request: ${promptInput.message}`
            : promptInput.message;

          const response = await fetchImpl(`${baseUrl}/session/${runtimeSessionId}/message`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              parts: [{ type: "text", text: message }],
              agent: input.agentId,
              model: promptInput.model ?? undefined,
            }),
            signal: promptSignal,
          });

          if (!response.ok) {
            const text = await response.text().catch(() => "");
            listener({ kind: "failed", message: `HTTP ${response.status}: ${text}` });
            return;
          }

          const data = await response.json() as {
            info?: { id: string };
            parts?: Array<{ type: string; text?: string; tool_call?: { id: string; name: string; arguments: unknown }; tool_result?: { is_error?: boolean; content?: unknown } }>;
          };

          if (data.parts) {
            for (const part of data.parts) {
              if (part.type === "text" && part.text) {
                listener({ kind: "text-delta", text: part.text });
              } else if (part.type === "tool_call") {
                listener({
                  kind: "tool-started",
                  toolCallId: part.tool_call?.id ?? "",
                  toolName: part.tool_call?.name ?? "",
                  input: part.tool_call?.arguments ?? {},
                });
              } else if (part.type === "tool_result") {
                listener({
                  kind: "tool-completed",
                  toolCallId: "",
                  output: part.tool_result?.content ?? null,
                  isError: Boolean(part.tool_result?.is_error),
                });
              }
            }
          }

          listener({ kind: "completed" });
        },

        async steer(message: string): Promise<void> {
          await fetchImpl(`${baseUrl}/session/${runtimeSessionId}/message`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ parts: [{ type: "text", text: `Steering: ${message}` }], agent: input.agentId, system: "This is a steering instruction. Adjust your approach immediately." }),
          });
        },

        async followUp(message: string): Promise<void> {
          await fetchImpl(`${baseUrl}/session/${runtimeSessionId}/message`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ parts: [{ type: "text", text: `Follow-up: ${message}` }], agent: input.agentId }),
          });
        },

        async cancel(): Promise<void> {
          await fetchImpl(`${baseUrl}/session/${runtimeSessionId}/abort`, { method: "POST" }).catch(() => {});
        },

        async dispose(): Promise<void> {
          await fetchImpl(`${baseUrl}/session/${runtimeSessionId}`, { method: "DELETE" }).catch(() => {});
        },
      };
    },
  };
}
