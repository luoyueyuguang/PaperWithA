import {
  activeAgentBranch,
  addAgentSession,
  appendAgentEvent,
  appendAgentMessage,
  archiveAgentSession,
  forkAgentBranch,
  selectAgentBranch,
  createAgentSession,
  createAgentWorkspace,
  finishAgentRun,
  replaceAgentSession,
  selectAgentSession,
  startAgentRun,
  updateAgentMessage,
  updateAgentSessionContext,
  type AgentMessage,
  type AgentSession,
  type AgentWorkspaceState,
} from "@paperwitha/agent-core";
import { buildContext, type ContextSet, type ContextSource } from "@paperwitha/context";
import { createReadingBriefVersion, READING_BRIEF_SECTIONS, type ReadingBriefVersion } from "@paperwitha/domain";
import { createCrossPageAnchor, createPaperViewState, updatePaperView, type PaperViewState } from "@paperwitha/reader-core";
import { BrowserStoragePort, JsonRepository, StoragePortBlobStore } from "@paperwitha/storage";
import { createInkStroke, canvasToNormalized, type InkStroke, type InkTool } from "@paperwitha/domain";

// --- Shared state & constants ---

export const STORAGE_KEY = "paperwitha.web.v2";
const LEGACY_STORAGE_KEY = "paperwitha.web.v1";
export const LOCAL_RUNTIME_PROFILE_ID = "paperwitha-local-runtime";
export const LOCAL_AGENT_PROFILE_ID = "paperwitha-evidence-agent";

export interface RuntimeProfileMeta {
  id: string;
  name: string;
  adapterKind: string;
  icon: string;
}
export interface AgentProfileMeta {
  id: string;
  name: string;
  runtimeId: string;
  description: string;
  defaultModel: string | null;
}
export const RUNTIME_PROFILES: readonly RuntimeProfileMeta[] = [
  { id: "paperwitha-local-runtime", name: "Local Evidence Agent", adapterKind: "embedded", icon: "◎" },
  { id: "omp-rpc", name: "OMP", adapterKind: "omp-rpc", icon: "○" },
  { id: "pi-rpc", name: "Pi", adapterKind: "pi-rpc", icon: "π" },
  { id: "opencode-http", name: "OpenCode", adapterKind: "opencode-http", icon: "◇" },
];
export const AGENT_PROFILES: readonly AgentProfileMeta[] = [
  { id: "paperwitha-evidence-agent", name: "Evidence Agent", runtimeId: "paperwitha-local-runtime", description: "Local evidence-based answers", defaultModel: null },
  { id: "omp-task", name: "OMP Task Agent", runtimeId: "omp-rpc", description: "General-purpose coding and research agent", defaultModel: null },
  { id: "pi-coding-agent", name: "Pi Coding Agent", runtimeId: "pi-rpc", description: "Interactive coding agent with tool calling", defaultModel: null },
  { id: "opencode-task", name: "OpenCode Agent", runtimeId: "opencode-http", description: "Headless OpenCode agent", defaultModel: null },
];

export function runtimeMeta(id: string): RuntimeProfileMeta { return RUNTIME_PROFILES.find((r) => r.id === id) ?? RUNTIME_PROFILES[0]!; }
export function agentMeta(id: string): AgentProfileMeta { return AGENT_PROFILES.find((a) => a.id === id) ?? AGENT_PROFILES[0]!; }

export const app = document.querySelector<HTMLDivElement>("#app")!;
export const uid = (prefix: string) => `${prefix}-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
export const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);

export const stateRepository = new JsonRepository<PersistedState>(new BrowserStoragePort(), STORAGE_KEY);
const legacyStateRepository = new JsonRepository<PersistedState>(new BrowserStoragePort(), LEGACY_STORAGE_KEY);

export const blobStore = new StoragePortBlobStore();
export const textItemCache = new Map<string, Array<{ str: string; x: number; y: number; width: number; height: number; fontSize: number }>>();

export let inkStrokes: InkStroke[] = [];
export const ocrProgress = new Map<string, string>();
export let inkTool: InkTool = "pen";
export let inkColor = "#1a3a5c";
export let inkWidth = 0.004;
export let activeInkStroke: { points: Array<{ x: number; y: number; pressure?: number; timestampMs: number }>; canvasEl: HTMLCanvasElement | null; pageNumber: number; pageWidth: number; pageHeight: number } | null = null;

export function setInkTool(t: InkTool) { inkTool = t; }
export function setInkColor(c: string) { inkColor = c; }
export function setActiveInkStroke(s: typeof activeInkStroke) { activeInkStroke = s; }

// --- Types ---

export type StoredPaper = {
  id: string;
  title: string;
  sourceName: string;
  graph: DocumentGraph;
  view: PaperViewState;
  annotations: Annotation[];
  brief: string;
  briefVersions: ReadingBriefVersion[];
  addedAt: string;
};

export type AppState = {
  papers: StoredPaper[];
  activePaperId: string | null;
  activeTab: "agents" | "brief";
  sidebarOpen: boolean;
  assistantOpen: boolean;
  splitRatio: number;
  terminalHeight: number;
  selectedText: string;
  selectedPage: number | null;
  agentWorkspace: AgentWorkspaceState;
  inkStrokes: InkStroke[];
};

export type LegacyMessage = { id: string; role: "user" | "assistant"; text: string; createdAt: string };
export type LegacyPaper = StoredPaper & { chat?: LegacyMessage[] };
export type PersistedState = Omit<Partial<AppState>, "papers" | "activeTab"> & {
  papers?: LegacyPaper[];
  activeTab?: "chat" | "agents" | "brief";
  contextSourceIds?: string[];
  contextTexts?: Record<string, string>;
};
export type ProviderConfig = { endpoint: string; model: string; apiKey: string; enabled: boolean };

export const demoText = `Attention Is All You Need

Abstract
The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms. Experiments on two machine translation tasks show that these models are superior in quality while being more parallelizable and requiring significantly less time to train.

1 Introduction
Recurrent neural networks, long short-term memory and gated recurrent neural networks have been firmly established as state of the art approaches in sequence modeling and transduction problems such as language modeling and machine translation. The Transformer follows a different path: it relies entirely on attention to draw global dependencies between input and output.

2 Background
The goal of reducing sequential computation also forms the foundation of the Extended Neural GPU, ByteNet and ConvS2S. The Transformer achieves parallelization by using self-attention, connecting all positions in a sequence with a constant number of operations.

3 Model Architecture
The Transformer uses stacked self-attention and point-wise, fully connected layers in both the encoder and decoder. The encoder maps a sequence of symbol representations to a sequence of continuous representations. The decoder generates one output symbol at a time.

4 Why Self-Attention
Self-attention, sometimes called intra-attention, relates different positions in a single sequence. It is useful for discovering long-range dependencies and can be computed in parallel.`;

// --- State variables ---

export const state: AppState = loadState();
export let providerConfig: ProviderConfig | null = null;
export let selectionToolbar: HTMLDivElement | null = null;

export function setProviderConfig(c: ProviderConfig | null) { providerConfig = c; }
export function setSelectionToolbar(t: HTMLDivElement | null) { selectionToolbar = t; }

// --- State functions ---

export function emptyState(): AppState {
  return { papers: [], activePaperId: null, activeTab: "agents", sidebarOpen: true, assistantOpen: true, splitRatio: 0.55, terminalHeight: 0.28, selectedText: "", selectedPage: null, agentWorkspace: createAgentWorkspace(), inkStrokes: [] };
}

function makeInitialSession(paper: StoredPaper, index: number, now: string): AgentSession {
  return createAgentSession({
    sessionId: uid("session"),
    branchId: uid("branch"),
    title: `${paper.title} · ${index + 1}`,
    agentProfileId: LOCAL_AGENT_PROFILE_ID,
    runtimeProfileId: LOCAL_RUNTIME_PROFILE_ID,
    context: { documentIds: [paper.graph.documentId] },
    now,
  });
}

function migrateWorkspace(parsed: PersistedState, papers: StoredPaper[], legacyPapers: LegacyPaper[]): AgentWorkspaceState {
  if (parsed.agentWorkspace && Array.isArray(parsed.agentWorkspace.sessions)) return parsed.agentWorkspace;
  let workspace = createAgentWorkspace();
  const now = new Date().toISOString();
  legacyPapers.forEach((legacyPaper, index) => {
    const paper = papers[index];
    if (!paper || !legacyPaper.chat?.length) return;
    let session = makeInitialSession(paper, workspace.sessions.length, now);
    for (const message of legacyPaper.chat) {
      session = appendAgentMessage(session, {
        messageId: message.id,
        role: message.role,
        text: message.text,
        createdAt: message.createdAt,
        runId: null,
      });
    }
    workspace = addAgentSession(workspace, session);
  });
  const activePaper = papers.find((paper) => paper.id === parsed.activePaperId) ?? papers[0];
  if (workspace.sessions.length === 0 && activePaper) workspace = addAgentSession(workspace, makeInitialSession(activePaper, 0, now));
  if (activePaper && parsed.contextSourceIds?.length) {
    const active = workspace.sessions.find((session) => session.sessionId === workspace.activeSessionId);
    if (active) {
      const migrated = updateAgentSessionContext(active, {
        documentIds: [activePaper.graph.documentId],
        fixedSourceIds: [...parsed.contextSourceIds],
        sourceTexts: { ...(parsed.contextTexts ?? {}) },
        retrievalVersion: "local-lexical-v1",
      }, now);
      workspace = replaceAgentSession(workspace, migrated);
    }
  }
  return workspace;
}

export function loadState(): AppState {
  const current = stateRepository.read({});
  const parsed = current.papers ? current : legacyStateRepository.read({});
  const legacyPapers = Array.isArray(parsed.papers) ? parsed.papers : [];
  const papers = legacyPapers.map((legacyPaper) => {
    const { chat: _legacyChat, ...paper } = legacyPaper;
    return { ...paper, annotations: paper.annotations ?? [] };
  });
  const next: AppState = {
    papers,
    activePaperId: parsed.activePaperId ?? papers[0]?.id ?? null,
    activeTab: parsed.activeTab === "brief" ? "brief" : "agents",
    sidebarOpen: parsed.sidebarOpen ?? true,
    assistantOpen: parsed.assistantOpen ?? true,
    selectedText: "",
    selectedPage: null,
    agentWorkspace: migrateWorkspace(parsed, papers, legacyPapers),
    terminalHeight: typeof parsed.terminalHeight === "number" && parsed.terminalHeight > 0.1 && parsed.terminalHeight < 0.7 ? parsed.terminalHeight : 0.28,
    splitRatio: typeof parsed.splitRatio === "number" && parsed.splitRatio > 0.2 && parsed.splitRatio < 0.85 ? parsed.splitRatio : 0.55,
  };
  stateRepository.write(next);
  return next;
}

export function saveState() {
  stateRepository.write(state);
}

export function activePaper(): StoredPaper | null {
  return state.papers.find((paper) => paper.id === state.activePaperId) ?? state.papers[0] ?? null;
}

export function activeSession(): AgentSession | null {
  return state.agentWorkspace.sessions.find((session) => session.sessionId === state.agentWorkspace.activeSessionId && session.status !== "archived") ?? null;
}

export function storeSession(session: AgentSession, persist = true) {
  state.agentWorkspace = replaceAgentSession(state.agentWorkspace, session);
  if (persist) saveState();
}

export function createSessionForPaper(paper: StoredPaper): AgentSession {
  const session = makeInitialSession(paper, state.agentWorkspace.sessions.filter((c) => c.status !== "archived").length, new Date().toISOString());
  state.agentWorkspace = addAgentSession(state.agentWorkspace, session);
  saveState();
  return session;
}
export function addPaper(paper: StoredPaper) {
  state.papers = [paper, ...state.papers.filter((candidate) => candidate.graph.documentId !== paper.graph.documentId)];
  state.activePaperId = paper.id;
  state.selectedText = "";
  state.selectedPage = null;
  createSessionForPaper(paper);
  saveState();
}

export function ensureActiveSession(paper: StoredPaper): AgentSession {
  return activeSession() ?? createSessionForPaper(paper);
}


export function replaceCapturedSession(session: AgentSession) {
  state.agentWorkspace = replaceAgentSession(state.agentWorkspace, session);
}
