import "./styles.css";
import {
  activeAgentBranch,
  addAgentSession,
  appendAgentEvent,
  appendAgentMessage,
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
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { createWorker } from "tesseract.js";
import { BrowserStoragePort, JsonRepository, StoragePortBlobStore } from "@paperwitha/storage";
import { createAnnotation, type Annotation } from "@paperwitha/evidence";
import { ProviderClient } from "@paperwitha/ai-core";

const blobStore = new StoragePortBlobStore();
/** Cached text items with positions for text layer rendering. Key = `${blobHash}:${pageNumber}` */
const textItemCache = new Map<string, Array<{ str: string; x: number; y: number; width: number; height: number; fontSize: number }>>();
import { createInkStroke, canvasToNormalized, type InkStroke, type InkTool } from "@paperwitha/domain";

let inkStrokes: InkStroke[] = [];
const ocrProgress = new Map<string, string>(); // pageId → status
let inkTool: InkTool = "pen";
let inkColor = "#1a3a5c";
let inkWidth = 0.004;
let activeInkStroke: { points: Array<{ x: number; y: number; pressure?: number; timestampMs: number }>; canvasEl: HTMLCanvasElement | null; pageNumber: number; pageWidth: number; pageHeight: number } | null = null;
type StoredPaper = {
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

type AppState = {
  papers: StoredPaper[];
  activePaperId: string | null;
  activeTab: "agents" | "brief";
  sidebarOpen: boolean;
  assistantOpen: boolean;
  splitRatio: number;
  selectedText: string;
  selectedPage: number | null;
  agentWorkspace: AgentWorkspaceState;
  inkStrokes: InkStroke[];
};

type LegacyMessage = { id: string; role: "user" | "assistant"; text: string; createdAt: string };
type LegacyPaper = StoredPaper & { chat?: LegacyMessage[] };
type PersistedState = Omit<Partial<AppState>, "papers" | "activeTab"> & {
  papers?: LegacyPaper[];
  activeTab?: "chat" | "agents" | "brief";
  contextSourceIds?: string[];
  contextTexts?: Record<string, string>;
};
type ProviderConfig = { endpoint: string; model: string; apiKey: string; enabled: boolean };

const STORAGE_KEY = "paperwitha.web.v2";
const LEGACY_STORAGE_KEY = "paperwitha.web.v1";
const LOCAL_RUNTIME_PROFILE_ID = "paperwitha-local-runtime";
const LOCAL_AGENT_PROFILE_ID = "paperwitha-evidence-agent";

interface RuntimeProfileMeta {
  id: string;
  name: string;
  adapterKind: string;
  icon: string;
}
interface AgentProfileMeta {
  id: string;
  name: string;
  runtimeId: string;
  description: string;
  defaultModel: string | null;
}
const RUNTIME_PROFILES: readonly RuntimeProfileMeta[] = [
  { id: "paperwitha-local-runtime", name: "Local Evidence Agent", adapterKind: "embedded", icon: "◎" },
  { id: "omp-rpc", name: "OMP", adapterKind: "omp-rpc", icon: "○" },
  { id: "pi-rpc", name: "Pi", adapterKind: "pi-rpc", icon: "π" },
  { id: "opencode-http", name: "OpenCode", adapterKind: "opencode-http", icon: "◇" },
];
const AGENT_PROFILES: readonly AgentProfileMeta[] = [
  { id: "paperwitha-evidence-agent", name: "Evidence Agent", runtimeId: "paperwitha-local-runtime", description: "Local evidence-based answers", defaultModel: null },
  { id: "omp-task", name: "OMP Task Agent", runtimeId: "omp-rpc", description: "General-purpose coding and research agent", defaultModel: null },
  { id: "pi-coding-agent", name: "Pi Coding Agent", runtimeId: "pi-rpc", description: "Interactive coding agent with tool calling", defaultModel: null },
  { id: "opencode-task", name: "OpenCode Agent", runtimeId: "opencode-http", description: "Headless OpenCode agent", defaultModel: null },
];
function runtimeMeta(id: string): RuntimeProfileMeta { return RUNTIME_PROFILES.find((r) => r.id === id) ?? RUNTIME_PROFILES[0]!; }
function agentMeta(id: string): AgentProfileMeta { return AGENT_PROFILES.find((a) => a.id === id) ?? AGENT_PROFILES[0]!; }
const app = document.querySelector<HTMLDivElement>("#app")!;
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
const stateRepository = new JsonRepository<PersistedState>(new BrowserStoragePort(), STORAGE_KEY);
const legacyStateRepository = new JsonRepository<PersistedState>(new BrowserStoragePort(), LEGACY_STORAGE_KEY);
const emptyState = (): AppState => ({ papers: [], activePaperId: null, activeTab: "agents", sidebarOpen: true, assistantOpen: true, splitRatio: 0.55, selectedText: "", selectedPage: null, agentWorkspace: createAgentWorkspace(), inkStrokes: [] });

const demoText = `Attention Is All You Need

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

let state = loadState();
let providerConfig: ProviderConfig | null = null;
let selectionToolbar: HTMLDivElement | null = null;

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

function loadState(): AppState {
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
    splitRatio: typeof parsed.splitRatio === "number" && parsed.splitRatio > 0.2 && parsed.splitRatio < 0.85 ? parsed.splitRatio : 0.55,
  };
  stateRepository.write(next);
  return next;
}

function saveState() {
  stateRepository.write(state);
}

function activePaper(): StoredPaper | null {
  return state.papers.find((paper) => paper.id === state.activePaperId) ?? state.papers[0] ?? null;
}

function activeSession(): AgentSession | null {
  return state.agentWorkspace.sessions.find((session) => session.sessionId === state.agentWorkspace.activeSessionId && session.status !== "archived") ?? null;
}

function storeSession(session: AgentSession, persist = true) {
  state.agentWorkspace = replaceAgentSession(state.agentWorkspace, session);
  if (persist) saveState();
}

function createSessionForPaper(paper: StoredPaper): AgentSession {
  const session = makeInitialSession(paper, state.agentWorkspace.sessions.filter((candidate) => candidate.status !== "archived").length, new Date().toISOString());
  state.agentWorkspace = addAgentSession(state.agentWorkspace, session);
  saveState();
  return session;
}

function ensureActiveSession(paper: StoredPaper): AgentSession {
  return activeSession() ?? createSessionForPaper(paper);
}

function splitTextIntoPages(text: string): DocumentPage[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const pageSize = 48;
  const pages: DocumentPage[] = [];
  for (let index = 0; index < lines.length; index += pageSize) {
    const body = lines.slice(index, index + pageSize).join("\n").trim();
    if (body) pages.push({ pageId: `page-${pages.length + 1}`, pageNumber: pages.length + 1, text: body, confidence: 1 });
  }
  return pages.length ? pages : [{ pageId: "page-1", pageNumber: 1, text: "No readable text was found in this document.", confidence: 0 }];
}

async function parseFile(file: File): Promise<DocumentGraph> {
  const documentId = uid("document");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let blobHash: string | null = null;
  if (file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf") {
    blobHash = await blobStore.put(bytes);
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const document = await pdfjs.getDocument({ data: bytes }).promise;
    const pages: DocumentPage[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const content = await page.getTextContent();
      const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ").trim();
      if (blobHash) {
        const items = content.items
          .filter((item): item is typeof item & { str: string; transform: number[]; width: number; height: number } => "str" in item && typeof item.str === "string" && Array.isArray((item as Record<string,unknown>).transform) && typeof (item as Record<string,unknown>).width === "number")
          .map((item) => ({
            str: item.str,
            x: (item.transform[4] ?? 0) / (viewport.width / 1.5),
            y: (item.transform[5] ?? 0) / (viewport.height / 1.5),
            width: item.width / (viewport.width / 1.5),
            height: item.height / (viewport.height / 1.5),
            fontSize: Math.abs(item.transform[0] ?? 0) / (viewport.width / 1.5),
          }));
        textItemCache.set(`${blobHash}:${pageNumber}`, items);
      }
      pages.push({ pageId: `${documentId}:page:${pageNumber}`, pageNumber, text: text || "This page has no text layer. Use OCR in a future pass.", confidence: text ? 0.98 : 0.2 });
    }
    await document.destroy();
    return { graphId: uid("graph"), documentId, documentVersionId: `${documentId}:v1`, pages, blobHash };
  }
  return { graphId: uid("graph"), documentId, documentVersionId: `${documentId}:v1`, pages: splitTextIntoPages(await file.text()), blobHash: null };
}

function renderPagePlaceholder(page: DocumentPage, annotationCount: number, blobHash: string | null): string {
  const lowConfidence = page.confidence !== undefined && page.confidence < 0.5;
  const ocrStatus = ocrProgress.get(page.pageId);
  const ocrBtn = lowConfidence ? `<button class="ocr-button" data-ocr-page="${page.pageNumber}" ${ocrStatus ? "disabled" : ""}>${ocrStatus ? escapeHtml(ocrStatus) : "OCR this page"}</button>` : "";
  const label = `${String(page.pageNumber).padStart(2, "0")} ${lowConfidence ? "page-only fallback" : ""}`;
  const badge = annotationCount ? `<b class="annotation-badge">${annotationCount} note${annotationCount === 1 ? "" : "s"}</b>` : "";
  if (blobHash) {
    const canvasId = `pdf-canvas-${page.pageNumber}`;
    const inkId = `ink-canvas-${page.pageNumber}`;
    return `<article class="paper-page pdf-page" data-page-number="${page.pageNumber}"><div class="page-label">${label}${badge}${ocrBtn}</div><div class="pdf-canvas-wrap" id="${canvasId}"><canvas class="ink-canvas" id="${inkId}" data-page-number="${page.pageNumber}"></canvas></div><div class="page-text">${escapeHtml(page.text).split("\n").map((line) => line.trim() ? `<p>${escapeHtml(line)}</p>` : "").join("")}</div></article>`;
  }
  return `<article class="paper-page" data-page-number="${page.pageNumber}"><div class="page-label">${label}${badge}${ocrBtn}</div><div class="page-text">${escapeHtml(page.text).split("\n").map((line) => line.trim() ? `<p>${escapeHtml(line)}</p>` : "").join("")}</div></article>`;
}

function makePaper(title: string, sourceName: string, graph: DocumentGraph): StoredPaper {
  const id = uid("paper");
  const view = createPaperViewState(uid("view"), graph.documentId, graph.documentVersionId);
  const brief = makeBrief(graph);
  const version = createReadingBriefVersion({
    briefId: uid("brief"),
    documentId: graph.documentId,
    documentVersionId: graph.documentVersionId,
    model: null,
    sections: [{ heading: "Core Summary", content: brief, evidenceAnchorIds: [], confidence: "inferred" as const }],
    now: new Date().toISOString(),
  });
  return { id, title, sourceName, graph, view, annotations: [], brief, briefVersions: [version], addedAt: new Date().toISOString() };
}

function makeBrief(graph: DocumentGraph): string {
  const text = graph.pages.slice(0, 3).map((page) => page.text).join(" ").replace(/\s+/g, " ").trim();
  if (!text) return "No readable text is available for a brief yet.";
  return text.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 4).join(" ");
}

function createDemoPaper() {
  const documentId = uid("demo-document");
  const pages = splitTextIntoPages(demoText).map((page, index) => ({ ...page, pageId: `${documentId}:page:${index + 1}` }));
  const graph: DocumentGraph = { graphId: uid("graph"), documentId, documentVersionId: `${documentId}:v1`, pages, blobHash: null };
  addPaper(makePaper("Attention Is All You Need", "demo-paper.txt", graph));
}

function addPaper(paper: StoredPaper) {
  state.papers = [paper, ...state.papers.filter((candidate) => candidate.graph.documentId !== paper.graph.documentId)];
  state.activePaperId = paper.id;
  state.selectedText = "";
  state.selectedPage = null;
  createSessionForPaper(paper);
  render();
}

function sourcesForSession(session: AgentSession): ContextSource[] {
  const sources = new Map<string, ContextSource>();
  for (const paper of state.papers) {
    if (!session.context.documentIds.includes(paper.graph.documentId)) continue;
    for (const page of paper.graph.pages) {
      const sourceId = `${paper.id}:page:${page.pageNumber}`;
      sources.set(sourceId, { sourceId, documentId: paper.graph.documentId, text: page.text });
    }
  }
  for (const sourceId of session.context.fixedSourceIds) {
    const text = session.context.sourceTexts[sourceId];
    if (!text) continue;
    const paper = state.papers.find((candidate) => sourceId.startsWith(`${candidate.id}:`));
    if (paper) sources.set(sourceId, { sourceId, documentId: paper.graph.documentId, text });
  }
  return [...sources.values()];
}

function answerFor(prompt: string, session: AgentSession, result: ReturnType<typeof buildContext>, sources: ContextSource[]): string {
  const selected = sources.filter((source) => result.selectedSourceIds.includes(source.sourceId));
  const excerpt = selected.map((source) => source.text).join(" ").replace(/\s+/g, " ").slice(0, 480);
  const titles = state.papers.filter((paper) => session.context.documentIds.includes(paper.graph.documentId)).map((paper) => `“${paper.title}”`).join(", ");
  return `Local evidence agent used ${result.selectedSourceIds.length} source${result.selectedSourceIds.length === 1 ? "" : "s"} from ${titles || "the explicit context"}. ${prompt.trim() ? `For “${prompt.trim()}”, the relevant evidence begins: “${excerpt}”` : `The current evidence begins: “${excerpt}”`}`;
}

function addSelectionToSession(paper: StoredPaper, text: string): AgentSession {
  let session = ensureActiveSession(paper);
  const sourceId = `${paper.id}:selection:${uid("source")}`;
  session = updateAgentSessionContext(session, {
    documentIds: [...new Set([...session.context.documentIds, paper.graph.documentId])],
    fixedSourceIds: [...session.context.fixedSourceIds, sourceId],
    sourceTexts: { ...session.context.sourceTexts, [sourceId]: text },
    retrievalVersion: session.context.retrievalVersion,
  }, new Date().toISOString());
  storeSession(session);
  return session;
}

function render() {
  selectionToolbar?.remove();
  selectionToolbar = null;
  const paper = activePaper();
  app.innerHTML = `
    <div class="app-shell ${state.sidebarOpen ? "sidebar-open" : "sidebar-closed"} ${state.assistantOpen ? "assistant-open" : "assistant-closed"}">
      <header class="topbar">
        <button class="brand" id="home-button" aria-label="PaperWithA home"><span class="brand-mark">P</span><span>PaperWithA</span></button>
        <div class="topbar-actions"><label class="import-button"><input id="file-input" type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" hidden />Import paper</label><button class="icon-button" id="add-demo" title="Load a demo paper">+</button><button class="avatar ${providerConfig ? "provider-active" : ""}" id="provider-settings" title="Configure AI provider">${providerConfig ? "AI" : "L"}</button></div>
      </header>
      <div class="shell-body">
        <aside class="sidebar">
          <div class="sidebar-heading"><span>LIBRARY</span><strong>${state.papers.length}</strong></div>
          <button class="demo-card" id="add-demo-card"><span class="demo-icon">✦</span><span><strong>Try the demo paper</strong><small>Explore without uploading</small></span></button>
          <div class="library-list">${state.papers.length ? state.papers.map((candidate) => `<button class="paper-item ${candidate.id === paper?.id ? "active" : ""}" data-paper-id="${candidate.id}"><span class="paper-icon">▤</span><span class="paper-item-copy"><strong>${escapeHtml(candidate.title)}</strong><small>${escapeHtml(candidate.sourceName)} · ${candidate.graph.pages.length} pages</small></span></button>`).join("") : `<div class="empty-library"><div class="empty-icon">⌁</div><strong>Your library is empty</strong><span>Import a paper to begin.</span></div>`}</div>
          ${state.papers.length ? `<div class="sidebar-actions"><button class="ghost-button" id="clear-library">Clear local library</button><button class="ghost-button" id="export-workspace" title="Export entire workspace as .paperwitha">Export</button><label class="ghost-button"><input id="import-workspace" type="file" accept=".json" hidden />Import</label></div>` : ""}
        </aside>
        <main class="main-area">
          <div class="workspace-toolbar"><div class="crumb">Library <span>/</span> <strong>${paper ? escapeHtml(paper.title) : "Welcome"}</strong></div><div class="toolbar-actions">${paper ? `<span class="saved-state">● Saved locally</span><button class="ghost-button" id="toggle-assistant">${state.assistantOpen ? "Hide agents" : "Show agents"}</button>` : ""}<button class="ghost-button" id="toggle-sidebar">${state.sidebarOpen ? "Hide library" : "Show library"}</button></div></div>
          ${paper ? renderWorkspace(paper) : renderWelcome()}
        </main>
      </div>
    </div>`;
  bindEvents();
  queuePdfCanvasRender();
  scheduleInkSetup();
}


function queuePdfCanvasRender(): void {
  const paper = activePaper();
  if (!paper?.graph.blobHash) return;
  const hash = paper.graph.blobHash;
  document.querySelectorAll<HTMLElement>(".pdf-canvas-wrap").forEach(async (wrap) => {
    const pageNumber = Number(wrap.closest("[data-page-number]")?.getAttribute("data-page-number"));
    if (!pageNumber) return;
    try {
      const bytes = await blobStore.get(hash);
      if (!bytes) return;
      const doc = await pdfjs.getDocument({ data: bytes }).promise;
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.className = "pdf-canvas";
      canvas.dataset.pageNumber = String(pageNumber);
      const ctx = canvas.getContext("2d");
      if (ctx) await page.render({ canvasContext: ctx, viewport }).promise;
      wrap.prepend(canvas);

      // Render positioned text layer
      const items = textItemCache.get(`${hash}:${pageNumber}`);
      if (items) {
        const textDiv = document.createElement("div");
        textDiv.className = "text-layer";
        textDiv.style.cssText = `position:absolute;top:0;left:0;width:${viewport.width}px;height:${viewport.height}px;overflow:hidden;pointer-events:none;`;
        for (const item of items) {
          if (!item.str.trim()) continue;
          const span = document.createElement("span");
          span.textContent = item.str;
          span.style.cssText = `position:absolute;left:${item.x * viewport.width}px;top:${(item.y - item.fontSize) * viewport.height}px;font-size:${Math.max(8, item.fontSize * viewport.width * 0.75)}px;color:#000;white-space:nowrap;pointer-events:auto;`;
          textDiv.appendChild(span);
        }
        wrap.appendChild(textDiv);
      }

      await doc.destroy();
    } catch { /* canvas render failed, text layer remains */ }
  });
}
function renderWelcome() {
  return `<section class="welcome"><div class="welcome-glow"></div><span class="eyebrow">LOCAL-FIRST RESEARCH WORKSPACE</span><h1>Read deeply.<br /><em>Think with evidence.</em></h1><p>Bring a paper into a local workspace with independent agent sessions, explicit evidence, and persistent research history.</p><div class="welcome-actions"><label class="primary-button"><input id="welcome-file-input" type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" hidden />Import a paper <span>↗</span></label><button class="secondary-button" id="welcome-demo">Open the demo <span>→</span></button></div><div class="feature-row"><span><b>01</b> Continuous reading</span><span><b>02</b> Multi-session agents</span><span><b>03</b> Local by default</span></div></section>`;
}

function renderWorkspace(paper: StoredPaper) {
  const pages = paper.graph.pages.map((page) => {
    const annotationCount = paper.annotations.filter((annotation) => annotation.anchor.pageId === page.pageId).length;
    return renderPagePlaceholder(page, annotationCount, paper.graph.blobHash);
  }).join("");
  const inkBar = paper.graph.blobHash ? `<div class="ink-toolbar"><button class="ink-tool ${inkTool === "pen" ? "active" : ""}" id="ink-pen" title="Pen">✎</button><button class="ink-tool ${inkTool === "highlighter" ? "active" : ""}" id="ink-highlighter" title="Highlighter">◐</button><button class="ink-tool ${inkTool === "eraser" ? "active" : ""}" id="ink-eraser" title="Eraser">⌫</button><input type="color" value="${escapeHtml(inkColor)}" id="ink-color" title="Ink color" class="ink-color" /><button class="ink-tool" id="ink-clear-page" title="Clear page ink">Clear</button><button class="ink-tool" id="export-annotated" title="Export annotated page as PNG">⬇</button></div>` : "";
  const readerWidth = state.assistantOpen ? `${Math.round(state.splitRatio * 100)}%` : "100%";
  return `<div class="split-pane" id="split-pane"><section class="reader-panel" style="flex:0 0 ${readerWidth};min-width:0;"><div class="reader-header"><div><span class="eyebrow">DOCUMENT READER</span><h2>${escapeHtml(paper.title)}</h2></div><div class="reader-meta"><span>${paper.graph.pages.length} pages</span><span>Zoom ${Math.round(paper.view.zoom * 100)}%</span></div>${inkBar}</div><div class="reader-scroll" id="reader-scroll">${pages}</div></section>${state.assistantOpen ? `<div class="split-divider" id="split-divider" title="Drag to resize"></div><aside class="assistant-panel" style="flex:1;min-width:280px;"><div class="assistant-tabs"><button class="tab ${state.activeTab === "agents" ? "active" : ""}" id="agent-tab">Agents</button><button class="tab ${state.activeTab === "brief" ? "active" : ""}" id="brief-tab">Reading Brief</button></div>${state.activeTab === "agents" ? renderAgentWorkspace(paper) : renderBrief(paper)}</aside>` : ""}</div>`;
}

function renderAgentWorkspace(paper: StoredPaper) {
  const sessions = state.agentWorkspace.sessions.filter((session) => session.status !== "archived");
  const session = activeSession();
  const tabs = sessions.map((candidate) => {
    const rt = runtimeMeta(candidate.runtimeProfileId);
    return `<button class="agent-session-tab ${candidate.sessionId === session?.sessionId ? "active" : ""}" data-session-id="${candidate.sessionId}" title="${escapeHtml(candidate.title)} — ${escapeHtml(rt.name)}"><span class="session-status ${candidate.status}"></span><span class="agent-icon">${escapeHtml(rt.icon)}</span><span>${escapeHtml(candidate.title)}</span></button>`;
  }).join("");
  if (!session) return `<div class="agent-session-bar"><div class="agent-session-tabs"></div><button class="session-action" id="new-session" title="New session">+</button></div><div class="chat-empty"><div class="assistant-orb">✦</div><h3>Create an agent session</h3><p>Each session keeps its own context, history, branch, and run state.</p></div>`;
  const branch = activeAgentBranch(session);
  const messages = branch.messages.length ? branch.messages.map((message) => `<div class="message ${message.role}" data-message-id="${message.messageId}"><div class="message-label">${message.role === "user" ? "You" : "Evidence Agent"}${message.role === "assistant" && !running ? `<button class="fork-button" data-fork-from="${message.messageId}" title="Fork new branch from this message">⇆</button>` : ""}</div><p>${escapeHtml(message.text)}</p></div>`).join("") : `<div class="chat-empty"><div class="assistant-orb">✦</div><h3>Ask with an independent session</h3><p>Select evidence in any paper. This session keeps a frozen context snapshot for every run.</p><div class="suggestions"><button data-suggestion="What is the main contribution?">Main contribution</button><button data-suggestion="What evidence supports the claim?">Evidence</button></div></div>`;
  const contextCount = session.context.fixedSourceIds.length;
  const running = branch.activeRunId !== null;
  const branchTabs = session.branches.length > 1 ? `<div class="branch-tabs">${session.branches.map((b) => `<button class="branch-tab ${b.branchId === session.activeBranchId ? "active" : ""}" data-branch-id="${b.branchId}">${escapeHtml(b.title)}</button>`).join("")}</div>` : "";
  const rt = runtimeMeta(session.runtimeProfileId);
  const ag = agentMeta(session.agentProfileId);
  const sourceTags = session.context.fixedSourceIds.slice(0, 3).map((sourceId) => {
    const text = session.context.sourceTexts[sourceId]?.slice(0, 30) ?? sourceId;
    return `<button class="source-tag" data-jump-source="${sourceId}" title="Jump to evidence: ${escapeHtml(text)}">${escapeHtml(text)}…</button>`;
  }).join("");
  const moreCount = session.context.fixedSourceIds.length > 3 ? ` +${session.context.fixedSourceIds.length - 3}` : "";
  return `<div class="agent-session-bar"><div class="agent-session-tabs">${tabs}</div><button class="session-action" id="new-session" title="New session for this paper">+</button><button class="session-action" id="archive-session" title="Archive active session">×</button></div><div class="agent-session-meta"><span><span class="agent-icon">${escapeHtml(rt.icon)}</span> ${escapeHtml(session.title)}</span><small>${escapeHtml(ag.name)} · ${escapeHtml(rt.name)} · ${session.branches.length} branch${session.branches.length === 1 ? "" : "es"}</small></div>${branchTabs}<div class="context-strip"><span class="context-dot"></span><span>${contextCount ? `${contextCount} source${contextCount === 1 ? "" : "s"}` : `${session.context.documentIds.length} paper${session.context.documentIds.length === 1 ? "" : "s"}`}</span><span class="source-tags">${sourceTags}${moreCount}</span><button id="clear-context">Clear fixed</button></div><div class="chat-messages" id="chat-messages">${messages}</div><form class="chat-form" id="chat-form"><textarea id="chat-input" rows="2" placeholder="Ask this agent session…" ${running ? "disabled" : ""}></textarea><div class="chat-form-footer"><span>${running ? `${escapeHtml(ag.name)} running…` : providerConfig ? `Remote · ${escapeHtml(providerConfig.model)}` : `${escapeHtml(ag.name)} · no network`}</span><button class="send-button" type="submit" ${running ? "disabled" : ""}>Send ↗</button></div></form>`;
}

function renderBrief(paper: StoredPaper) {
  const activeVersion = paper.briefVersions.find((v) => v.active) ?? paper.briefVersions[0];
  const sectionsHtml = activeVersion
    ? activeVersion.sections.map((section, i) => {
        const overlay = activeVersion.userOverlay[String(i)] ?? section.content;
        const edited = section.userEdited ? " (edited)" : "";
        const confidenceBadge = section.confidence !== "stated" ? `<small class="confidence-badge ${section.confidence}">${section.confidence.replace(/-/g, " ")}</small>` : "";
        return `<div class="brief-section"><span>${escapeHtml(section.heading)}${edited}${confidenceBadge}</span><p>${escapeHtml(overlay)}</p></div>`;
      }).join("")
    : `<div class="brief-section"><span>CORE SUMMARY</span><p>${escapeHtml(paper.brief)}</p></div>`;
  return `<div class="brief-content"><span class="eyebrow">STRUCTURED OUTPUT</span><h3>Reading Brief</h3>${paper.briefVersions.length > 1 ? `<div class="brief-versions"><span>${paper.briefVersions.length} version${paper.briefVersions.length === 1 ? "" : "s"}</span></div>` : ""}${sectionsHtml}<button class="secondary-button full-width" id="refresh-brief">Regenerate from first pages</button></div>`;
}

function configureProvider() {
  const endpoint = window.prompt("Provider endpoint (blank disables remote AI)", providerConfig?.endpoint ?? "")?.trim() ?? "";
  if (!endpoint) { providerConfig = null; render(); return; }
  const model = window.prompt("Model identifier", providerConfig?.model ?? "default")?.trim() || "default";
  const apiKey = window.prompt("API key (kept only in memory)", "") ?? "";
  try {
    new URL(endpoint);
    providerConfig = { endpoint, model, apiKey, enabled: true };
    render();
  } catch {
    window.alert("Provider endpoint must be a valid URL.");
  }
}

function bindEvents() {
  document.querySelector<HTMLButtonElement>("#home-button")?.addEventListener("click", () => { state.activePaperId = null; saveState(); render(); });
  document.querySelector<HTMLButtonElement>("#provider-settings")?.addEventListener("click", configureProvider);
  document.querySelector<HTMLButtonElement>("#add-demo")?.addEventListener("click", createDemoPaper);
  document.querySelector<HTMLButtonElement>("#add-demo-card")?.addEventListener("click", createDemoPaper);
  document.querySelector<HTMLButtonElement>("#welcome-demo")?.addEventListener("click", createDemoPaper);
  document.querySelector<HTMLButtonElement>("#toggle-sidebar")?.addEventListener("click", () => { state.sidebarOpen = !state.sidebarOpen; saveState(); render(); });
  document.querySelector<HTMLButtonElement>("#toggle-assistant")?.addEventListener("click", () => { state.assistantOpen = !state.assistantOpen; saveState(); render(); });
  document.querySelector<HTMLButtonElement>("#clear-library")?.addEventListener("click", () => { if (window.confirm("Remove all papers and agent sessions from this browser?")) { state = emptyState(); saveState(); render(); } });
  document.querySelectorAll<HTMLButtonElement>("[data-paper-id]").forEach((button) => button.addEventListener("click", () => { state.activePaperId = button.dataset.paperId ?? null; state.selectedText = ""; saveState(); render(); }));
  document.querySelectorAll<HTMLButtonElement>("[data-session-id]").forEach((button) => button.addEventListener("click", () => { const sessionId = button.dataset.sessionId; if (sessionId) { state.agentWorkspace = selectAgentSession(state.agentWorkspace, sessionId); saveState(); render(); } }));
  document.querySelectorAll<HTMLButtonElement>("[data-fork-from]").forEach((button) => button.addEventListener("click", () => { const session = activeSession(); if (!session) return; try { state.agentWorkspace = replaceAgentSession(state.agentWorkspace, forkAgentBranch(session, { branchId: uid("branch"), fromMessageId: button.dataset.forkFrom!, title: `${session.title} · fork`, now: new Date().toISOString() })); saveState(); render(); } catch (error) { window.alert(error instanceof Error ? error.message : String(error)); } }));
  document.querySelectorAll<HTMLButtonElement>("[data-branch-id]").forEach((button) => button.addEventListener("click", () => { const session = activeSession(); if (!session) return; try { state.agentWorkspace = replaceAgentSession(state.agentWorkspace, selectAgentBranch(session, button.dataset.branchId!, new Date().toISOString())); saveState(); render(); } catch (error) { window.alert(error instanceof Error ? error.message : String(error)); } }));
  document.querySelector<HTMLButtonElement>("#new-session")?.addEventListener("click", () => { const paper = activePaper(); if (paper) { createSessionForPaper(paper); render(); } });
  document.querySelector<HTMLButtonElement>("#archive-session")?.addEventListener("click", () => { const session = activeSession(); if (!session) return; try { state.agentWorkspace = archiveAgentSession(state.agentWorkspace, session.sessionId, new Date().toISOString()); saveState(); render(); } catch (error) { window.alert(error instanceof Error ? error.message : String(error)); } });
  document.querySelectorAll<HTMLButtonElement>("[data-suggestion]").forEach((button) => button.addEventListener("click", () => { const input = document.querySelector<HTMLTextAreaElement>("#chat-input"); if (input) { input.value = button.dataset.suggestion ?? ""; input.focus(); } }));
  document.querySelector<HTMLButtonElement>("#agent-tab")?.addEventListener("click", () => { state.activeTab = "agents"; saveState(); render(); });
  document.querySelector<HTMLButtonElement>("#brief-tab")?.addEventListener("click", () => { state.activeTab = "brief"; saveState(); render(); });
  document.querySelector<HTMLButtonElement>("#clear-context")?.addEventListener("click", () => { const session = activeSession(); if (!session) return; storeSession(updateAgentSessionContext(session, { ...session.context, fixedSourceIds: [], sourceTexts: {} }, new Date().toISOString())); render(); });
  document.querySelectorAll<HTMLButtonElement>("[data-jump-source]").forEach((button) => button.addEventListener("click", () => { const sourceId = button.dataset.jumpSource; if (sourceId) jumpToSource(sourceId); }));
  document.querySelectorAll<HTMLButtonElement>("[data-ocr-page]").forEach((button) => button.addEventListener("click", () => { const pn = Number(button.dataset.ocrPage); if (pn) void runOcr(pn); }));
  document.querySelector<HTMLButtonElement>("#refresh-brief")?.addEventListener("click", () => { const paper = activePaper(); if (paper) { paper.brief = makeBrief(paper.graph); saveState(); render(); } });
  document.querySelectorAll<HTMLInputElement>("#file-input, #welcome-file-input").forEach((input) => input.addEventListener("change", async () => { const file = input.files?.[0]; if (file) await importFile(file); }));
  document.querySelector<HTMLFormElement>("#chat-form")?.addEventListener("submit", (event) => { event.preventDefault(); void sendAgentPrompt(); });
  const reader = document.querySelector<HTMLElement>("#reader-scroll");
  reader?.addEventListener("scroll", () => {
    const paper = activePaper();
    if (!paper) return;
    const first = [...reader.querySelectorAll<HTMLElement>("[data-page-number]")].find((page) => page.getBoundingClientRect().bottom > reader.getBoundingClientRect().top + 24);
    if (first) {
      paper.view = updatePaperView(paper.view, { scrollAnchor: { pageNumber: Number(first.dataset.pageNumber), relativeOffset: Math.max(0, first.getBoundingClientRect().top - reader.getBoundingClientRect().top) } });
      saveState();
    }
  });
  document.querySelector<HTMLButtonElement>("#ink-pen")?.addEventListener("click", () => { inkTool = "pen"; render(); });
  document.querySelector<HTMLButtonElement>("#ink-highlighter")?.addEventListener("click", () => { inkTool = "highlighter"; render(); });
  document.querySelector<HTMLButtonElement>("#ink-eraser")?.addEventListener("click", () => { inkTool = "eraser"; render(); });
  document.querySelector<HTMLInputElement>("#ink-color")?.addEventListener("input", (event) => { inkColor = (event.target as HTMLInputElement).value; });
  document.querySelector<HTMLButtonElement>("#ink-clear-page")?.addEventListener("click", () => { const paper = activePaper(); if (!paper) return; const activePage = state.selectedPage ?? 1; state.inkStrokes = state.inkStrokes.filter((s) => !(s.documentId === paper.graph.documentId && s.pageNumber === activePage)); saveState(); render(); });
  document.querySelector<HTMLButtonElement>("#export-annotated")?.addEventListener("click", () => { void exportPageAsPng(); });
  document.querySelector<HTMLButtonElement>("#export-workspace")?.addEventListener("click", exportWorkspace);
  document.querySelector<HTMLInputElement>("#import-workspace")?.addEventListener("change", async (event) => { const file = (event.target as HTMLInputElement).files?.[0]; if (file) { await importWorkspace(file); (event.target as HTMLInputElement).value = ""; } });
  const divider = document.querySelector<HTMLElement>("#split-divider");
  const pane = document.querySelector<HTMLElement>("#split-pane");
  if (divider && pane) {
    let dragging = false;
    divider.addEventListener("pointerdown", (event) => { dragging = true; divider.classList.add("dragging"); event.preventDefault(); });
    document.addEventListener("pointermove", (event) => {
      if (!dragging || !pane) return;
      const ratio = Math.max(0.2, Math.min(0.85, (event.clientX - pane.getBoundingClientRect().left) / pane.getBoundingClientRect().width));
      state.splitRatio = ratio;
      const readerEl = pane.querySelector<HTMLElement>(".reader-panel");
      if (readerEl) readerEl.style.flex = `0 0 ${Math.round(ratio * 100)}%`;
    });
    document.addEventListener("pointerup", () => { if (dragging) { dragging = false; divider.classList.remove("dragging"); saveState(); } });
  }
}

function jumpToSource(sourceId: string): void {
  const paper = activePaper();
  if (!paper) return;
  const text = state.agentWorkspace.sessions
    .find((s) => s.sessionId === state.agentWorkspace.activeSessionId)
    ?.context.sourceTexts[sourceId];
  if (!text) return;
  for (const page of paper.graph.pages) {
    if (page.text.includes(text.slice(0, 20))) {
      const pageEl = document.querySelector(`[data-page-number="${page.pageNumber}"]`);
      if (pageEl) {
        pageEl.scrollIntoView({ behavior: "smooth", block: "start" });
        pageEl.classList.add("evidence-flash");
        setTimeout(() => pageEl.classList.remove("evidence-flash"), 2000);
      }
      return;
    }
  }
}
async function runOcr(pageNumber: number): Promise<void> {
  const paper = activePaper();
  if (!paper?.graph.blobHash) return;
  const page = paper.graph.pages[pageNumber - 1];
  if (!page) return;
  ocrProgress.set(page.pageId, "OCR running…");
  render();
  try {
    const bytes = await blobStore.get(paper.graph.blobHash);
    if (!bytes) throw new Error("PDF data not found");
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    const pdfPage = await doc.getPage(pageNumber);
    const viewport = pdfPage.getViewport({ scale: 2.0 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas not supported");
    await pdfPage.render({ canvasContext: ctx, viewport }).promise;
    const imageData = canvas.toDataURL("image/png");
    await doc.destroy();
    const worker = await createWorker("eng");
    ocrProgress.set(page.pageId, "Recognizing…");
    render();
    const result = await worker.recognize(imageData);
    const text = result.data.text.trim() || "OCR produced no readable text.";
    paper.graph.pages[pageNumber - 1] = { ...page, text, confidence: 0.75 };
    await worker.terminate();
    ocrProgress.delete(page.pageId);
  } catch (error) {
    ocrProgress.set(page.pageId, "OCR failed");
    console.error("OCR error:", error);
  }
  saveState();
  render();
}

async function exportWorkspace(): Promise<void> {
  const blobs: Record<string, string> = {};
  for (const paper of state.papers) {
    if (paper.graph.blobHash) {
      const bytes = await blobStore.get(paper.graph.blobHash);
      if (bytes) blobs[paper.graph.blobHash] = btoa(String.fromCharCode(...bytes));
    }
  }
  const payload = { format: "paperwitha.v1" as const, exportedAt: new Date().toISOString(), blobs, state };
  const json = JSON.stringify(payload);
  const fileBlob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(fileBlob);
  const a = document.createElement("a");
  a.href = url; a.download = `paperwitha-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  URL.revokeObjectURL(url);
}

async function importWorkspace(file: File): Promise<void> {
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    if (payload.format !== "paperwitha.v1") throw new Error("not a valid paperwitha export");
    const imported = payload.state as AppState;
    if (payload.blobs) {
      for (const [hash, b64] of Object.entries(payload.blobs as Record<string, string>)) {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        await blobStore.put(bytes);
      }
    }
    if (imported.papers) state.papers = imported.papers;
    if (imported.agentWorkspace) state.agentWorkspace = imported.agentWorkspace;
    if (imported.inkStrokes) state.inkStrokes = imported.inkStrokes;
    state.selectedText = ""; state.selectedPage = null;
    saveState(); render();
    window.alert(`Imported ${state.papers.length} paper(s), ${state.agentWorkspace.sessions.length} session(s).`);
  } catch (error) { window.alert(`Import failed: ${error instanceof Error ? error.message : String(error)}`); }
}

function updateSelectionToolbar() {
  selectionToolbar?.remove();
  selectionToolbar = null;
  const selection = window.getSelection();
  const text = selection?.toString().trim() ?? "";
  if (!text || !selection?.anchorNode || !document.querySelector(".reader-panel")?.contains(selection.anchorNode)) return;
  state.selectedText = text;
  const page = (selection.anchorNode.parentElement?.closest("[data-page-number]") as HTMLElement | null)?.dataset.pageNumber;
  state.selectedPage = page ? Number(page) : null;
  const range = selection.getRangeAt(0).getBoundingClientRect();
  selectionToolbar = document.createElement("div");
  selectionToolbar.className = "selection-toolbar";
  selectionToolbar.style.left = `${Math.min(window.innerWidth - 250, Math.max(12, range.left))}px`;
  selectionToolbar.style.top = `${Math.max(12, range.top - 48)}px`;
  selectionToolbar.innerHTML = `<span>${text.length} chars</span><button data-action="context">Add context</button><button data-action="annotate">Annotate</button><button data-action="ask">Ask</button>`;
  document.body.append(selectionToolbar);
  selectionToolbar.querySelector('[data-action="context"]')?.addEventListener("click", () => { const paper = activePaper(); if (paper) { addSelectionToSession(paper, text); state.selectedText = ""; render(); } });
  selectionToolbar.querySelector('[data-action="annotate"]')?.addEventListener("click", () => annotateSelection(text));
  selectionToolbar.querySelector('[data-action="ask"]')?.addEventListener("click", () => { const paper = activePaper(); if (!paper) return; addSelectionToSession(paper, text); state.activeTab = "agents"; state.assistantOpen = true; state.selectedText = ""; saveState(); render(); document.querySelector<HTMLTextAreaElement>("#chat-input")?.focus(); });
}

function annotateSelection(text: string) {
  const paper = activePaper();
  const pageNumber = state.selectedPage;
  if (!paper || !pageNumber) return;
  const page = paper.graph.pages[pageNumber - 1];
  if (!page) return;
  const startOffset = Math.max(0, page.text.indexOf(text));
  const endOffset = Math.min(page.text.length, startOffset + text.length);
  if (endOffset <= 0 || startOffset >= page.text.length) return;
  const anchor = createCrossPageAnchor(paper.graph, { documentVersionId: paper.graph.documentVersionId, startPage: pageNumber, endPage: pageNumber, startOffset, endOffset });
  const note = window.prompt("Add a note to this evidence", "") ?? "";
  paper.annotations.push(createAnnotation(uid("annotation"), anchor, text, note));
  addSelectionToSession(paper, text);
  state.selectedText = "";
  saveState();
  render();
}

function replaceCapturedSession(session: AgentSession) {
  state.agentWorkspace = replaceAgentSession(state.agentWorkspace, session);
}

async function sendAgentPrompt() {
  const paper = activePaper();
  const input = document.querySelector<HTMLTextAreaElement>("#chat-input");
  if (!paper || !input?.value.trim()) return;
  let session = ensureActiveSession(paper);
  const prompt = input.value.trim();
  const sources = sourcesForSession(session);
  const contextSet: ContextSet = {
    documents: session.context.documentIds,
    fixedSourceIds: session.context.fixedSourceIds,
    query: prompt,
    retrievalVersion: session.context.retrievalVersion,
  };
  const result = buildContext(contextSet, sources, 900);
  const now = new Date().toISOString();
  const runId = uid("run");
  const userMessage: AgentMessage = { messageId: uid("message"), role: "user", text: prompt, createdAt: now, runId };
  const assistantMessageId = uid("message");
  const priorMessages = activeAgentBranch(session).messages;
  session = startAgentRun(session, {
    runId,
    model: providerConfig?.model ?? null,
    now,
    snapshot: {
      snapshotId: uid("snapshot"),
      documentIds: [...session.context.documentIds],
      fixedSourceIds: [...session.context.fixedSourceIds],
      selectedSourceIds: [...result.selectedSourceIds],
      omittedSourceIds: [...result.omittedSourceIds],
      query: prompt,
      retrievalVersion: session.context.retrievalVersion,
      tokenCount: result.tokenCount,
      createdAt: now,
    },
  });
  session = appendAgentMessage(session, userMessage);
  session = appendAgentMessage(session, { messageId: assistantMessageId, role: "assistant", text: "", createdAt: now, runId });
  replaceCapturedSession(session);
  state.selectedText = "";
  saveState();
  render();

  const updateVisibleMessage = (text: string) => {
    if (state.agentWorkspace.activeSessionId !== session.sessionId) return;
    const node = document.querySelector<HTMLElement>(`[data-message-id="${assistantMessageId}"] p`);
    if (node) node.textContent = text;
  };

  try {
    let answer = "";
    if (providerConfig?.enabled) {
      const url = new URL(providerConfig.endpoint);
      const client = new ProviderClient({
        providerId: "web-session-provider",
        manifestVersion: "1",
        apiVersion: "paperwitha.provider.v1",
        transport: "sse",
        endpoint: providerConfig.endpoint,
        allowedDomains: [url.hostname],
        authentication: { scheme: providerConfig.apiKey ? "api-key" : "none" },
        requestMapping: { kind: "json-pointer", path: "" },
        responseMapping: { kind: "json-pointer", path: "/delta" },
      }, providerConfig.apiKey ? { credential: providerConfig.apiKey } : {});
      const providerMessages = [...priorMessages, userMessage].map((message) => ({ role: message.role, content: message.text }));
      for await (const event of client.streamChat({ model: providerConfig.model, messages: providerMessages })) {
        if (event.kind !== "delta") continue;
        answer += event.text;
        const eventTime = new Date().toISOString();
        session = appendAgentEvent(session, runId, { eventId: uid("event"), kind: "assistant-text-delta", payload: { text: event.text }, createdAt: eventTime });
        session = updateAgentMessage(session, assistantMessageId, answer, eventTime);
        replaceCapturedSession(session);
        updateVisibleMessage(answer);
      }
    } else {
      answer = result.status === "budget_exceeded"
        ? "The fixed evidence is larger than this session's local context budget. Remove or narrow fixed sources and try again."
        : answerFor(prompt, session, result, sources);
      const eventTime = new Date().toISOString();
      session = appendAgentEvent(session, runId, { eventId: uid("event"), kind: "assistant-text-delta", payload: { text: answer }, createdAt: eventTime });
      session = updateAgentMessage(session, assistantMessageId, answer, eventTime);
      replaceCapturedSession(session);
      updateVisibleMessage(answer);
    }
    const finishedAt = new Date().toISOString();
    session = appendAgentEvent(session, runId, { eventId: uid("event"), kind: "run-completed", payload: null, createdAt: finishedAt });
    session = finishAgentRun(session, runId, { status: "completed", now: finishedAt });
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const message = `Agent request failed: ${error instanceof Error ? error.message : String(error)}`;
    session = updateAgentMessage(session, assistantMessageId, message, finishedAt);
    session = appendAgentEvent(session, runId, { eventId: uid("event"), kind: "run-failed", payload: { message }, createdAt: finishedAt });
    session = finishAgentRun(session, runId, { status: "failed", now: finishedAt, error: message });
    updateVisibleMessage(message);
  }
  replaceCapturedSession(session);
  saveState();
  if (state.agentWorkspace.activeSessionId === session.sessionId) {
    render();
    document.querySelector<HTMLElement>("#chat-messages")?.scrollTo({ top: 99999, behavior: "smooth" });
  }
}



function scheduleInkSetup(): void {
  setTimeout(() => { setupInkEvents(); renderPersistedInk(); }, 100);
}


async function exportPageAsPng(): Promise<void> {
  const paper = activePaper();
  if (!paper?.graph.blobHash) { window.alert("No PDF with ink annotations to export."); return; }
  try {
    const bytes = await blobStore.get(paper.graph.blobHash);
    if (!bytes) { window.alert("PDF data not found."); return; }
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    const pageNumber = state.selectedPage ?? 1;
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) { await doc.destroy(); window.alert("Canvas not supported."); return; }
    await page.render({ canvasContext: ctx, viewport }).promise;
    for (const stroke of state.inkStrokes) {
      if (stroke.deletedAt || stroke.pageNumber !== pageNumber || stroke.documentId !== paper.graph.documentId) continue;
      if (stroke.points.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0]!.x * viewport.width, stroke.points[0]!.y * viewport.height);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i]!.x * viewport.width, stroke.points[i]!.y * viewport.height);
      }
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width * 400;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalAlpha = stroke.tool === "highlighter" ? 0.4 : 1;
      ctx.stroke();
    }
    await doc.destroy();
    const anchor = document.createElement("a");
    anchor.href = canvas.toDataURL("image/png");
    anchor.download = `${paper.title.replace(/[^a-zA-Z0-9]/g, "_")}_page${pageNumber}_annotated.png`;
    anchor.click();
  } catch (error) {
    window.alert(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function renderPersistedInk(): void {
  const paper = activePaper();
  if (!paper?.graph.blobHash) return;
  const pageNumbers = new Set<string>();
  document.querySelectorAll<HTMLCanvasElement>(".ink-canvas").forEach((canvas) => {
    const pn = canvas.dataset.pageNumber;
    if (pn) pageNumbers.add(pn);
  });
  pageNumbers.forEach((pn) => renderInkForPage(Number(pn)));
}
function setupInkEvents(): void {
  const reader = document.querySelector(".reader-scroll");
  if (!reader) return;
  reader.style.touchAction = "none";
  reader.addEventListener("pointerdown", onInkPointerDown);
  reader.addEventListener("pointermove", onInkPointerMove);
  reader.addEventListener("pointerup", onInkPointerUp);
}

function onInkPointerDown(event: PointerEvent): void {
  const target = event.target as HTMLElement;
  const canvas = target.closest?.(".ink-canvas") as HTMLCanvasElement | null;
  if (!canvas) return;
  event.preventDefault();
  if (inkTool === "eraser") {
    const paper = activePaper();
    if (!paper) return;
    const pageNumber = Number(canvas.dataset.pageNumber ?? "0");
    const norm = canvasToNormalized(event.offsetX, event.offsetY, canvas.offsetWidth, canvas.offsetHeight);
    const threshold = 0.03;
    const now = new Date().toISOString();
    const toErase = state.inkStrokes.filter((s) =>
      s.documentId === paper.graph.documentId && s.pageNumber === pageNumber && !s.deletedAt &&
      s.points.some((p) => Math.hypot(p.x - norm.x, p.y - norm.y) < threshold)
    );
    if (toErase.length) {
      state.inkStrokes = state.inkStrokes.map((s) => toErase.includes(s) ? { ...s, deletedAt: now } : s);
      saveState();
      renderPersistedInk();
    }
    return;
  }
  canvas.setPointerCapture(event.pointerId);
  const pageNumber = Number(canvas.dataset.pageNumber ?? "0");
  if (!pageNumber) return;
  activeInkStroke = { points: [], canvasEl: canvas, pageNumber, pageWidth: canvas.offsetWidth, pageHeight: canvas.offsetHeight };
  const norm = canvasToNormalized(event.offsetX, event.offsetY, canvas.offsetWidth, canvas.offsetHeight);
  activeInkStroke.points.push({ x: norm.x, y: norm.y, pressure: event.pressure, timestampMs: Date.now() });
}


function onInkPointerMove(event: PointerEvent): void {
  if (!activeInkStroke) return;
  event.preventDefault();
  const canvas = activeInkStroke.canvasEl;
  if (!canvas) return;
  const norm = canvasToNormalized(event.offsetX, event.offsetY, canvas.offsetWidth, canvas.offsetHeight);
  activeInkStroke.points.push({ x: norm.x, y: norm.y, pressure: event.pressure, timestampMs: Date.now() });
  drawInkPreview(canvas, activeInkStroke.points);
}
function onInkPointerUp(event: PointerEvent): void {
  if (!activeInkStroke) return;
  event.preventDefault();
  const canvas = activeInkStroke.canvasEl;
  if (canvas) drawInkPreview(canvas, activeInkStroke.points);
  const paper = activePaper();
  if (paper && activeInkStroke.points.length >= 2) {
    const stroke = createInkStroke({
      strokeId: uid("ink"),
      documentId: paper.graph.documentId,
      documentVersionId: paper.graph.documentVersionId,
      pageNumber: activeInkStroke.pageNumber,
      tool: inkTool,
      color: inkTool === "highlighter" ? `${inkColor}66` : inkColor,
      width: inkTool === "highlighter" ? inkWidth * 3 : inkWidth,
      points: activeInkStroke.points,
      now: new Date().toISOString(),
    });
    state.inkStrokes = [...state.inkStrokes, stroke];
    saveState();
  }
  activeInkStroke = null;
}

function drawInkPreview(canvas: HTMLCanvasElement, points: ReadonlyArray<{ x: number; y: number }>): void {
  const pdfCanvas = canvas.parentElement?.querySelector(".pdf-canvas") as HTMLCanvasElement | null;
  const w = pdfCanvas?.width ?? canvas.offsetWidth;
  const h = pdfCanvas?.height ?? canvas.offsetHeight;
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = "100%";
  canvas.style.height = "auto";
  const ctx = canvas.getContext("2d");
  if (!ctx || points.length < 2) return;
  ctx.clearRect(0, 0, w, h);
  ctx.beginPath();
  const first = points[0]!;
  ctx.moveTo(first.x * w, first.y * h);
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    ctx.lineTo(p.x * w, p.y * h);
  }
  ctx.strokeStyle = inkTool === "highlighter" ? `${inkColor}66` : inkColor;
  ctx.lineWidth = inkTool === "highlighter" ? inkWidth * 300 : inkWidth * 200;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = inkTool === "highlighter" ? 0.4 : 1;
  ctx.stroke();
}

function renderInkForPage(pageNumber: number): void {
  const paper = activePaper();
  if (!paper) return;
  const canvas = document.querySelector<HTMLCanvasElement>(`#ink-canvas-${pageNumber}`);
  if (!canvas) return;
  const pdfCanvas = (canvas.parentElement?.querySelector(".pdf-canvas") as HTMLCanvasElement | null);
  const w = pdfCanvas?.width ?? canvas.offsetWidth;
  const h = pdfCanvas?.height ?? canvas.offsetHeight;
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = "100%";
  canvas.style.height = "auto";
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  for (const stroke of state.inkStrokes) {
    if (stroke.deletedAt || stroke.pageNumber !== pageNumber || stroke.documentId !== paper.graph.documentId) continue;
    if (stroke.points.length < 2) continue;
    ctx.beginPath();
    const fp = stroke.points[0]!;
    ctx.moveTo(fp.x * w, fp.y * h);
    for (let i = 1; i < stroke.points.length; i++) {
      const p = stroke.points[i]!;
      ctx.lineTo(p.x * w, p.y * h);
    }
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width * 200;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = stroke.tool === "highlighter" ? 0.4 : 1;
    ctx.stroke();
  }
}
document.addEventListener("selectionchange", updateSelectionToolbar);
render();
setupInkEvents();
