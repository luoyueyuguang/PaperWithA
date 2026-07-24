import { describe, expect, it } from "vitest";
import type { DocumentGraph } from "@paperwitha/domain";
import { DocumentGraphCache, visiblePageNumbers } from "../src/graph.js";

function graph(documentVersionId: string): DocumentGraph {
  return {
    graphId: "graph-1",
    documentId: "doc-1",
    documentVersionId,
    pages: [{ pageId: "p1", pageNumber: 1, text: "page" }],
      blobHash: null,
  };
}

describe("DocumentGraphCache", () => {
  it("shares one in-flight graph load for multiple PaperViews", async () => {
    const cache = new DocumentGraphCache();
    let loads = 0;
    const loader = async (versionId: string) => {
      loads += 1;
      await Promise.resolve();
      return graph(versionId);
    };

    const [first, second] = await Promise.all([
      cache.getOrCreate("version-1", loader),
      cache.getOrCreate("version-1", loader),
    ]);

    expect(first).toBe(second);
    expect(loads).toBe(1);
    expect(cache.size).toBe(1);
  });

  it("drops failed loads so a later retry can recover", async () => {
    const cache = new DocumentGraphCache();
    let attempts = 0;
    const loader = async (versionId: string) => {
      attempts += 1;
      if (attempts === 1) throw new Error("parse failed");
      return graph(versionId);
    };

    await expect(cache.getOrCreate("version-1", loader)).rejects.toThrow("parse failed");
    await expect(cache.getOrCreate("version-1", loader)).resolves.toMatchObject({
      documentVersionId: "version-1",
    });
    expect(attempts).toBe(2);
  });
});

describe("visiblePageNumbers", () => {
  it("keeps only the viewport and buffer pages", () => {
    expect(visiblePageNumbers(20, 10, 2)).toEqual([8, 9, 10, 11, 12]);
    expect(visiblePageNumbers(3, 1, 2)).toEqual([1, 2, 3]);
  });
});
