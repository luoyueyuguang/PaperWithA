export interface PaperViewState {
  paperViewId: string;
  documentId: string;
  documentVersionId: string;
  scrollAnchor: {
    pageNumber: number;
    relativeOffset: number;
  };
  zoom: number;
  selectedAnchorId: string | null;
}

export function createPaperViewState(
  paperViewId: string,
  documentId: string,
  documentVersionId: string,
): PaperViewState {
  return {
    paperViewId,
    documentId,
    documentVersionId,
    scrollAnchor: { pageNumber: 1, relativeOffset: 0 },
    zoom: 1,
    selectedAnchorId: null,
  };
}

export function updatePaperView(
  state: PaperViewState,
  patch: Partial<Pick<PaperViewState, "scrollAnchor" | "zoom" | "selectedAnchorId">>,
): PaperViewState {
  return { ...state, ...patch };
}
