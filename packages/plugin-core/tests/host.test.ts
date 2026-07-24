import { describe, expect, it } from "vitest";
import { PluginHost } from "../src/host.js";
import type { SyncPlugin } from "@paperwitha/plugin-contracts";
import { InMemorySyncServer } from "@paperwitha/sync";

function plugin(id: string): SyncPlugin {
  return { manifest: { pluginId: id, version: "1", capabilities: ["sync"] }, start: async () => undefined, pause: async () => undefined, stop: async () => undefined };
}

describe("PluginHost", () => {
  it("allows only one active sync target", async () => {
    const host = new PluginHost();
    host.install(plugin("one"));
    host.install(plugin("two"));
    await host.activateSync("one", new InMemorySyncServer());
    await expect(host.activateSync("two", new InMemorySyncServer())).rejects.toThrow("only one sync plugin");
    await host.pauseSync();
    await host.activateSync("two", new InMemorySyncServer());
    expect(host.activeSyncTarget).toBe("two");
  });
});
