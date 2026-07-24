export function createPlatformShell(capabilities, initial) {
  let state = structuredClone(initial);
  const listeners = new Set();
  const publish = () => { const snapshot = structuredClone(state); listeners.forEach((listener) => listener(snapshot)); };
  return {
    capabilities,
    getState: () => structuredClone(state),
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    openPaper: (paper) => { state = { ...state, papers: [...state.papers.filter((candidate) => candidate.documentId !== paper.documentId), structuredClone(paper)], activePaperId: paper.documentId }; publish(); },
    setLayout: (layout) => { state = { ...state, layout: structuredClone(layout) }; publish(); },
  };
}
