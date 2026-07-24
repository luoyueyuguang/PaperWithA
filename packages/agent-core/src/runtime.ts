export interface RuntimeAgentDescriptor {
  agentId: string;
  name: string;
  description: string;
  runtimeProfileId: string;
  models: string[];
  capabilities: string[];
}

export interface RuntimeSessionCreateInput {
  sessionId: string;
  title: string;
  agentId: string;
  model: string | null;
  cwd: string | null;
}

export interface RuntimePromptInput {
  message: string;
  contextText: string;
  model: string | null;
}

export type RuntimeEvent =
  | { kind: "session-created"; runtimeSessionId: string }
  | { kind: "text-delta"; text: string }
  | { kind: "message"; text: string }
  | { kind: "tool-started"; toolCallId: string; toolName: string; input: unknown }
  | { kind: "tool-progress"; toolCallId: string; update: unknown }
  | { kind: "tool-completed"; toolCallId: string; output: unknown; isError: boolean }
  | { kind: "approval-required"; approvalId: string; title: string; details: unknown }
  | { kind: "artifact-created"; artifactPath: string; mediaType: string | null }
  | { kind: "completed" }
  | { kind: "failed"; message: string };

export type RuntimeEventListener = (event: RuntimeEvent) => void;

export interface AgentRuntimeSessionPort {
  readonly sessionId: string;
  readonly runtimeSessionId: string;
  readonly runtimeProfileId: string;
  readonly agentId: string;
  prompt(input: RuntimePromptInput, listener: RuntimeEventListener, signal: AbortSignal): Promise<void>;
  steer(message: string): Promise<void>;
  followUp(message: string): Promise<void>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}

export interface AgentRuntimeAdapter {
  readonly runtimeProfileId: string;
  readonly displayName: string;
  discoverAgents(signal: AbortSignal): Promise<RuntimeAgentDescriptor[]>;
  createSession(input: RuntimeSessionCreateInput, signal: AbortSignal): Promise<AgentRuntimeSessionPort>;
}

export interface RuntimeRegistryEntry {
  runtimeProfileId: string;
  displayName: string;
  adapterKind: "omp-rpc" | "pi-rpc" | "opencode-http";
  available: boolean;
  error: string | null;
}
