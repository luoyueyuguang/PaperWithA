import { describe, expect, it } from "vitest";
import { createInkStroke, eraseInkStroke, canvasToNormalized, normalizedToCanvas } from "../src/ink.js";

describe("E2E Ink Pipeline", () => {
  const now = "2026-07-24T10:00:00.000Z";

  it("creates strokes, persists, erases, and round-trips coordinates", () => {
    const points = [
      { x: 0.1, y: 0.2, pressure: 0.8, timestampMs: 1000 },
      { x: 0.15, y: 0.25, pressure: 0.9, timestampMs: 1010 },
      { x: 0.2, y: 0.3, pressure: 0.7, timestampMs: 1020 },
    ];

    const stroke = createInkStroke({
      strokeId: "ink-1",
      documentId: "doc-1",
      documentVersionId: "v1",
      pageNumber: 3,
      tool: "pen",
      color: "#1a3a5c",
      width: 0.004,
      points,
      now,
    });

    expect(stroke.strokeId).toBe("ink-1");
    expect(stroke.documentId).toBe("doc-1");
    expect(stroke.pageNumber).toBe(3);
    expect(stroke.points.length).toBe(3);
    expect(stroke.deletedAt).toBeNull();

    // Canvas coordinate round-trip
    const canvasPt = normalizedToCanvas(0.1, 0.2, 1200, 900);
    expect(canvasPt.x).toBeCloseTo(120);
    expect(canvasPt.y).toBeCloseTo(180);

    const backNorm = canvasToNormalized(canvasPt.x, canvasPt.y, 1200, 900);
    expect(backNorm.x).toBeCloseTo(0.1);
    expect(backNorm.y).toBeCloseTo(0.2);

    // Erase
    const erased = eraseInkStroke(stroke, "2026-07-24T10:01:00.000Z");
    expect(erased.deletedAt).toBe("2026-07-24T10:01:00.000Z");
    // Original is immutable
    expect(stroke.deletedAt).toBeNull();
  });

  it("rejects invalid inputs", () => {
    expect(() => createInkStroke({
      strokeId: "bad", documentId: "d", documentVersionId: "v",
      pageNumber: 0, tool: "pen", color: "#000", width: 0.01,
      points: [{ x: 0, y: 0, timestampMs: 0 }], now,
    })).toThrow("invalid page number");

    expect(() => createInkStroke({
      strokeId: "bad", documentId: "d", documentVersionId: "v",
      pageNumber: 1, tool: "pen", color: "#000", width: 0.01,
      points: [{ x: 0, y: 0, timestampMs: 0 }], now,
    })).toThrow("at least 2 points");
  });
});
