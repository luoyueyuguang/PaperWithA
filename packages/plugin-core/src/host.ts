import type { PluginManifest, SyncPlugin } from "@paperwitha/plugin-contracts";
import type { SyncPort } from "@paperwitha/sync";

export class PluginHost {
  private readonly plugins = new Map<string, SyncPlugin>();
  private activeSyncPluginId: string | null = null;

  install(plugin: SyncPlugin): void { this.plugins.set(plugin.manifest.pluginId, plugin); }
  uninstall(pluginId: string): Promise<void> | undefined {
    const plugin = this.plugins.get(pluginId);
    this.plugins.delete(pluginId);
    if (this.activeSyncPluginId === pluginId) this.activeSyncPluginId = null;
    return plugin?.stop();
  }
  manifests(): PluginManifest[] { return [...this.plugins.values()].map((plugin) => plugin.manifest); }
  async activateSync(pluginId: string, port: SyncPort): Promise<void> {
    if (this.activeSyncPluginId && this.activeSyncPluginId !== pluginId) throw new Error("only one sync plugin may be active for a workspace");
    const plugin = this.plugins.get(pluginId);
    if (!plugin) throw new Error(`plugin not installed: ${pluginId}`);
    await plugin.start(port);
    this.activeSyncPluginId = pluginId;
  }
  async pauseSync(): Promise<void> {
    if (!this.activeSyncPluginId) return;
    await this.plugins.get(this.activeSyncPluginId)?.pause();
    this.activeSyncPluginId = null;
  }
  get activeSyncTarget(): string | null { return this.activeSyncPluginId; }
}
