import { describe, expect, it } from "vitest";
import { createPaperViewState, updatePaperView } from "../src/paper-view.js";

describe("PaperViewState", () => {
  it("keeps view-local reading state independent", () => {
    const first = createPaperViewState("view-1", "doc-1", "version-1");
    const second = createPaperViewState("view-2", "doc-1", "version-1");
    const moved = updatePaperView(first, {
      scrollAnchor: { pageNumber: 8, relativeOffset: 0.25 },
      zoom: 1.2,
    });

    expect(moved.scrollAnchor.pageNumber).toBe(8);
    expect(moved.zoom).toBe(1.2);
    expect(second.scrollAnchor.pageNumber).toBe(1);
    expect(second.zoom).toBe(1);
  });
});
