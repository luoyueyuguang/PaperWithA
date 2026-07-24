import type { DocumentGraph } from "@paperwitha/domain";

export interface SelectionInput {
  documentVersionId: string;
  startPage: number;
  endPage: number;
  startOffset: number;
  endOffset: number;
}

export interface EvidenceAnchor {
  anchorId: string;
  documentId: string;
  documentVersionId: string;
  pageId: string;
  nodeId: string;
  range: { start: number; end: number };
  endPageId: string;
  endNodeId: string;
  endRange: { start: number; end: number };
  validity: "valid" | "stale" | "invalid";
  confidence: number;
} 

export function createCrossPageAnchor(
  graph: DocumentGraph,
  selection: SelectionInput,
): EvidenceAnchor {
  if (selection.documentVersionId !== graph.documentVersionId) {
    throw new Error("selection belongs to a different document version");
  }
  if (selection.startPage < 1 || selection.endPage > graph.pages.length) {
    throw new Error("selection page is outside the document");
  }
  if (selection.startPage > selection.endPage) {
    throw new Error("selection pages must be ordered");
  }

  const startPage = graph.pages[selection.startPage - 1];
  const endPage = graph.pages[selection.endPage - 1];
  if (!startPage || !endPage) throw new Error("selection page does not exist");
  if (selection.startOffset < 0 || selection.startOffset >= startPage.text.length) {
    throw new Error("selection start offset is outside the page");
  }
  if (selection.endOffset <= 0 || selection.endOffset > endPage.text.length) {
    throw new Error("selection end offset is outside the page");
  }

  return {
    anchorId: `${graph.documentVersionId}:${selection.startPage}:${selection.startOffset}-${selection.endPage}:${selection.endOffset}`,
    documentId: graph.documentId,
    documentVersionId: graph.documentVersionId,
    pageId: startPage.pageId,
    nodeId: `${startPage.pageId}:text`,
    range: { start: selection.startOffset, end: startPage.text.length },
    endPageId: endPage.pageId,
    endNodeId: `${endPage.pageId}:text`,
    endRange: { start: 0, end: selection.endOffset },
    validity: "valid",
    confidence: 1,
  };
}
