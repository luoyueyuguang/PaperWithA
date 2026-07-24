import { describe, expect, it } from "vitest";
import type { DocumentGraph } from "@paperwitha/domain";
import { createCrossPageAnchor } from "../src/selection.js";

describe("createCrossPageAnchor", () => {
  it("creates a valid anchor spanning two pages", () => {
    const graph: DocumentGraph = {
      graphId: "graph-1",
      documentId: "doc-1",
      documentVersionId: "version-1",
      pages: [
        { pageId: "page-1", pageNumber: 1, text: "first page" },
        { pageId: "page-2", pageNumber: 2, text: "second page" },
      ],
      blobHash: null,
    }; 

    const anchor = createCrossPageAnchor(graph, {
      documentVersionId: "version-1",
      startPage: 1,
      endPage: 2,
      startOffset: 0,
      endOffset: 11,
    });
    expect(anchor).toMatchObject({
      documentId: "doc-1",
      pageId: "page-1",
      endPageId: "page-2",
      nodeId: "page-1:text",
      range: { start: 0, end: 10 },
      endRange: { start: 0, end: 11 },
      documentVersionId: "version-1",
      validity: "valid",
      confidence: 1,
    });
  });

  it("rejects a selection from another document version", () => {
    const graph: DocumentGraph = {
      graphId: "graph-1",
      documentId: "doc-1",
      documentVersionId: "version-1",
      pages: [{ pageId: "page-1", pageNumber: 1, text: "first page" }],
      blobHash: null,
    };

    expect(() => createCrossPageAnchor(graph, {
      documentVersionId: "version-2",
      startPage: 1,
      endPage: 1,
      startOffset: 0,
      endOffset: 5,
    })).toThrow("different document version");
  });
});
