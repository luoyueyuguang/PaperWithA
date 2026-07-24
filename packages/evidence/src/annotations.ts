import type { EvidenceAnchor } from "@paperwitha/reader-core";

export type AnnotationKind = "highlight" | "note" | "tag";

export interface Annotation {
  annotationId: string;
  documentId: string;
  documentVersionId: string;
  anchor: EvidenceAnchor;
  kind: AnnotationKind;
  text: string;
  note: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export function createAnnotation(
  annotationId: string,
  anchor: EvidenceAnchor,
  text: string,
  note = "",
  kind: AnnotationKind = "note",
  now = new Date().toISOString(),
): Annotation {
  if (anchor.validity !== "valid") throw new Error("annotations require a valid evidence anchor");
  if (!text.trim()) throw new Error("annotations require selected text");
  return {
    annotationId,
    documentId: anchor.documentId,
    documentVersionId: anchor.documentVersionId,
    anchor,
    kind,
    text: text.trim(),
    note: note.trim(),
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function updateAnnotation(annotation: Annotation, patch: Pick<Partial<Annotation>, "note" | "tags" | "kind">, now = new Date().toISOString()): Annotation {
  return { ...annotation, ...patch, updatedAt: now };
}
