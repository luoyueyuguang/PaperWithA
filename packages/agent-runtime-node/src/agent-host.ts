import type {
  AgentRuntimeAdapter,
  AgentRuntimeSessionPort,
  RuntimeAgentDescriptor,
  RuntimeRegistryEntry,
} from "@paperwitha/agent-core";
import type { PluginLifecycle, PluginManifest } from "@paperwitha/plugin-contracts";

export interface AgentHostOptions {
  adapters: AgentRuntimeAdapter[];
}

export class AgentHost implements PluginLifecycle {
  readonly manifest: PluginManifest;
  private adapters = new Map<string, AgentRuntimeAdapter>();
  private registryEntries = new Map<string, RuntimeRegistryEntry>();

  constructor(options: AgentHostOptions) {
    this.manifest = {
      pluginId: "paperwitha-agent-host",
      version: "1.0.0",
      apiVersion: "paperwitha.plugin.v1",
      pluginType: "agent-runtime",
      capabilities: ["agent-runtime"],
    };
    for (const adapter of options.adapters) {
      this.register(adapter);
    }
  }

  register(adapter: AgentRuntimeAdapter): void {
    if (this.adapters.has(adapter.runtimeProfileId)) {
      throw new Error(`runtime already registered: ${adapter.runtimeProfileId}`);
    }
    this.adapters.set(adapter.runtimeProfileId, adapter);
    this.registryEntries.set(adapter.runtimeProfileId, {
      runtimeProfileId: adapter.runtimeProfileId,
      displayName: adapter.displayName,
      adapterKind: adapter.displayName.includes("OMP") ? "omp-rpc" : adapter.displayName.includes("Pi") ? "pi-rpc" : "opencode-http",
      available: true,
      error: null,
    });
  }

  get adaptersList(): AgentRuntimeAdapter[] {
    return [...this.adapters.values()];
  }

  adapter(runtimeProfileId: string): AgentRuntimeAdapter | undefined {
    return this.adapters.get(runtimeProfileId);
  }

  async refreshRegistry(signal: AbortSignal): Promise<RuntimeRegistryEntry[]> {
    const entries: RuntimeRegistryEntry[] = [];
    for (const [id, adapter] of this.adapters) {
      try {
        const agents = await adapter.discoverAgents(signal);
        const entry = this.registryEntries.get(id);
        entries.push({
          ...entry!,
          available: true,
          error: null,
        });
      } catch (error) {
        const entry = this.registryEntries.get(id);
        entries.push({
          ...entry!,
          available: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return entries;
  }

  async discoverAllAgents(signal: AbortSignal): Promise<RuntimeAgentDescriptor[]> {
    const results: RuntimeAgentDescriptor[] = [];
    for (const adapter of this.adapters.values()) {
      try {
        const agents = await adapter.discoverAgents(signal);
        results.push(...agents);
      } catch { /* skip unavailable runtimes */ }
    }
    return results;
  }

  async createSession(
    input: { sessionId: string; title: string; runtimeProfileId: string; agentId: string; model: string | null; cwd?: string },
    signal: AbortSignal,
  ): Promise<AgentRuntimeSessionPort> {
    const adapter = this.adapters.get(input.runtimeProfileId);
    if (!adapter) throw new Error(`runtime not registered: ${input.runtimeProfileId}`);
    return adapter.createSession(
      { sessionId: input.sessionId, title: input.title, agentId: input.agentId, model: input.model, cwd: input.cwd ?? null },
      signal,
    );
  }

  async start(): Promise<void> {
    // Initialize all registered adapters
  }

  async pause(): Promise<void> {
    // Pause all active sessions
  }

  async stop(): Promise<void> {
    await this.dispose();
  }

  async dispose(): Promise<void> {
    this.adapters.clear();
    this.registryEntries.clear();
  }
}
