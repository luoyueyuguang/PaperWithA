import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Server, ServerWebSocket } from "bun";
import {
  appendChatMessage,
  extractCitations,
  isArtifactKind,
  ARTIFACT_KIND_LABEL,
  replaceChatMessage,
  sessionTitleFromQuestion,
  stripCitationMarkers,
  tidyAssistantText,
  type Artifact,
  type ChatMessage,
  type ChatSession,
  type CoreEvent,
  type PaperPage,
  type PaperSummary,
  type RenderCapabilities,
} from "@paperwitha/domain";
import { runArtifactJob } from "./artifacts/generator";
import type { ArtifactContext } from "./artifacts/prompt";
import type { EmbeddedAgent } from "./agent";
import { CORE_HOST, type CorePaths } from "./config";
import type { ArtifactStore } from "./store/artifacts";
import type { PaperStore } from "./store/papers";
import type { SessionStore } from "./store/sessions";

const EVENTS_PATH = "/api/events";
const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export interface CoreDeps {
  readonly paths: CorePaths;
  readonly papers: PaperStore;
  readonly sessions: SessionStore;
  readonly artifacts: ArtifactStore;
  readonly agent: EmbeddedAgent;
  readonly renderers: RenderCapabilities;
}

interface AgentRunContext {
  readonly sessionId: string;
  readonly runId: string;
  readonly question: string;
  readonly working: ChatSession;
  readonly assistantDraft: ChatMessage;
  readonly pages: readonly PaperPage[];
  readonly paper: PaperSummary;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS_HEADERS },
  });
}

function errorResponse(status: number, message: string): Response {
  return json(status, { error: message });
}

const TRANSCRIPT_LIMIT = 12_000;

/** 给作图任务用的对话记录；太长时保留最近的部分。 */
function transcriptOf(session: ChatSession): string {
  const text = session.messages
    .map((message) => `${message.role === "user" ? "我" : "助手"}：${message.text.trim()}`)
    .join("\n\n");
  return text.length > TRANSCRIPT_LIMIT ? text.slice(text.length - TRANSCRIPT_LIMIT) : text;
}

export class CoreServer {
  private readonly sockets = new Set<ServerWebSocket<undefined>>();
  /** sessionId → 当前 runId，用于拒绝并发提问。 */
  private readonly activeRuns = new Map<string, string>();
  /** 正在生成图件的会话，避免同时开多个作图会话。 */
  private readonly artifactJobs = new Set<string>();
  private readonly webDist: string | null;
  private server: Server<undefined> | null = null;

  constructor(private readonly deps: CoreDeps) {
    const dist = fileURLToPath(new URL("../../../apps/web/dist/", import.meta.url));
    this.webDist = dist;
  }

  start(port: number): void {
    this.server = Bun.serve({
      hostname: CORE_HOST,
      port,
      fetch: (request, server) => this.handle(request, server),
      websocket: {
        open: (socket) => {
          this.sockets.add(socket);
        },
        close: (socket) => {
          this.sockets.delete(socket);
        },
        message: () => undefined,
      },
    });
  }

  async stop(): Promise<void> {
    await this.deps.agent.disposeAll();
    this.server?.stop(true);
    this.server = null;
  }

  private broadcast(event: CoreEvent): void {
    const payload = JSON.stringify(event);
    for (const socket of this.sockets) socket.send(payload);
  }

  private async handle(request: Request, server: Server<undefined>): Promise<Response | undefined> {
    const url = new URL(request.url);
    if (url.pathname === EVENTS_PATH) {
      return server.upgrade(request) ? undefined : errorResponse(400, "websocket upgrade failed");
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (!url.pathname.startsWith("/api/")) return this.serveStatic(url.pathname);
    try {
      return await this.handleApi(request, url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[core] api error:", message);
      return errorResponse(500, message);
    }
  }

  private async handleApi(request: Request, url: URL): Promise<Response> {
    const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
    const [, resource, id, action] = segments;
    const method = request.method;

    if (resource === "health" && method === "GET") {
      return json(200, {
        ready: true,
        papers: this.deps.papers.list().length,
        agent: "oh-my-pi",
        renderers: this.deps.renderers,
      });
    }

    if (resource === "artifacts") {
      if (id === undefined) return errorResponse(404, "not found");
      if (action === "file" && method === "GET") {
        return this.serveArtifactFile(id, segments.slice(4).join("/"));
      }
      if (action === undefined && method === "DELETE") {
        await this.deps.artifacts.remove(id);
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }
      return errorResponse(405, "method not allowed");
    }

    if (resource === "papers") {
      if (id === undefined) {
        if (method === "GET") return json(200, this.deps.papers.list());
        if (method === "POST") return this.uploadPaper(request);
        return errorResponse(405, "method not allowed");
      }
      if (action === "text" && method === "GET") {
        const text = await this.deps.papers.getText(id);
        return text ? json(200, text) : errorResponse(404, "paper not found");
      }
      if (action === "file" && method === "GET") {
        const path = this.deps.papers.filePath(id);
        if (!path || !this.deps.papers.get(id)) return errorResponse(404, "paper not found");
        const file = Bun.file(path);
        if (!(await file.exists())) return errorResponse(404, "file missing");
        return new Response(file, { headers: { ...CORS_HEADERS, "content-type": file.type || "application/octet-stream" } });
      }
      if (action === undefined && method === "DELETE") {
        const removed = await this.deps.papers.remove(id);
        if (!removed) return errorResponse(404, "paper not found");
        for (const session of await this.deps.sessions.list(id)) await this.deps.agent.dispose(session.id);
        await this.deps.sessions.removeForPaper(id);
        await rm(join(this.deps.paths.workspacesDir, id), { recursive: true, force: true });
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }
      return errorResponse(405, "method not allowed");
    }

    if (resource === "sessions") {
      if (id === undefined) {
        if (method === "GET") return json(200, await this.deps.sessions.list(url.searchParams.get("paperId") ?? undefined));
        if (method === "POST") return this.createSession(request);
        return errorResponse(405, "method not allowed");
      }
      if (action === "prompt" && method === "POST") return this.startRun(id, request);
      if (action === "artifacts") {
        if (method === "GET") return json(200, await this.deps.artifacts.list(id));
        if (method === "POST") return this.startArtifact(id, request);
        return errorResponse(405, "method not allowed");
      }
      if (action === "abort" && method === "POST") {
        await this.deps.agent.abort(id);
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }
      if (action === undefined && method === "DELETE") {
        await this.deps.agent.dispose(id);
        await this.deps.artifacts.removeForSession(id);
        await this.deps.sessions.remove(id);
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }
      return errorResponse(405, "method not allowed");
    }

    return errorResponse(404, "not found");
  }

  private async uploadPaper(request: Request): Promise<Response> {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return errorResponse(400, "缺少 file 字段");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength === 0) return errorResponse(400, "文件为空");
    const summary = await this.deps.papers.add(file.name, bytes);
    return json(201, summary);
  }

  private async createSession(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => null)) as { paperId?: unknown; title?: unknown } | null;
    const paperId = typeof body?.paperId === "string" ? body.paperId : "";
    if (paperId.length === 0) return errorResponse(400, "缺少 paperId");
    const paper = this.deps.papers.get(paperId);
    if (!paper) return errorResponse(404, "paper not found");
    const now = new Date().toISOString();
    const session: ChatSession = {
      id: randomUUID(),
      paperId,
      title: typeof body?.title === "string" && body.title.trim().length > 0 ? body.title.trim() : paper.title,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    await this.deps.sessions.save(session);
    return json(201, session);
  }

  private async startRun(sessionId: string, request: Request): Promise<Response> {
    if (this.activeRuns.has(sessionId)) return errorResponse(409, "该会话正在回答");

    const session = await this.deps.sessions.get(sessionId);
    if (!session) return errorResponse(404, "session not found");
    const paper = this.deps.papers.get(session.paperId);
    if (!paper) return errorResponse(404, "paper not found");
    const text = await this.deps.papers.getText(paper.id);
    if (!text) return errorResponse(500, "论文文本不可用");

    const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
    const question = typeof body?.text === "string" ? body.text.trim() : "";
    if (question.length === 0) return errorResponse(400, "缺少 text");

    const runId = randomUUID();
    const now = new Date().toISOString();
    const userMessage: ChatMessage = { id: randomUUID(), role: "user", text: question, createdAt: now, citations: [] };
    const assistantDraft: ChatMessage = { id: randomUUID(), role: "assistant", text: "", createdAt: now, citations: [] };

    let working = appendChatMessage(session, userMessage);
    if (session.messages.length === 0) working = { ...working, title: sessionTitleFromQuestion(question) };
    working = appendChatMessage(working, assistantDraft);
    await this.deps.sessions.save(working);

    this.activeRuns.set(sessionId, runId);
    this.broadcast({ type: "run-started", sessionId, runId });
    void this.runAgent({ sessionId, runId, question, working, assistantDraft, pages: text.pages, paper });
    return json(202, { runId });
  }

  private async runAgent(context: AgentRunContext): Promise<void> {
    const { sessionId, runId } = context;
    let answer = "";
    try {
      await this.deps.agent.prompt(
        { sessionId, runId, paper: context.paper, pages: context.pages, question: context.question },
        {
          onDelta: (delta) => {
            answer += delta;
            this.broadcast({ type: "text-delta", sessionId, runId, delta });
          },
          onToolStart: (toolName, detail) => this.broadcast({ type: "tool-start", sessionId, runId, toolName, detail }),
          onToolEnd: (toolName, isError) => this.broadcast({ type: "tool-end", sessionId, runId, toolName, isError }),
        },
      );

      const citations = extractCitations(answer, context.pages);
      const message: ChatMessage = {
        ...context.assistantDraft,
        text: tidyAssistantText(stripCitationMarkers(answer)),
        citations,
      };
      await this.deps.sessions.save(replaceChatMessage(context.working, context.assistantDraft.id, message));
      this.broadcast({ type: "message-completed", sessionId, runId, message });
      this.broadcast({ type: "run-completed", sessionId, runId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[core] agent run failed:", message);
      this.broadcast({ type: "run-failed", sessionId, runId, message });
    } finally {
      this.activeRuns.delete(sessionId);
    }
  }

  private async startArtifact(sessionId: string, request: Request): Promise<Response> {
    if (this.artifactJobs.has(sessionId)) return errorResponse(409, "这个会话正在生成图件");

    const session = await this.deps.sessions.get(sessionId);
    if (!session) return errorResponse(404, "session not found");
    const paper = this.deps.papers.get(session.paperId);
    if (!paper) return errorResponse(404, "paper not found");
    const text = await this.deps.papers.getText(paper.id);
    if (!text) return errorResponse(500, "论文文本不可用");

    const body = (await request.json().catch(() => null)) as { kind?: unknown; messageId?: unknown } | null;
    if (!isArtifactKind(body?.kind)) return errorResponse(400, "kind 必须是 diagram / animation / slides");
    const messageId = typeof body?.messageId === "string" && body.messageId.length > 0 ? body.messageId : null;
    const message = messageId ? session.messages.find((candidate) => candidate.id === messageId) : undefined;
    if (messageId && !message) return errorResponse(404, "message not found");

    const now = new Date().toISOString();
    const artifact: Artifact = {
      id: randomUUID(),
      sessionId,
      messageId,
      kind: body.kind,
      title: `${ARTIFACT_KIND_LABEL[body.kind]} · ${paper.title}`,
      status: "running",
      createdAt: now,
      updatedAt: now,
      error: null,
      entry: null,
      slides: [],
      durationMs: null,
    };
    await this.deps.artifacts.save(artifact);
    this.broadcast({ type: "artifact-updated", sessionId, artifact });

    const context: ArtifactContext = {
      paper,
      pages: text.pages,
      messageText: message?.text ?? null,
      conversation: transcriptOf(session),
    };
    this.artifactJobs.add(sessionId);
    void runArtifactJob(
      { artifact, directory: this.deps.artifacts.directory(artifact.id), context },
      {
        agent: this.deps.agent,
        renderers: this.deps.renderers,
        onUpdate: (updated) => {
          void this.deps.artifacts.save(updated);
          this.broadcast({ type: "artifact-updated", sessionId, artifact: updated });
        },
      },
    ).finally(() => this.artifactJobs.delete(sessionId));

    return json(202, artifact);
  }

  private async serveArtifactFile(id: string, relative: string): Promise<Response> {
    if (relative.length === 0 || relative.includes("..")) return errorResponse(400, "bad path");
    const root = this.deps.artifacts.directory(id);
    const target = join(root, relative);
    if (!target.startsWith(`${root}/`)) return errorResponse(400, "bad path");
    const file = Bun.file(target);
    if (!(await file.exists())) return errorResponse(404, "file not found");

    const headers: Record<string, string> = {
      ...CORS_HEADERS,
      "content-type": file.type || "application/octet-stream",
      "x-content-type-options": "nosniff",
    };
    // deck.html 内容是 agent 写的，用 CSP 关掉脚本，防止它碰到 core 的接口。
    if (relative.endsWith(".html")) {
      headers["content-security-policy"] = "sandbox; default-src 'none'; style-src 'unsafe-inline'";
    }
    return new Response(file, { headers });
  }

  private async serveStatic(pathname: string): Promise<Response> {
    if (!this.webDist) return errorResponse(404, "not found");
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const target = join(this.webDist, relative);
    if (!target.startsWith(`${this.webDist}/`)) return errorResponse(404, "not found");
    const file = Bun.file(target);
    if (await file.exists()) return new Response(file);
    // 只有无扩展名的路径才回退到单页入口，避免把缺失的资源当成 HTML 返回。
    if (relative.includes(".")) return errorResponse(404, "not found");
    const index = Bun.file(join(this.webDist, "index.html"));
    if (await index.exists()) return new Response(index);
    return errorResponse(404, "not found");
  }
}
