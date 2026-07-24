export type PluginType =
  | "agent-runtime"
  | "ai-provider"
  | "importer"
  | "exporter"
  | "reader-adapter"
  | "analysis"
  | "reading-brief";

export interface PluginManifest {
  pluginId: string;
  version: string;
  apiVersion: string;
  pluginType: PluginType;
  capabilities: string[];
}

export interface PluginLifecycle {
  manifest: PluginManifest;
  start(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
}
