export interface DocumentPage {
  pageId: string;
  pageNumber: number;
  text: string;
  layout?: {
    columns: number;
    figureCount: number;
    formulaCount: number;
  };
  confidence?: number;
}

export interface DocumentGraph {
  graphId: string;
  documentId: string;
  documentVersionId: string;
  pages: readonly DocumentPage[];
}

export interface DocumentVersion {
  documentId: string;
  documentVersionId: string;
  contentHash: string;
  graphId: string;
}
