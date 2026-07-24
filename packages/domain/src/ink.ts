export type InkTool = "pen" | "highlighter" | "eraser";

export interface InkPoint {
  /** Normalized X coordinate within the PDF page (0-1 across page width). */
  x: number;
  /** Normalized Y coordinate within the PDF page (0-1 across page height). */
  y: number;
  /** Pointer pressure (0-1). Optional — defaults to 1 on devices without pressure. */
  pressure?: number;
  /** Pen tilt X angle in degrees. Optional. */
  tiltX?: number;
  /** Pen tilt Y angle in degrees. Optional. */
  tiltY?: number;
  /** Timestamp of this sample point in epoch ms. */
  timestampMs: number;
}

export interface InkStroke {
  /** Unique stroke identifier. */
  strokeId: string;
  /** Document this stroke belongs to. */
  documentId: string;
  /** Document version this stroke was created against. If the document
   *  version changes, the stroke should be marked stale in the UI. */
  documentVersionId: string;
  /** Page number (1-indexed) this stroke belongs to. */
  pageNumber: number;
  /** The tool used for this stroke. */
  tool: InkTool;
  /** Stroke color as a CSS-compatible string (e.g. "#1a2b3c"). */
  color: string;
  /** Stroke width in normalized page units (0-0.1 range typical). */
  width: number;
  /** Normalized point samples that make up this stroke. */
  points: readonly InkPoint[];
  /** Creation time in ISO 8601. */
  createdAt: string;
  /** If deleted, the deletion timestamp; otherwise null. */
  deletedAt: string | null;
}

export interface InkPage {
  documentId: string;
  documentVersionId: string;
  pageNumber: number;
  strokes: InkStroke[];
}

export function createInkStroke(input: {
  strokeId: string;
  documentId: string;
  documentVersionId: string;
  pageNumber: number;
  tool: InkTool;
  color: string;
  width: number;
  points: readonly InkPoint[];
  now: string;
}): InkStroke {
  if (!Number.isInteger(input.pageNumber) || input.pageNumber < 1) throw new Error("invalid page number");
  if (input.points.length < 2) throw new Error("stroke must have at least 2 points");
  return {
    strokeId: input.strokeId,
    documentId: input.documentId,
    documentVersionId: input.documentVersionId,
    pageNumber: input.pageNumber,
    tool: input.tool,
    color: input.color,
    width: input.width,
    points: [...input.points],
    createdAt: input.now,
    deletedAt: null,
  };
}

export function eraseInkStroke(stroke: InkStroke, now: string): InkStroke {
  return { ...stroke, deletedAt: now };
}

/** Convert a CSS px pair on a canvas of given dimensions to normalized page coordinates. */
export function canvasToNormalized(
  canvasX: number,
  canvasY: number,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(1, canvasX / canvasWidth)),
    y: Math.max(0, Math.min(1, canvasY / canvasHeight)),
  };
}

/** Convert normalized page coordinates back to canvas pixel positions. */
export function normalizedToCanvas(
  x: number,
  y: number,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } {
  return {
    x: x * canvasWidth,
    y: y * canvasHeight,
  };
}
