import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createAgentSession, SessionManager, type AgentSession } from "@oh-my-pi/pi-coding-agent";
import type { PaperPage, PaperSummary } from "@paperwitha/domain";
import type { CorePaths } from "./config";

/** 论文短于这个长度就整个塞进第一轮提问，省一次工具往返。 */
const INLINE_LIMIT = 24_000;

/** 作图任务的上限：卡住的模型调用不能永久占住会话的作图名额。 */
const ARTIFACT_TIMEOUT_MS = 600_000;

/**
 * SDK 的事件联合类型每个版本都在变，这里只依赖稳定字段。
 * 用法：`event as unknown as AgentStreamEvent`。
 */
interface AgentStreamEvent {
  readonly type: string;
  readonly assistantMessageEvent?: { readonly type?: string; readonly delta?: string };
  readonly toolName?: string;
  readonly intent?: string;
  readonly args?: unknown;
  readonly isError?: boolean;
}

export interface AgentHooks {
  readonly onDelta: (delta: string) => void;
  readonly onToolStart: (toolName: string, detail: string) => void;
  readonly onToolEnd: (toolName: string, isError: boolean) => void;
}

interface ActiveRun {
  readonly runId: string;
  readonly hooks: AgentHooks;
}

interface LiveSession {
  readonly session: AgentSession;
  readonly paperId: string;
  primed: boolean;
  active: ActiveRun | null;
  unsubscribe: () => void;
}

export interface AgentPromptInput {
  readonly sessionId: string;
  readonly runId: string;
  readonly paper: PaperSummary;
  readonly pages: readonly PaperPage[];
  readonly question: string;
}

export class EmbeddedAgent {
  private readonly live = new Map<string, LiveSession>();

  constructor(private readonly paths: CorePaths) {}

  /** 跑一轮问答。调用方负责把 delta 写成事件。 */
  async prompt(input: AgentPromptInput, hooks: AgentHooks): Promise<void> {
    const state = await this.ensureSession(input.sessionId, input.paper, input.pages);
    const primed = state.primed;
    state.primed = true;
    state.active = { runId: input.runId, hooks };
    try {
      await state.session.prompt(composePrompt(input, primed));
    } finally {
      state.active = null;
    }
  }

  async abort(sessionId: string): Promise<void> {
    await this.live.get(sessionId)?.session.abort();
  }

  async dispose(sessionId: string): Promise<void> {
    const state = this.live.get(sessionId);
    if (!state) return;
    this.live.delete(sessionId);
    state.active = null;
    state.unsubscribe();
    await state.session.dispose();
  }

  async disposeAll(): Promise<void> {
    for (const sessionId of [...this.live.keys()]) await this.dispose(sessionId);
  }

  /** 跑一次性的作图任务：独立会话、独立工作目录，结束就销毁。 */
  async runOnce(input: { label: string; cwd: string; instructions: string; prompt: string; timeoutMs?: number }): Promise<void> {
    const timeoutMs = input.timeoutMs ?? ARTIFACT_TIMEOUT_MS;
    await mkdir(input.cwd, { recursive: true });
    const session = await this.openSession(input.cwd, input.instructions);
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      void session.abort();
    }, timeoutMs);
    try {
      await session.prompt(input.prompt);
      if (expired) throw new Error(`生成超时（${Math.round(timeoutMs / 1000)} 秒）`);
    } catch (error) {
      const message = expired ? `生成超时（${Math.round(timeoutMs / 1000)} 秒）` : error instanceof Error ? error.message : String(error);
      console.error(`[core] ${input.label} 失败：${message}`);
      throw new Error(message);
    } finally {
      clearTimeout(timer);
      await session.dispose();
    }
  }

  private openSession(cwd: string, instructions: string): Promise<AgentSession> {
    return createAgentSession({
      cwd,
      agentDir: this.paths.agentDir,
      // SessionManager 自己持有 cwd：不传就会用进程目录，agent 找不到 paper.md。
      sessionManager: SessionManager.inMemory(cwd),
      appendSystemPrompt: instructions,
      cacheWarming: false,
      disableExtensionDiscovery: true,
    }).then((created) => created.session);
  }

  private async ensureSession(sessionId: string, paper: PaperSummary, pages: readonly PaperPage[]): Promise<LiveSession> {
    const existing = this.live.get(sessionId);
    if (existing?.paperId === paper.id) return existing;
    if (existing) await this.dispose(sessionId);

    const workspace = join(this.paths.workspacesDir, paper.id);
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, "paper.md"), renderPaperMarkdown(paper, pages), "utf8");

    const session = await this.openSession(workspace, buildInstructions(paper, await readCustomStyle(this.paths.styleFile)));

    const state: LiveSession = {
      session,
      paperId: paper.id,
      primed: false,
      active: null,
      unsubscribe: () => undefined,
    };
    state.unsubscribe = session.subscribe((event) => forwardToRun(state, event as unknown as AgentStreamEvent));
    this.live.set(sessionId, state);
    return state;
  }
}

function forwardToRun(state: LiveSession, event: AgentStreamEvent): void {
  const active = state.active;
  if (!active) return;
  switch (event.type) {
    case "message_update": {
      const delta = event.assistantMessageEvent;
      if (delta?.type === "text_delta" && typeof delta.delta === "string") active.hooks.onDelta(delta.delta);
      return;
    }
    case "tool_execution_start":
      active.hooks.onToolStart(event.toolName ?? "tool", describeToolCall(event));
      return;
    case "tool_execution_end":
      active.hooks.onToolEnd(event.toolName ?? "tool", event.isError === true);
      return;
    default:
  }
}

const TOOL_DETAIL_LIMIT = 160;

function describeToolCall(event: AgentStreamEvent): string {
  if (typeof event.intent === "string" && event.intent.trim().length > 0) return event.intent.trim();
  if (event.args === undefined) return "";
  const rendered = typeof event.args === "string" ? event.args : JSON.stringify(event.args);
  if (rendered === undefined) return "";
  return rendered.length > TOOL_DETAIL_LIMIT ? `${rendered.slice(0, TOOL_DETAIL_LIMIT)}…` : rendered;
}

export function renderPaperMarkdown(paper: PaperSummary, pages: readonly PaperPage[]): string {
  const body = pages.map((page) => `## Page ${page.pageNumber}\n${page.text}`).join("\n\n");
  return `# ${paper.title}\n\n${body}\n`;
}

/** 读用户自定义风格；文件不存在或为空就当没配。 */
export async function readCustomStyle(file: string): Promise<string | null> {
  try {
    const text = (await readFile(file, "utf8")).trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

/** 回答风格约束。短、具体、禁止报告腔。 */
const STYLE_RULES: readonly string[] = [
  "直接回答问题，不要开场白，不要复述问题，不要总结自己刚说过的话。",
  "默认两三句讲完；用户明确要求展开时才展开。",
  "不要用 Markdown 标题、加粗小标题，也不要用“结论：”“要点：”“首先/其次/最后”这类标签。",
  "不要分点罗列，除非内容真的是并列清单；能写成段落就写成段落。",
  "不要用破折号插入解释，不要用感叹号，不要用这些词：综上所述、总而言之、值得注意的是、需要指出的是、不仅……而且、不是……而是、让我们来看看、希望对你有帮助。",
  "不要评价问题或自己的回答（例如“这是一个很好的问题”）。",
  "引用原文时在句末写 [p.N]，一句话最多标一次，不要把原文改写成另一种说法。",
  "论文里没有写的事就说不知道，不要用常识补，也不要猜页码。",
  "用用户提问的语言回答。用英文回答时同样避开 Certainly、It's worth noting、In conclusion、Overall 这类填充语。",
  "写中文时，全角标点（，。！？）前面不要加空格。",
];

/** 公式与符号的写法。界面用 KaTeX 渲染，写错就显示不出来。 */
const MATH_RULES: readonly string[] = [
  "数学符号一律写 LaTeX：行内 `$S_t$`，独立公式 `$$...$$`。",
  "不要用 □t、St、dk、M− 这种把上下标拍平的写法，写成 $\\square_t$、$S_t$、$d_k$、$M^-$。",
  "沿用论文里的记号，不要自己改字母或换下标。",
  "解释一组符号时，按「符号：含义」逐行列出来，不要堆成一大段。",
  "讲公式先说是哪一个量、作用是什么，再写公式本身。",
];

function buildInstructions(paper: PaperSummary, customStyle: string | null): string {
  const head = [
    `你在帮一位读者读论文《${paper.title}》。你们是在对话，不是在写报告或技术文档。`,
    `论文全文在工作目录的 paper.md，每页以 "## Page N" 开头。`,
    "回答方式：",
    ...STYLE_RULES.map((rule) => `- ${rule}`),
    "公式与符号：",
    ...MATH_RULES.map((rule) => `- ${rule}`),
  ];
  if (customStyle) head.push("", "用户补充的风格要求（优先遵守）：", customStyle);
  return head.join("\n");
}

function composePrompt(input: AgentPromptInput, primed: boolean): string {
  const question = input.question.trim();
  if (primed) return question;
  const body = renderPaperMarkdown(input.paper, input.pages);
  const header = `论文《${input.paper.title}》全文如下（每页以 "## Page N" 开头）：`;
  if (body.length <= INLINE_LIMIT) {
    return `${header}\n\n${body}\n\n---\n\n用户问题：${question}`;
  }
  return `论文《${input.paper.title}》全文在工作目录的 paper.md（每页以 "## Page N" 开头），先读它再回答。\n\n用户问题：${question}`;
}
