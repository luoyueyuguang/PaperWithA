import type { DocumentGraph } from "@paperwitha/domain";
import type { LayoutTree } from "@paperwitha/workspace";

export type PlatformKind = "web" | "desktop" | "mobile";

export interface PlatformCapabilities {
  kind: PlatformKind;
  nativeWindows: boolean;
  persistentStorage: "browser" | "sqlite";
  touchInput: boolean;
  fileImport: boolean;
}

export interface WorkspacePaper {
  documentId: string;
  graph: DocumentGraph;
  title: string;
}

export interface SharedWorkspaceState {
  workspaceId: string;
  papers: WorkspacePaper[];
  layout: LayoutTree;
  activePaperId: string | null;
}

export interface PlatformShell {
  readonly capabilities: PlatformCapabilities;
  getState(): SharedWorkspaceState;
  subscribe(listener: (state: SharedWorkspaceState) => void): () => void;
  openPaper(paper: WorkspacePaper): void;
  setLayout(layout: LayoutTree): void;
}

export function createPlatformShell(capabilities: PlatformCapabilities, initial: SharedWorkspaceState): PlatformShell {
  let state = structuredClone(initial);
  const listeners = new Set<(next: SharedWorkspaceState) => void>();
  const publish = () => { const snapshot = structuredClone(state); listeners.forEach((listener) => listener(snapshot)); };
  return {
    capabilities,
    getState: () => structuredClone(state),
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    openPaper: (paper) => { state = { ...state, papers: [...state.papers.filter((candidate) => candidate.documentId !== paper.documentId), structuredClone(paper)], activePaperId: paper.documentId }; publish(); },
    setLayout: (layout) => { state = { ...state, layout: structuredClone(layout) }; publish(); },
  };
}
