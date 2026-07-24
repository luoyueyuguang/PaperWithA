import { describe, expect, it } from "vitest";
import { LayoutHistory, type LayoutTree } from "../src/layout.js";

describe("LayoutHistory", () => {
  it("applies split and restores the serialized tree with undo/redo", () => {
    const initial: LayoutTree = {
      root: { kind: "stack", stackId: "stack-1", panelIds: ["paper", "chat"] },
      panels: {
        paper: { panelId: "paper", contentRef: "paper-view" },
        chat: { panelId: "chat", contentRef: "chat-session" },
      },
    };
    const history = new LayoutHistory(initial);
    const split = history.execute({
      kind: "splitPane",
      panelId: "chat",
      orientation: "vertical",
      splitId: "split-1",
      stackId: "stack-1",
    });

    expect(JSON.stringify(history.undo())).toBe(JSON.stringify(initial));
    expect(JSON.stringify(history.redo())).toBe(JSON.stringify(split));
  });
});
