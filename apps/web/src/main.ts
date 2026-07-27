import "./styles.css";
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
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { createWorker } from "tesseract.js";
import { BrowserStoragePort, JsonRepository, StoragePortBlobStore } from "@paperwitha/storage";
import type { Terminal as XtermTerminal } from "xterm";
import type { FitAddon as XtermFitAddon } from "@xterm/addon-fit";

var term: XtermTerminal | null = null;
var termFit: XtermFitAddon | null = null;
var termWs: WebSocket | null = null;

async function initShell(): Promise<void> {
  var container = document.querySelector<HTMLElement>("#xterm-container");
  console.log("[term] initShell, container:", !!container);
  if (!container) return;

  var [{ Terminal }, { FitAddon }] = await Promise.all([
    import("xterm"),
    import("@xterm/addon-fit"),
  ]);

  term = new Terminal({
    fontSize: 13,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    theme: { background: "#0a101d", foreground: "#c8d4e6", cursor: "#c9f269" },
    cursorBlink: true,
  });
  term.loadAddon(termFit);
  term.open(container);
  requestAnimationFrame(() => { termFit?.fit(); });

  function connect() {
    if (termWs) { try { termWs.close(); } catch {} }
    termWs = new WebSocket("ws://localhost:4121");
    termWs.onopen = function () { termWs?.send("\n"); };
    termWs.onmessage = function (e) { term?.write(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data as ArrayBuffer)); };
    termWs.onclose = function () { setTimeout(connect, 2000); };
    termWs.onerror = function () { setTimeout(connect, 2000); };
  }

  term.onData(function (data: string) {
    if (termWs?.readyState === WebSocket.OPEN) termWs.send(data);
  });

  connect();

  new ResizeObserver(function () { try { termFit?.fit(); } catch {} }).observe(container);
}


import { ProviderClient } from "@paperwitha/ai-core";
import { createInkStroke } from "@paperwitha/domain";
import {
  state, app, uid, escapeHtml, saveState,
  activePaper, activeSession, storeSession, createSessionForPaper, ensureActiveSession,
  addPaper, replaceCapturedSession, demoText,
  runtimeMeta, agentMeta, emptyState,
  blobStore, textItemCache,
  inkStrokes, inkTool, inkColor, inkWidth, activeInkStroke,
  ocrProgress,
  providerConfig, selectionToolbar,
  setProviderConfig, setSelectionToolbar, setInkTool, setInkColor, setActiveInkStroke,
  RUNTIME_PROFILES, AGENT_PROFILES,
  LOCAL_RUNTIME_PROFILE_ID, LOCAL_AGENT_PROFILE_ID, STORAGE_KEY,
  type StoredPaper, type AppState, type PersistedState, type ProviderConfig,
  type RuntimeProfileMeta, type AgentProfileMeta,
} from "./state.js";

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
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.5 });
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

async function importFile(file: File): Promise<void> {
  try {
    const graph = await parseFile(file);
    const title = file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
    addPaper(makePaper(title, file.name, graph));
    render();
  } catch (error) {
    console.error("Import failed:", error);
    window.alert(`Failed to import paper: ${error instanceof Error ? error.message : String(error)}`);
  }
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
  setSelectionToolbar(null);
  const paper = activePaper();
  app.innerHTML = `
    <div class="app-shell ${state.sidebarOpen ? "sidebar-open" : "sidebar-closed"} ${state.assistantOpen ? "assistant-open" : "assistant-closed"}">
      <div class="shell-body">
        <aside class="sidebar">
          <div class="sidebar-heading">
            <span class="brand-mark">P</span>
            <span>LIBRARY</span>
            <strong>${state.papers.length}</strong>
            <div class="sidebar-tools">
              <label class="import-button" title="Import paper"><input id="file-input" type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" hidden />Import</label>
              <button class="icon-button" id="toggle-assistant" title="${state.assistantOpen ? "Hide terminal" : "Show terminal"}">${state.assistantOpen ? "▾" : "▸"}</button>
              <button class="avatar ${providerConfig ? "provider-active" : ""}" id="provider-settings" title="Configure AI provider">${providerConfig ? "AI" : "L"}</button>
            </div>
          </div>
          <button class="demo-card" id="add-demo-card"><span class="demo-icon">✦</span><span><strong>Try the demo paper</strong><small>Explore without uploading</small></span></button>
          <div class="library-list">${state.papers.length ? state.papers.map((candidate) => `<div class="paper-item ${candidate.id === paper?.id ? "active" : ""}" data-paper-id="${candidate.id}"><span class="paper-icon">▤</span><span class="paper-item-copy"><strong>${escapeHtml(candidate.title)}</strong><small>${escapeHtml(candidate.sourceName)} · ${candidate.graph.pages.length} pages</small></span><button class="paper-del-btn" data-delete-paper="${candidate.id}" title="Remove">&times;</button></div>`).join("") : `<div class="empty-library"><div class="empty-icon">⌁</div><strong>Your library is empty</strong><span>Import a paper to begin.</span></div>`}</div>
          ${state.papers.length ? `<div class="sidebar-actions"><button class="ghost-button" id="clear-library">Clear local library</button><button class="ghost-button" id="export-workspace" title="Export entire workspace as .paperwitha">Export</button><label class="ghost-button"><input id="import-workspace" type="file" accept=".json" hidden />Import</label></div>` : ""}
        </aside>
        <button class="sidebar-edge-toggle" id="toggle-sidebar" title="${state.sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}">${state.sidebarOpen ? "◀" : "▶"}</button>
        <main class="main-area">
          ${paper ? renderWorkspace(paper) : renderWelcome()}
        </main>
      </div>
    </div>`;
  bindEvents();
  setupPdfViewer();
  scheduleInkSetup();
  setTimeout(function () { initShell(); }, 200);
}


async function setupPdfViewer(): Promise<void> {
  const paper = activePaper();
  if (!paper?.graph.blobHash) return;
  const container = document.querySelector<HTMLDivElement>("#reader-scroll");
  if (!container) return;
  try {
    const bytes = await blobStore.get(paper.graph.blobHash);
    if (!bytes) return;
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    container.style.cssText = "padding:0;overflow:hidden;position:relative;";
    container.innerHTML = `<iframe src="${url}" style="width:100%;height:100%;border:0;position:absolute;top:0;left:0;"></iframe>`;
  } catch (e) { console.error("PDF load failed:", e); }
}
function renderWelcome() {
  return `<section class="welcome"><div class="welcome-glow"></div><span class="eyebrow">LOCAL-FIRST RESEARCH WORKSPACE</span><h1>Read deeply.<br /><em>Think with evidence.</em></h1><p>Bring a paper into a local workspace with independent agent sessions, explicit evidence, and persistent research history.</p><div class="welcome-actions"><label class="primary-button"><input id="welcome-file-input" type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" hidden />Import a paper <span>↗</span></label><button class="secondary-button" id="welcome-demo">Open the demo <span>→</span></button></div><div class="feature-row"><span><b>01</b> Continuous reading</span><span><b>02</b> Multi-session agents</span><span><b>03</b> Local by default</span></div></section>`;
}

function renderWorkspace(paper: StoredPaper) {
  const isPdf = Boolean(paper.graph.blobHash);
  const readerContent = isPdf ? "" : paper.graph.pages.map((page) => {
    const annotationCount = paper.annotations.filter((a) => a.anchor.pageId === page.pageId).length;
    return renderPagePlaceholder(page, annotationCount, paper.graph.blobHash);
  }).join("");
  const termHeight = state.assistantOpen ? `${Math.round(state.terminalHeight * 100)}%` : "0";
  return `<div class="split-pane" id="split-pane"><section class="reader-panel"><div class="reader-scroll" id="reader-scroll">${readerContent}</div></section>${state.assistantOpen ? `<div class="terminal-divider" id="terminal-divider" title="Drag to resize"></div><div class="terminal-panel"><div class="terminal-header">TERMINAL</div><div id="xterm-container"></div></div>` : ""}</div>`;
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
  if (!endpoint) { setProviderConfig(null); render(); return; }
  const model = window.prompt("Model identifier", providerConfig?.model ?? "default")?.trim() || "default";
  const apiKey = window.prompt("API key (kept only in memory)", "") ?? "";
  try {
    new URL(endpoint);
    setProviderConfig({ endpoint, model, apiKey, enabled: true });
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
  
  document.querySelectorAll<HTMLButtonElement>(".paper-del-btn").forEach(function (btn) { btn.addEventListener("click", function (e) { e.stopPropagation(); var id = btn.dataset.deletePaper; if (!id) return; var paper = state.papers.find(function (p) { return p.id === id; }); if (paper) { fetch("http://localhost:4121/papers/" + encodeURIComponent(paper.sourceName), { method: "DELETE" }).catch(function () {}); } state.papers = state.papers.filter(function (p) { return p.id !== id; }); if (state.activePaperId === id) state.activePaperId = state.papers[0]?.id ?? null; saveState(); render(); }); });

document.querySelector<HTMLButtonElement>("#clear-library")?.addEventListener("click", () => { if (window.confirm("Remove all papers and agent sessions from this browser?")) { fetch("http://localhost:4121/papers", { method: "DELETE" }).catch(function () {}); Object.assign(state, emptyState()); saveState(); render(); } });
  document.querySelectorAll<HTMLElement>("[data-paper-id]").forEach((el) => el.addEventListener("click", () => { state.activePaperId = el.dataset.paperId ?? null; state.selectedText = ""; saveState(); render(); }));
  document.querySelectorAll<HTMLButtonElement>("[data-session-id]").forEach((button) => button.addEventListener("click", () => { const sessionId = button.dataset.sessionId; if (sessionId) { state.agentWorkspace = selectAgentSession(state.agentWorkspace, sessionId); saveState(); render(); } }));
  document.querySelectorAll<HTMLButtonElement>("[data-fork-from]").forEach((button) => button.addEventListener("click", () => { const session = activeSession(); if (!session) return; try { state.agentWorkspace = replaceAgentSession(state.agentWorkspace, forkAgentBranch(session, { branchId: uid("branch"), fromMessageId: button.dataset.forkFrom!, title: `${session.title} · fork`, now: new Date().toISOString() })); saveState(); render(); } catch (error) { window.alert(error instanceof Error ? error.message : String(error)); } }));
  document.querySelectorAll<HTMLButtonElement>("[data-branch-id]").forEach((button) => button.addEventListener("click", () => { const session = activeSession(); if (!session) return; try { state.agentWorkspace = replaceAgentSession(state.agentWorkspace, selectAgentBranch(session, button.dataset.branchId!, new Date().toISOString())); saveState(); render(); } catch (error) { window.alert(error instanceof Error ? error.message : String(error)); } }));
  document.querySelector<HTMLButtonElement>("#new-session")?.addEventListener("click", () => { const paper = activePaper(); if (paper) { createSessionForPaper(paper); render(); } });
  document.querySelector<HTMLButtonElement>("#archive-session")?.addEventListener("click", () => { const session = activeSession(); if (!session) return; try { state.agentWorkspace = archiveAgentSession(state.agentWorkspace, session.sessionId, new Date().toISOString()); saveState(); render(); } catch (error) { window.alert(error instanceof Error ? error.message : String(error)); } });
  document.querySelectorAll<HTMLButtonElement>("[data-suggestion]").forEach((button) => button.addEventListener("click", () => { const input = document.querySelector<HTMLTextAreaElement>("#chat-input"); if (input) { input.value = button.dataset.suggestion ?? ""; input.focus(); } }));
  document.querySelector<HTMLButtonElement>("#clear-context")?.addEventListener("click", () => { const session = activeSession(); if (!session) return; storeSession(updateAgentSessionContext(session, { ...session.context, fixedSourceIds: [], sourceTexts: {} }, new Date().toISOString())); render(); });
  document.querySelectorAll<HTMLButtonElement>("[data-jump-source]").forEach((button) => button.addEventListener("click", () => { const sourceId = button.dataset.jumpSource; if (sourceId) jumpToSource(sourceId); }));
  document.querySelectorAll<HTMLButtonElement>("[data-ocr-page]").forEach((button) => button.addEventListener("click", () => { const pn = Number(button.dataset.ocrPage); if (pn) void runOcr(pn); }));
  document.querySelector<HTMLButtonElement>("#refresh-brief")?.addEventListener("click", () => { const paper = activePaper(); if (paper) { paper.brief = makeBrief(paper.graph); saveState(); render(); } });
  document.querySelectorAll<HTMLInputElement>("#file-input, #welcome-file-input").forEach((input) => input.addEventListener("change", async () => { const file = input.files?.[0]; if (file) await importFile(file); }));
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
  document.querySelector<HTMLButtonElement>("#ink-pen")?.addEventListener("click", () => { setInkTool("pen"); render(); });
  document.querySelector<HTMLButtonElement>("#ink-highlighter")?.addEventListener("click", () => { setInkTool("highlighter"); render(); });
  document.querySelector<HTMLButtonElement>("#ink-eraser")?.addEventListener("click", () => { setInkTool("eraser"); render(); });
  document.querySelector<HTMLInputElement>("#ink-color")?.addEventListener("input", (event) => { setInkColor((event.target as HTMLInputElement).value); });
  document.querySelector<HTMLButtonElement>("#ink-clear-page")?.addEventListener("click", () => { const paper = activePaper(); if (!paper) return; const activePage = state.selectedPage ?? 1; state.inkStrokes = state.inkStrokes.filter((s) => !(s.documentId === paper.graph.documentId && s.pageNumber === activePage)); saveState(); render(); });
  document.querySelector<HTMLButtonElement>("#export-annotated")?.addEventListener("click", () => { void exportPageAsPng(); });
  document.querySelector<HTMLButtonElement>("#export-workspace")?.addEventListener("click", exportWorkspace);
  document.querySelector<HTMLInputElement>("#import-workspace")?.addEventListener("change", async (event) => { const file = (event.target as HTMLInputElement).files?.[0]; if (file) { await importWorkspace(file); (event.target as HTMLInputElement).value = ""; } });
  const divider = document.querySelector<HTMLElement>("#terminal-divider");
  const pane = document.querySelector<HTMLElement>("#split-pane");
  if (divider && pane) {
    let dragging = false;
    divider.addEventListener("pointerdown", (event) => { dragging = true; divider.classList.add("dragging"); event.preventDefault(); });
    document.addEventListener("pointermove", (event) => {
      if (!dragging || !pane) return;
      const rect = pane.getBoundingClientRect();
      const ratio = 1 - Math.max(0.1, Math.min(0.7, (event.clientY - rect.top) / rect.height));
      state.terminalHeight = ratio;
      const termEl = pane.querySelector<HTMLElement>(".terminal-panel");
      if (termEl) termEl.style.flex = `0 0 ${Math.round(ratio * 100)}%`;
    });
    document.addEventListener("pointerup", () => { if (dragging) { dragging = false; divider.classList.remove("dragging"); saveState(); } });
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
  setSelectionToolbar(null);
  const selection = window.getSelection();
  const text = selection?.toString().trim() ?? "";
  if (!text || !selection?.anchorNode || !document.querySelector(".reader-panel")?.contains(selection.anchorNode)) return;
  state.selectedText = text;
  const page = (selection.anchorNode.parentElement?.closest("[data-page-number]") as HTMLElement | null)?.dataset.pageNumber;
  state.selectedPage = page ? Number(page) : null;
  const range = selection.getRangeAt(0).getBoundingClientRect();
  setSelectionToolbar(document.createElement("div"));
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
  setActiveInkStroke({ points: [], canvasEl: canvas, pageNumber, pageWidth: canvas.offsetWidth, pageHeight: canvas.offsetHeight });
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
  setActiveInkStroke(null);
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
try { render(); } catch (e) { console.error("render failed:", e); }
try { setupInkEvents(); } catch (e) { console.error("setupInkEvents failed:", e); }
