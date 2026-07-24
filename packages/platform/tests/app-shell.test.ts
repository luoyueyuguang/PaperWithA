import { describe, expect, it } from "vitest";
import { createPlatformShell } from "../src/app-shell.js";

const layout = { root: { kind: "stack" as const, stackId: "main", panelIds: [] }, panels: {} };
const initial = { workspaceId: "workspace-1", papers: [], layout, activePaperId: null };

describe("PlatformShell", () => {
  it("shares immutable workspace state and subscriptions", () => {
    const shell = createPlatformShell({ kind: "mobile", nativeWindows: false, persistentStorage: "sqlite", touchInput: true, fileImport: true }, initial);
    let notifications = 0;
    const unsubscribe = shell.subscribe(() => { notifications += 1; });
    shell.setLayout({ ...layout, root: { ...layout.root, panelIds: ["paper"] } });
    expect(notifications).toBe(1);
    expect(shell.getState().layout.root.kind).toBe("stack");
    unsubscribe();
  });
});
