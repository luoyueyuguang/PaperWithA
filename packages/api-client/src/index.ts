import {
  parseCoreEvent,
  type Artifact,
  type ArtifactKind,
  type ChatSession,
  type CoreEvent,
  type CoreHealth,
  type PaperSummary,
  type PaperText,
} from "@paperwitha/domain";

export const DEFAULT_CORE_URL = "http://127.0.0.1:4130";

const RECONNECT_DELAY_MS = 1500;

export class CoreClientError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CoreClientError";
    this.status = status;
  }
}

export interface CoreClientOptions {
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  /** 测试或 React Native 环境可注入自己的实现。 */
  readonly webSocketFactory?: (url: string) => WebSocket;
}

export interface EventSubscription {
  readonly close: () => void;
}

export class CoreClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly webSocketFactory: (url: string) => WebSocket;
  private socket: WebSocket | null = null;
  /** 每次 unsubscribe 自增，让排队中的重连回调失效。 */
  private generation = 0;
  private onEvent: ((event: CoreEvent) => void) | null = null;

  constructor(options: CoreClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_CORE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.webSocketFactory = options.webSocketFactory ?? ((url) => new WebSocket(url));
  }

  health(): Promise<CoreHealth> {
    return this.request<CoreHealth>("/api/health");
  }

  listPapers(): Promise<readonly PaperSummary[]> {
    return this.request<readonly PaperSummary[]>("/api/papers");
  }

  uploadPaper(form: FormData): Promise<PaperSummary> {
    return this.request<PaperSummary>("/api/papers", { method: "POST", body: form });
  }

  getPaperText(paperId: string): Promise<PaperText> {
    return this.request<PaperText>(`/api/papers/${encodeURIComponent(paperId)}/text`);
  }

  /** 原始文件字节，PDF 阅读器用。 */
  async getPaperFile(paperId: string): Promise<ArrayBuffer> {
    const response = await this.requestRaw(`/api/papers/${encodeURIComponent(paperId)}/file`);
    return response.arrayBuffer();
  }

  deletePaper(paperId: string): Promise<void> {
    return this.request<void>(`/api/papers/${encodeURIComponent(paperId)}`, { method: "DELETE" });
  }

  listSessions(paperId?: string): Promise<readonly ChatSession[]> {
    const query = paperId ? `?paperId=${encodeURIComponent(paperId)}` : "";
    return this.request<readonly ChatSession[]>(`/api/sessions${query}`);
  }

  createSession(paperId: string, title?: string): Promise<ChatSession> {
    return this.request<ChatSession>("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(title === undefined ? { paperId } : { paperId, title }),
    });
  }

  deleteSession(sessionId: string): Promise<void> {
    return this.request<void>(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  }

  prompt(sessionId: string, text: string): Promise<{ readonly runId: string }> {
    return this.request<{ readonly runId: string }>(`/api/sessions/${encodeURIComponent(sessionId)}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  }

  abort(sessionId: string): Promise<void> {
    return this.request<void>(`/api/sessions/${encodeURIComponent(sessionId)}/abort`, { method: "POST" });
  }

  listArtifacts(sessionId: string): Promise<readonly Artifact[]> {
    return this.request<readonly Artifact[]>(`/api/sessions/${encodeURIComponent(sessionId)}/artifacts`);
  }

  createArtifact(sessionId: string, kind: ArtifactKind, messageId?: string): Promise<Artifact> {
    return this.request<Artifact>(`/api/sessions/${encodeURIComponent(sessionId)}/artifacts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(messageId === undefined ? { kind } : { kind, messageId }),
    });
  }

  deleteArtifact(artifactId: string): Promise<void> {
    return this.request<void>(`/api/artifacts/${encodeURIComponent(artifactId)}`, { method: "DELETE" });
  }

  /** 产物文件的绝对 URL；Web 里 <img>/<video> 直接用。 */
  artifactFileUrl(artifactId: string, file: string): string {
    const encoded = file.split("/").map(encodeURIComponent).join("/");
    return `${this.baseUrl}/api/artifacts/${encodeURIComponent(artifactId)}/file/${encoded}`;
  }

  /** 订阅事件流。断线后自动重连，直到调用 close()。 */
  subscribe(onEvent: (event: CoreEvent) => void): EventSubscription {
    this.onEvent = onEvent;
    this.stopSocket();
    this.openSocket();
    return {
      close: () => {
        this.onEvent = null;
        this.stopSocket();
      },
    };
  }

  private openSocket(): void {
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/api/events";
    const generation = this.generation;
    const socket = this.webSocketFactory(url.toString());
    this.socket = socket;
    socket.onmessage = (message: MessageEvent) => {
      const event = typeof message.data === "string" ? parseCoreEvent(message.data) : null;
      if (event) this.onEvent?.(event);
    };
    socket.onclose = () => {
      if (generation !== this.generation || this.onEvent === null) return;
      setTimeout(() => {
        if (generation === this.generation && this.onEvent !== null) this.openSocket();
      }, RECONNECT_DELAY_MS);
    };
  }

  private stopSocket(): void {
    this.generation += 1;
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onmessage = null;
    socket.onclose = null;
    socket.close();
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.requestRaw(path, init);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private async requestRaw(path: string, init?: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new CoreClientError(`连不上 PaperWithA core（${this.baseUrl}）：${detail}`, 0);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new CoreClientError(detail.trim() || `请求失败：${response.status}`, response.status);
    }
    return response;
  }
}
