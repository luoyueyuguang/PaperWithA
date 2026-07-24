import "./styles.css";
import { buildContext, type ContextSet, type ContextSource } from "@paperwitha/context";
import type { DocumentGraph, DocumentPage } from "@paperwitha/domain";
import { createCrossPageAnchor, createPaperViewState, updatePaperView, type PaperViewState } from "@paperwitha/reader-core";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { BrowserStoragePort, JsonRepository } from "@paperwitha/storage";
import { createAnnotation, type Annotation } from "@paperwitha/evidence";
import { ProviderClient } from "@paperwitha/ai-core";
import { HttpSyncPort } from "@paperwitha/sync";

type ChatRole = "user" | "assistant";
type ChatMessage = { id: string; role: ChatRole; text: string; createdAt: string };
type StoredPaper = {
  id: string;
  title: string;
  sourceName: string;
  graph: DocumentGraph;
  view: PaperViewState;
  chat: ChatMessage[];
  annotations: Annotation[];
  brief: string;
  addedAt: string;
};
type AppState = {
  papers: StoredPaper[];
  activePaperId: string | null;
  activeTab: "chat" | "brief";
  sidebarOpen: boolean;
  assistantOpen: boolean;
  selectedText: string;
  selectedPage: number | null;
  contextSourceIds: string[];
  contextTexts: Record<string, string>;
};
type ProviderConfig = { endpoint: string; model: string; apiKey: string; enabled: boolean };

const STORAGE_KEY = "paperwitha.web.v1";
const stateRepository = new JsonRepository<AppState>(new BrowserStoragePort(), STORAGE_KEY);
const app = document.querySelector<HTMLDivElement>("#app")!;
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
const emptyState = (): AppState => ({ papers: [], activePaperId: null, activeTab: "chat", sidebarOpen: true, assistantOpen: true, selectedText: "", selectedPage: null, contextSourceIds: [], contextTexts: {} });

const demoText = `Attention Is All You Need

Abstract
The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms. Experiments on two machine translation tasks show that these models are superior in quality while being more parallelizable and requiring significantly less time to train.

1 Introduction
Recurrent neural networks, long short-term memory and gated recurrent neural networks have been firmly established as state of the art approaches in sequence modeling and transduction problems such as language modeling and machine translation. The Transformer follows a different path: it relies entirely on attention to draw global dependencies between input and output.

2 Background
The goal of reducing sequential computation also forms the foundation of the Extended Neural GPU, ByteNet and ConvS2S. The Transformer achieves parallelization by using self-attention, connecting all positions in a sequence with a constant number of operations.

3 Model Architecture
The Transformer uses stacked self-attention and point-wise, fully connected layers for both the encoder and decoder. The encoder maps an input sequence of symbol representations to a sequence of continuous representations. The decoder generates an output sequence one symbol at a time.

4 Why Self-Attention
Self-attention, sometimes called intra-attention, is an attention mechanism relating different positions of a single sequence in order to compute a representation of the sequence. It is useful for discovering long-range dependencies and can be computed in parallel.`;

let state = loadState();
let providerConfig: ProviderConfig | null = null;
let syncEndpoint: string | null = null;
let syncCursor: number | null = null;
let syncStatus = "local";
let selectionToolbar: HTMLDivElement | null = null;

function loadState(): AppState {
  const parsed = stateRepository.read(emptyState());
  if (Array.isArray(parsed.papers)) return {
    ...parsed,
    papers: parsed.papers.map((paper) => ({ ...paper, annotations: paper.annotations ?? [] })),
    activeTab: parsed.activeTab ?? "chat",
    sidebarOpen: parsed.sidebarOpen ?? true,
    assistantOpen: parsed.assistantOpen ?? true,
    selectedText: "",
    selectedPage: null,
    contextSourceIds: parsed.contextSourceIds ?? [],
    contextTexts: parsed.contextTexts ?? {},
  };
  return emptyState();
}

function saveState() {
  stateRepository.write(state);
}

function activePaper(): StoredPaper | null {
  return state.papers.find((paper) => paper.id === state.activePaperId) ?? state.papers[0] ?? null;
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
  if (file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf") {
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages: DocumentPage[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ").trim();
      pages.push({ pageId: `${documentId}:page:${pageNumber}`, pageNumber, text: text || "This page has no text layer. Use OCR in a future pass.", confidence: text ? 0.98 : 0.2 });
    }
    await document.destroy();
    return { graphId: uid("graph"), documentId, documentVersionId: `${documentId}:v1`, pages };
  }
  return { graphId: uid("graph"), documentId, documentVersionId: `${documentId}:v1`, pages: splitTextIntoPages(await file.text()) };
}

function makePaper(title: string, sourceName: string, graph: DocumentGraph): StoredPaper {
  const id = uid("paper");
  const view = createPaperViewState(uid("view"), graph.documentId, graph.documentVersionId);
  return { id, title, sourceName, graph, view, chat: [], annotations: [], brief: makeBrief(graph), addedAt: new Date().toISOString() };
}

function makeBrief(graph: DocumentGraph): string {
  const text = graph.pages.slice(0, 3).map((page) => page.text).join(" ").replace(/\s+/g, " ").trim();
  if (!text) return "No readable text is available for a brief yet.";
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 4);
  return sentences.join(" ");
}

function createDemoPaper() {
  const documentId = uid("demo-document");
  const pages = splitTextIntoPages(demoText).map((page, index) => ({ ...page, pageId: `${documentId}:page:${index + 1}` }));
  const graph: DocumentGraph = { graphId: uid("graph"), documentId, documentVersionId: `${documentId}:v1`, pages };
  const paper = makePaper("Attention Is All You Need", "demo-paper.txt", graph);
  state.papers = [paper, ...state.papers];
  state.activePaperId = paper.id;
  state.contextSourceIds = [];
  saveState();
  render();
}

function addPaper(paper: StoredPaper) {
  state.papers = [paper, ...state.papers.filter((candidate) => candidate.graph.documentId !== paper.graph.documentId)];
  state.activePaperId = paper.id;
  state.selectedText = "";
  state.selectedPage = null;
  state.contextSourceIds = [];
  saveState();
  render();
}

function sourcesForPaper(paper: StoredPaper): ContextSource[] {
  const pageSources = paper.graph.pages.map((page) => ({ sourceId: `${paper.id}:page:${page.pageNumber}`, documentId: paper.graph.documentId, text: page.text }));
  const persistedSources = state.contextSourceIds
    .filter((sourceId) => sourceId.startsWith(`${paper.id}:`))
    .map((sourceId) => ({ sourceId, documentId: paper.graph.documentId, text: state.contextTexts[sourceId] ?? "" }))
    .filter((source) => source.text.length > 0);
  const selectionId = `${paper.id}:selection`;
  if (state.selectedText && !state.contextSourceIds.includes(selectionId)) persistedSources.unshift({ sourceId: selectionId, documentId: paper.graph.documentId, text: state.selectedText });
  return [...persistedSources, ...pageSources];
}

function answerFor(prompt: string, paper: StoredPaper, result: ReturnType<typeof buildContext>, sources: ContextSource[]): string {
  const selected = sources.filter((source) => result.selectedSourceIds.includes(source.sourceId));
  const excerpt = selected.map((source) => source.text).join(" ").replace(/\s+/g, " ").slice(0, 480);
  const scope = state.selectedText ? "the selected passage" : `${result.selectedSourceIds.length} paper source${result.selectedSourceIds.length === 1 ? "" : "s"}`;
  return `Local reading assistant (no network request): I used ${scope} from “${paper.title}”. ${prompt.trim() ? `For “${prompt.trim()}”, the relevant evidence begins: “${excerpt}”` : `The current evidence begins: “${excerpt}”`}`;
}

function render() {
  selectionToolbar?.remove();
  selectionToolbar = null;
  const paper = activePaper();
  app.innerHTML = `
    <div class="app-shell ${state.sidebarOpen ? "sidebar-open" : "sidebar-closed"} ${state.assistantOpen ? "assistant-open" : "assistant-closed"}">
      <header class="topbar">
        <button class="brand" id="home-button" aria-label="PaperWithA home"><span class="brand-mark">P</span><span>PaperWithA</span></button>
        <div class="topbar-actions"><label class="import-button"><input id="file-input" type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" hidden />Import paper</label><button class="icon-button" id="add-demo" title="Load a demo paper">+</button><button class="sync-button" id="sync-button" title="Sync local workspace">↻ ${escapeHtml(syncStatus)}</button><button class="avatar ${providerConfig ? "provider-active" : ""}" id="provider-settings" title="Configure AI provider">${providerConfig ? "AI" : "L"}</button></div>
      </header>
      <div class="shell-body">
        <aside class="sidebar">
          <div class="sidebar-heading"><span>Library</span><span class="count">${state.papers.length}</span></div>
          <button class="demo-card" id="add-demo-card"><span class="demo-icon">✦</span><span><strong>Try the demo paper</strong><small>Explore without uploading</small></span></button>
          <div class="library-list">${state.papers.length ? state.papers.map((candidate) => `<button class="paper-item ${candidate.id === paper?.id ? "active" : ""}" data-paper-id="${candidate.id}"><span class="paper-icon">▤</span><span class="paper-item-copy"><strong>${escapeHtml(candidate.title)}</strong><small>${escapeHtml(candidate.sourceName)} · ${candidate.graph.pages.length} pages</small></span></button>`).join("") : `<div class="empty-library"><div class="empty-icon">⌁</div><strong>Your library is empty</strong><p>Import a PDF or start with the demo paper.</p></div>`}</div>
          ${state.papers.length ? `<button class="clear-library" id="clear-library">Clear local library</button>` : ""}
        </aside>
        <main class="main-area">
          <div class="workspace-toolbar"><div class="crumb">Library <span>/</span> <strong>${paper ? escapeHtml(paper.title) : "Welcome"}</strong></div><div class="toolbar-actions">${paper ? `<span class="saved-state">● Saved locally</span><button class="ghost-button" id="toggle-assistant">${state.assistantOpen ? "Hide assistant" : "Show assistant"}</button>` : ""}<button class="ghost-button" id="toggle-sidebar">${state.sidebarOpen ? "Hide library" : "Show library"}</button></div></div>
          ${paper ? renderWorkspace(paper) : renderWelcome()}
        </main>
      </div>
    </div>`;
  bindEvents();
}

function renderWelcome() {
  return `<section class="welcome"><div class="welcome-glow"></div><span class="eyebrow">LOCAL-FIRST RESEARCH WORKSPACE</span><h1>Read deeply.<br /><em>Think with evidence.</em></h1><p>Bring a paper into a calm workspace for continuous reading, selected-text questions, and a local research brief.</p><div class="welcome-actions"><label class="primary-button"><input id="welcome-file-input" type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" hidden />Import a paper <span>↗</span></label><button class="secondary-button" id="welcome-demo">Open the demo <span>→</span></button></div><div class="feature-row"><span><b>01</b> Continuous reading</span><span><b>02</b> Explicit context</span><span><b>03</b> Local by default</span></div></section>`;
}

function renderWorkspace(paper: StoredPaper) {
  const pages = paper.graph.pages.map((page) => { const annotationCount = paper.annotations.filter((annotation) => annotation.anchor.pageId === page.pageId).length; return `<article class="paper-page" data-page-number="${page.pageNumber}"><div class="page-label">${String(page.pageNumber).padStart(2, "0")} <span>${page.confidence && page.confidence < 0.5 ? "page-only fallback" : ""}</span>${annotationCount ? `<b class="annotation-badge">${annotationCount} note${annotationCount === 1 ? "" : "s"}</b>` : ""}</div><div class="page-text">${escapeHtml(page.text).split("\n").map((line) => line.trim() ? `<p>${escapeHtml(line)}</p>` : "").join("")}</div></article>`; }).join("");
  const selectionId = `${paper.id}:selection`;
  const contextCount = state.contextSourceIds.filter((sourceId) => sourceId.startsWith(`${paper.id}:`)).length + (state.selectedText && !state.contextSourceIds.includes(selectionId) ? 1 : 0);
  return `<div class="workspace-grid"><section class="reader-panel"><div class="reader-header"><div><span class="eyebrow">DOCUMENT READER</span><h2>${escapeHtml(paper.title)}</h2></div><div class="reader-meta"><span>${paper.graph.pages.length} pages</span><span>Zoom ${Math.round(paper.view.zoom * 100)}%</span></div></div><div class="reader-scroll" id="reader-scroll">${pages}</div></section>${state.assistantOpen ? `<aside class="assistant-panel"><div class="assistant-tabs"><button class="tab ${state.activeTab === "chat" ? "active" : ""}" id="chat-tab">Chat</button><button class="tab ${state.activeTab === "brief" ? "active" : ""}" id="brief-tab">Reading Brief</button></div>${state.activeTab === "chat" ? renderChat(paper, contextCount) : renderBrief(paper)}</aside>` : ""}</div>`;
}

function renderChat(paper: StoredPaper, contextCount: number) {
  const messages = paper.chat.length ? paper.chat.map((message) => `<div class="message ${message.role}"><div class="message-label">${message.role === "user" ? "You" : "Assistant"}</div><p>${escapeHtml(message.text)}</p></div>`).join("") : `<div class="chat-empty"><div class="assistant-orb">✦</div><h3>Ask your paper anything</h3><p>Select text in the reader or ask a question. Only sources you explicitly add become context.</p><div class="suggestions"><button data-suggestion="What is the main contribution?">Main contribution</button><button data-suggestion="What evidence supports the claim?">Evidence</button></div></div>`;
  return `<div class="context-strip"><span class="context-dot"></span><span>${contextCount ? `${contextCount} source${contextCount === 1 ? "" : "s"} in context` : "No sources in context"}</span><button id="clear-context">Clear</button></div><div class="chat-messages" id="chat-messages">${messages}</div><form class="chat-form" id="chat-form"><textarea id="chat-input" rows="2" placeholder="Ask about this paper…"></textarea><div class="chat-form-footer"><span>Local assistant · no network</span><button class="send-button" type="submit">Send ↗</button></div></form>`;
}

function renderBrief(paper: StoredPaper) {
  return `<div class="brief-content"><span class="eyebrow">STRUCTURED OUTPUT</span><h3>Reading Brief</h3><p class="brief-intro">A compact starting point generated from the first three pages. It remains editable in your local workspace.</p><div class="brief-section"><span>CORE SUMMARY</span><p>${escapeHtml(paper.brief)}</p></div><div class="brief-section"><span>RESEARCH STATE</span><p><strong>Source:</strong> ${escapeHtml(paper.sourceName)}<br /><strong>Version:</strong> ${escapeHtml(paper.graph.documentVersionId)}<br /><strong>Evidence:</strong> ${paper.graph.pages.length} page sources available</p></div><button class="secondary-button full-width" id="refresh-brief">Regenerate from first pages</button></div>`;
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

async function syncWorkspace() {
  const endpoint = syncEndpoint ?? "http://127.0.0.1:8787";
  if (!endpoint) return;
  syncEndpoint = endpoint;
  syncStatus = "syncing";
  render();
  try {
    const port = new HttpSyncPort(endpoint);
    const result = await port.push([{ operationId: uid("sync"), actorId: "local-user", deviceId: "web-browser", entityType: "workspace", entityId: "paperwitha.web.v1", baseRevision: null, payload: { papers: state.papers, activePaperId: state.activePaperId }, createdAt: new Date().toISOString() }]);
    const pulled = await port.pull(syncCursor);
    syncCursor = pulled.cursor;
    syncStatus = result.every((item) => item.status === "accepted" || item.status === "duplicate") ? "synced" : "conflict";
  } catch (error) {
    syncStatus = "offline";
    window.alert(`Sync failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  render();
}

function bindEvents() {
  document.querySelector<HTMLButtonElement>("#home-button")?.addEventListener("click", () => { state.activePaperId = null; saveState(); render(); });
  document.querySelector<HTMLButtonElement>("#provider-settings")?.addEventListener("click", configureProvider);
  document.querySelector<HTMLButtonElement>("#sync-button")?.addEventListener("click", () => { void syncWorkspace(); });
  document.querySelector<HTMLButtonElement>("#add-demo")?.addEventListener("click", createDemoPaper);
  document.querySelector<HTMLButtonElement>("#add-demo-card")?.addEventListener("click", createDemoPaper);
  document.querySelector<HTMLButtonElement>("#welcome-demo")?.addEventListener("click", createDemoPaper);
  document.querySelector<HTMLButtonElement>("#toggle-sidebar")?.addEventListener("click", () => { state.sidebarOpen = !state.sidebarOpen; saveState(); render(); });
  document.querySelector<HTMLButtonElement>("#toggle-assistant")?.addEventListener("click", () => { state.assistantOpen = !state.assistantOpen; saveState(); render(); });
  document.querySelector<HTMLButtonElement>("#clear-library")?.addEventListener("click", () => { if (window.confirm("Remove all papers from this browser?")) { state.papers = []; state.activePaperId = null; state.contextSourceIds = []; state.contextTexts = {}; saveState(); render(); } });
  document.querySelectorAll<HTMLButtonElement>("[data-paper-id]").forEach((button) => button.addEventListener("click", () => { state.activePaperId = button.dataset.paperId ?? null; state.selectedText = ""; state.contextSourceIds = []; saveState(); render(); }));
  document.querySelectorAll<HTMLButtonElement>("[data-suggestion]").forEach((button) => button.addEventListener("click", () => { const input = document.querySelector<HTMLTextAreaElement>("#chat-input"); if (input) { input.value = button.dataset.suggestion ?? ""; input.focus(); } }));
  document.querySelector<HTMLButtonElement>("#chat-tab")?.addEventListener("click", () => { state.activeTab = "chat"; render(); });
  document.querySelector<HTMLButtonElement>("#brief-tab")?.addEventListener("click", () => { state.activeTab = "brief"; render(); });
  document.querySelector<HTMLButtonElement>("#clear-context")?.addEventListener("click", () => { state.contextSourceIds = []; state.contextTexts = {}; state.selectedText = ""; saveState(); render(); });
  document.querySelector<HTMLButtonElement>("#refresh-brief")?.addEventListener("click", () => { const paper = activePaper(); if (paper) { paper.brief = makeBrief(paper.graph); saveState(); render(); } });
  document.querySelectorAll<HTMLInputElement>("#file-input, #welcome-file-input").forEach((input) => input.addEventListener("change", async () => { const file = input.files?.[0]; if (!file) return; await importFile(file); }));
  document.querySelector<HTMLFormElement>("#chat-form")?.addEventListener("submit", (event) => { event.preventDefault(); sendChat(); });
  const reader = document.querySelector<HTMLElement>("#reader-scroll");
  reader?.addEventListener("scroll", () => { const paper = activePaper(); if (!paper) return; const first = [...reader.querySelectorAll<HTMLElement>("[data-page-number]")].find((page) => page.getBoundingClientRect().bottom > reader.getBoundingClientRect().top + 24); if (first) { paper.view = updatePaperView(paper.view, { scrollAnchor: { pageNumber: Number(first.dataset.pageNumber), relativeOffset: Math.max(0, first.getBoundingClientRect().top - reader.getBoundingClientRect().top) } }); saveState(); } });
}

async function importFile(file: File) {
  try {
    const graph = await parseFile(file);
    addPaper(makePaper(file.name.replace(/\.[^.]+$/, ""), file.name, graph));
  } catch (error) {
    window.alert(`Could not read this paper: ${error instanceof Error ? error.message : String(error)}`);
  }
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
  selectionToolbar.querySelector('[data-action="context"]')?.addEventListener("click", () => { const paper = activePaper(); if (paper) { const sourceId = `${paper.id}:selection`; state.contextSourceIds = [...new Set([...state.contextSourceIds, sourceId])]; state.contextTexts[sourceId] = text; saveState(); render(); } });
  selectionToolbar.querySelector('[data-action="annotate"]')?.addEventListener("click", () => annotateSelection(text));
  selectionToolbar.querySelector('[data-action="ask"]')?.addEventListener("click", () => { state.activeTab = "chat"; state.assistantOpen = true; saveState(); render(); document.querySelector<HTMLTextAreaElement>("#chat-input")?.focus(); });

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
  const sourceId = `${paper.id}:selection`;
  state.contextSourceIds = [...new Set([...state.contextSourceIds, sourceId])];
  state.contextTexts[sourceId] = text;
  state.selectedText = "";
  saveState();
  render();
}

async function sendChat() {
  const paper = activePaper();
  const input = document.querySelector<HTMLTextAreaElement>("#chat-input");
  if (!paper || !input?.value.trim()) return;
  const prompt = input.value.trim();
  const baseSources = sourcesForPaper(paper);
  const contextSet: ContextSet = { documents: [paper.graph.documentId], fixedSourceIds: state.contextSourceIds, query: prompt, retrievalVersion: "local-lexical-v1" };
  const result = buildContext(contextSet, baseSources, 900);
  const userMessage: ChatMessage = { id: uid("message"), role: "user", text: prompt, createdAt: new Date().toISOString() };
  const assistantMessage: ChatMessage = { id: uid("message"), role: "assistant", text: "", createdAt: new Date().toISOString() };
  paper.chat.push(userMessage, assistantMessage);
  state.selectedText = "";
  saveState();
  render();
  const assistantNode = () => document.querySelector<HTMLElement>(".message.assistant:last-child p");
  try {
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
      for await (const event of client.streamChat({ model: providerConfig.model, messages: paper.chat.map((message) => ({ role: message.role, content: message.text })) })) {
        if (event.kind === "delta") { assistantMessage.text += event.text; if (assistantNode()) assistantNode()!.textContent = assistantMessage.text; }
      }
    } else {
      assistantMessage.text = result.status === "budget_exceeded" ? "The selected evidence is larger than the local context budget. Narrow the selection and try again." : answerFor(prompt, paper, result, baseSources);
      if (assistantNode()) assistantNode()!.textContent = assistantMessage.text;
    }
  } catch (error) {
    assistantMessage.text = `Provider request failed: ${error instanceof Error ? error.message : String(error)}`;
    if (assistantNode()) assistantNode()!.textContent = assistantMessage.text;
  }
  saveState();
  document.querySelector<HTMLElement>("#chat-messages")?.scrollTo({ top: 99999, behavior: "smooth" });
}

document.addEventListener("selectionchange", updateSelectionToolbar);
render();
