export interface WorkspaceExportManifest {
  format: "paperwitha.v1";
  exportedAt: string;
  papers: Array<{
    id: string;
    title: string;
    sourceName: string;
    graph: {
      graphId: string;
      documentId: string;
      documentVersionId: string;
      blobHash: string | null;
      pageCount: number;
    };
    annotationCount: number;
    inkStrokeCount: number;
    view: {
      scrollAnchor: { pageNumber: number; relativeOffset: number } | null;
      zoom: number;
    };
  }>;
  sessions: Array<{
    sessionId: string;
    title: string;
    agentProfileId: string;
    runtimeProfileId: string;
    messageCount: number;
    runCount: number;
    branchCount: number;
    status: string;
  }>;
  appVersion: string;
}
