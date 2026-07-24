import type { PluginLifecycle, PluginManifest } from "@paperwitha/plugin-contracts";

export class PluginHost {
  private readonly plugins = new Map<string, PluginLifecycle>();
  private readonly activePluginIds = new Set<string>();

  install(plugin: PluginLifecycle): void {
    if (this.plugins.has(plugin.manifest.pluginId)) throw new Error(`plugin already installed: ${plugin.manifest.pluginId}`);
    this.plugins.set(plugin.manifest.pluginId, plugin);
  }

  async uninstall(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;
    await plugin.stop();
    this.activePluginIds.delete(pluginId);
    this.plugins.delete(pluginId);
  }

  manifests(): PluginManifest[] {
    return [...this.plugins.values()].map((plugin) => plugin.manifest);
  }

  async activate(pluginId: string): Promise<void> {
    if (this.activePluginIds.has(pluginId)) return;
    const plugin = this.plugins.get(pluginId);
    if (!plugin) throw new Error(`plugin not installed: ${pluginId}`);
    await plugin.start();
    this.activePluginIds.add(pluginId);
  }

  async pause(pluginId: string): Promise<void> {
    if (!this.activePluginIds.has(pluginId)) return;
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;
    await plugin.pause();
    this.activePluginIds.delete(pluginId);
  }

  isActive(pluginId: string): boolean {
    return this.activePluginIds.has(pluginId);
  }

  get activePlugins(): string[] {
    return [...this.activePluginIds];
  }
}
