import { describe, expect, it, vi } from "vitest";
import type { PluginLifecycle, PluginType } from "@paperwitha/plugin-contracts";
import { PluginHost } from "../src/host.js";

function plugin(id: string, pluginType: PluginType = "agent-runtime"): PluginLifecycle & { start: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> } {
  return {
    manifest: { pluginId: id, version: "1", apiVersion: "paperwitha.plugin.v1", pluginType, capabilities: [pluginType] },
    start: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  };
}

describe("PluginHost", () => {
  it("activates multiple local agent runtimes independently", async () => {
    const host = new PluginHost();
    const omp = plugin("omp");
    const opencode = plugin("opencode");
    host.install(omp);
    host.install(opencode);

    await host.activate("omp");
    await host.activate("opencode");

    expect(host.activePlugins).toEqual(["omp", "opencode"]);
    expect(omp.start).toHaveBeenCalledOnce();
    expect(opencode.start).toHaveBeenCalledOnce();

    await host.pause("omp");
    expect(host.isActive("omp")).toBe(false);
    expect(host.isActive("opencode")).toBe(true);
  });

  it("stops an active plugin before uninstalling it", async () => {
    const host = new PluginHost();
    const runtime = plugin("pi");
    host.install(runtime);
    await host.activate("pi");
    await host.uninstall("pi");

    expect(runtime.stop).toHaveBeenCalledOnce();
    expect(host.activePlugins).toEqual([]);
    expect(host.manifests()).toEqual([]);
  });

  it("rejects duplicate plugin identities", () => {
    const host = new PluginHost();
    host.install(plugin("omp"));
    expect(() => host.install(plugin("omp"))).toThrow("already installed");
  });
});
