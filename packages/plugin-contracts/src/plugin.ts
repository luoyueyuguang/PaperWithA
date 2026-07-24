import type { SyncPort } from "@paperwitha/sync";

export interface PluginManifest {
  pluginId: string;
  version: string;
  capabilities: string[];
}

export interface SyncPlugin {
  manifest: PluginManifest;
  start(port: SyncPort): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
}
