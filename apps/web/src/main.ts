import "./styles.css";
import {
  createAgentWorkspace,
  createAgentSession,
  addAgentSession,
  appendAgentMessage,
  appendAgentEvent,
  startAgentRun,
  finishAgentRun,
  updateAgentMessage,
  replaceAgentSession,
  selectAgentSession,
  activeAgentBranch,
  archiveAgentSession,
  type AgentSession,
  type AgentMessage,
  type AgentWorkspaceState,
} from "@paperwitha/agent-core";
import { buildContext, type ContextSet, type ContextSource } from "@paperwitha/context";
import { ProviderClient } from "@paperwitha/ai-core";
import { BrowserStoragePort, JsonRepository } from "@paperwitha/storage";

/* ------------------------------------------------------------------ */
/*  State                                                             */
/* ------------------------------------------------------------------ */

type StoredPaper = {
  id: string;
  title: string;
  fileHash: string;
  sourceName: string;
  addedAt: string;
};

type AppState = {
  papers: StoredPaper[];
  activePaperId: string | null;
  agentWorkspace: AgentWorkspaceState;
};

type PersistedState = Partial<AppState> & {
  papers?: StoredPaper[];
};
type ProviderConfig = { endpoint: string; model: string; apiKey: string; enabled: boolean };

const STORAGE_KEY = "paperwitha.web.v3";
const ESCAPE_RE = /[&<>'"]/g;
const ESCAPE_MAP: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" };

const app = document.querySelector<HTMLDivElement>("#app")!;
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID?.() ?? Date.now()}`;
const escapeHtml = (v: string) => v.replace(ESCAPE_RE, (c) => ESCAPE_MAP[c] ?? c);
const repo = new JsonRepository<PersistedState>(new BrowserStoragePort(), STORAGE_KEY);

let state = loadState();
let providerConfig: ProviderConfig | null = null;

/* ------------------------------------------------------------------ */
/*  Persistence                                                       */
/* ------------------------------------------------------------------ */

function loadState(): AppState {
  const p = repo.read({});
  const papers = (p.papers ?? []).map((pp) => ({ ...pp }));
  return {
    papers,
    activePaperId: p.activePaperId ?? papers[0]?.id ?? null,
    agentWorkspace: p.agentWorkspace ?? createAgentWorkspace(),
  };
}
function saveState() { repo.write(state); }

function activatePaper(paper: StoredPaper) {
  state.activePaperId = paper.id;
  const exists = state.agentWorkspace.sessions.find((s) =>
    s.title === paper.title && s.status !== "archived"
  );
  if (!exists) {
    const session = createAgentSession({
      sessionId: uid("session"),
      branchId: uid("branch"),
      title: paper.title,
      agentProfileId: "paperwitha-evidence-agent",
      runtimeProfileId: "paperwitha-local-runtime",
      context: { documentIds: [paper.fileHash], fixedSourceIds: [], sourceTexts: {}, retrievalVersion: "local-lexical-v1" },
      now: new Date().toISOString(),
    });
    state.agentWorkspace = addAgentSession(state.agentWorkspace, session);
  }
  saveState();
  render();
}

/* ------------------------------------------------------------------ */
/*  Agent helpers                                                     */
/* ------------------------------------------------------------------ */

function activeSession(): AgentSession | null {
  return state.agentWorkspace.sessions.find(
    (s) => s.sessionId === state.agentWorkspace.activeSessionId && s.status !== "archived"
  ) ?? null;
}
function storeSession(s: AgentSession) {
  state.agentWorkspace = replaceAgentSession(state.agentWorkspace, s);
  saveState();
}

/* ------------------------------------------------------------------ */
/*  Render                                                            */
/* ------------------------------------------------------------------ */

function render() {
  const paper = state.papers.find((p) => p.id === state.activePaperId);
  const session = activeSession();

  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <span class="brand"><span class="brand-mark">P</span> PaperWithA</span>
        <div class="topbar-actions">
          <label class="ghost-button"><input id="file-input" type="file" accept=".pdf" hidden />+ Paper</label>
          <button class="avatar ${providerConfig ? "provider-active" : ""}" id="provider-settings">${providerConfig ? "AI" : "L"}</button>
        </div>
      </header>
      <div class="main-layout">
        <aside class="paper-list">
          <div class="paper-list-head">PAPERS</div>
          ${state.papers.map((p) => `
            <button class="paper-item ${p.id === state.activePaperId ? "active" : ""}" data-paper-id="${p.id}">
              <span>${escapeHtml(p.title)}</span>
              <small>${escapeHtml(p.sourceName)}</small>
            </button>
          `).join("")}
          ${state.papers.length === 0 ? `<div class="empty-hint">Drop or add a PDF to begin.</div>` : ""}
        </aside>
        <main class="chat-area">
          ${session ? renderChat(session) : renderEmpty(paper)}
        </main>
      </div>
    </div>`;

  bindEvents();
}

function renderChat(session: AgentSession): string {
  const branch = activeAgentBranch(session);
  const msgs = branch.messages.map((m) => `
    <div class="msg ${m.role}">
      <span class="msg-role">${m.role === "user" ? "You" : "Agent"}</span>
      <div class="msg-text">${escapeHtml(m.text)}</div>
    </div>
  `).join("");

  return `
    <div class="chat-messages" id="chat-messages">${msgs || `<div class="empty-hint">Ask about any paper in your library.</div>`}</div>
    <form id="chat-form" class="chat-form">
      <textarea id="chat-input" rows="2" placeholder="Ask a question..."></textarea>
      <button type="submit" id="send-btn">Send</button>
    </form>`;
}

function renderEmpty(paper: StoredPaper | undefined): string {
  if (paper) {
    return `<div class="empty-hint">Select a session or create one for "${escapeHtml(paper.title)}".</div>`;
  }
  return `<div class="empty-hint">Add a PDF to get started.</div>`;
}

/* ------------------------------------------------------------------ */
/*  Bind events                                                       */
/* ------------------------------------------------------------------ */

function bindEvents() {
  document.querySelector<HTMLButtonElement>("#provider-settings")?.addEventListener("click", () => {
    const ep = prompt("Provider endpoint (blank = local)", providerConfig?.endpoint ?? "")?.trim() ?? "";
    if (!ep) { providerConfig = null; render(); return; }
    const model = prompt("Model", providerConfig?.model ?? "default")?.trim() || "default";
    const key = prompt("API key", "") ?? "";
    try { new URL(ep); providerConfig = { endpoint: ep, model, apiKey: key, enabled: true }; render(); }
    catch { alert("Invalid URL"); }
  });

  document.querySelectorAll<HTMLElement>("[data-paper-id]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.paperId;
      const paper = state.papers.find((p) => p.id === id);
      if (paper) activatePaper(paper);
    });
  });

  document.querySelector<HTMLInputElement>("#file-input")?.addEventListener("change", async () => {
    const file = (document.querySelector<HTMLInputElement>("#file-input") as HTMLInputElement).files?.[0];
    if (!file) return;
    const id = uid("paper");
    const title = file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
    const paper: StoredPaper = { id, title, fileHash: "", sourceName: file.name, addedAt: new Date().toISOString() };
    state.papers.push(paper);
    saveState();
    activatePaper(paper);
  });

  document.querySelector<HTMLFormElement>("#chat-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.querySelector<HTMLTextAreaElement>("#chat-input");
    if (!input?.value.trim()) return;
    await sendPrompt(input.value.trim());
    input.value = "";
  });
}

/* ------------------------------------------------------------------ */
/*  Agent prompt                                                      */
/* ------------------------------------------------------------------ */

async function sendPrompt(prompt: string): Promise<void> {
  const paper = state.papers.find((p) => p.id === state.activePaperId);
  let session = activeSession();
  if (!session || !paper) return;

  const now = new Date().toISOString();
  const runId = uid("run");
  const userMsg: AgentMessage = { messageId: uid("msg"), role: "user", text: prompt, createdAt: now, runId };
  const assistantMsgId = uid("msg");

  session = startAgentRun(session, {
    runId,
    model: providerConfig?.model ?? null,
    now,
    snapshot: {
      snapshotId: uid("snap"),
      documentIds: [paper.fileHash],
      fixedSourceIds: [],
      selectedSourceIds: [],
      omittedSourceIds: [],
      query: prompt,
      retrievalVersion: "local-lexical-v1",
      tokenCount: 0,
      createdAt: now,
    },
  });
  session = appendAgentMessage(session, userMsg);
  session = appendAgentMessage(session, { messageId: assistantMsgId, role: "assistant", text: "", createdAt: now, runId });
  storeSession(session);
  render();

  const updateDom = (text: string) => {
    const el = document.querySelector(`[data-msg-id="${assistantMsgId}"] .msg-text`);
    if (el) el.textContent = text;
  };

  try {
    let answer = "";
    if (providerConfig?.enabled) {
      const url = new URL(providerConfig.endpoint);
      const client = new ProviderClient({
        providerId: "web-provider",
        manifestVersion: "1",
        apiVersion: "paperwitha.provider.v1",
        transport: "sse",
        endpoint: providerConfig.endpoint,
        allowedDomains: [url.hostname],
        authentication: { scheme: providerConfig.apiKey ? "api-key" : "none" },
        requestMapping: { kind: "json-pointer", path: "" },
        responseMapping: { kind: "json-pointer", path: "/delta" },
      }, providerConfig.apiKey ? { credential: providerConfig.apiKey } : {});

      const msgs = [{ role: "user" as const, content: prompt }];
      for await (const evt of client.streamChat({ model: providerConfig.model, messages: msgs })) {
        if (evt.kind !== "delta") continue;
        answer += evt.text;
        session = updateAgentMessage(session, assistantMsgId, answer, new Date().toISOString());
        storeSession(session);
        updateDom(answer);
      }
    } else {
      answer = `[local] "PaperWithA Agent" received your question about "${paper.title}". Connect an AI provider in settings for full analysis. Your paper is indexed and ready for subagent processing.`;
      session = updateAgentMessage(session, assistantMsgId, answer, new Date().toISOString());
      storeSession(session);
      updateDom(answer);
    }

    session = finishAgentRun(session, runId, { status: "completed", now: new Date().toISOString() });
    storeSession(session);
  } catch (err) {
    const msg = `Error: ${err instanceof Error ? err.message : String(err)}`;
    session = updateAgentMessage(session, assistantMsgId, msg, new Date().toISOString());
    session = finishAgentRun(session, runId, { status: "failed", now: new Date().toISOString(), error: msg });
    storeSession(session);
    updateDom(msg);
  }

  render();
  document.querySelector<HTMLElement>("#chat-messages")?.scrollTo({ top: 999999, behavior: "smooth" });
}

/* ------------------------------------------------------------------ */
/*  Start                                                             */
/* ------------------------------------------------------------------ */

render();
