import { describe, expect, it } from "vitest";
import { createAnnotation } from "../src/annotations.js";

const anchor = {
  anchorId: "doc-v1:1:0-1:5",
  documentId: "doc",
  documentVersionId: "doc-v1",
  pageId: "page-1",
  nodeId: "page-1:text",
  range: { start: 0, end: 5 },
  endPageId: "page-1",
  endNodeId: "page-1:text",
  endRange: { start: 0, end: 5 },
  validity: "valid" as const,
  confidence: 1,
};

describe("Annotation", () => {
  it("keeps a valid evidence anchor and user note", () => {
    const annotation = createAnnotation("annotation-1", anchor, "hello", "important", "note", "2026-01-01T00:00:00.000Z");
    expect(annotation.anchor.anchorId).toBe(anchor.anchorId);
    expect(annotation.note).toBe("important");
    expect(annotation.createdAt).toBe(annotation.updatedAt);
  });

  it("rejects stale evidence", () => {
    expect(() => createAnnotation("annotation-2", { ...anchor, validity: "stale" }, "hello")).toThrow("valid evidence anchor");
  });
});
