import type { Artifact, RenderCapabilities } from "./artifact";
import type { ChatMessage } from "./chat";

/** core 通过 WebSocket 推给 UI 的事件。命令走 HTTP，事件只走这条单向流。 */
export type CoreEvent =
  | { readonly type: "run-started"; readonly sessionId: string; readonly runId: string }
  | { readonly type: "text-delta"; readonly sessionId: string; readonly runId: string; readonly delta: string }
  | { readonly type: "tool-start"; readonly sessionId: string; readonly runId: string; readonly toolName: string; readonly detail: string }
  | { readonly type: "tool-end"; readonly sessionId: string; readonly runId: string; readonly toolName: string; readonly isError: boolean }
  | { readonly type: "message-completed"; readonly sessionId: string; readonly runId: string; readonly message: ChatMessage }
  | { readonly type: "run-completed"; readonly sessionId: string; readonly runId: string }
  | { readonly type: "run-failed"; readonly sessionId: string; readonly runId: string; readonly message: string }
  | { readonly type: "artifact-updated"; readonly sessionId: string; readonly artifact: Artifact };

export interface CoreHealth {
  readonly ready: boolean;
  readonly papers: number;
  readonly agent: string;
  readonly renderers: RenderCapabilities;
}

const EVENT_TYPES: ReadonlySet<string> = new Set([
  "run-started",
  "text-delta",
  "tool-start",
  "tool-end",
  "message-completed",
  "run-completed",
  "run-failed",
  "artifact-updated",
]);

/** 只做结构校验：事件类型必须已知，会话 id 必须是字符串。 */
export function parseCoreEvent(raw: string): CoreEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const candidate = parsed as { type?: unknown; sessionId?: unknown };
  if (typeof candidate.type !== "string" || !EVENT_TYPES.has(candidate.type)) return null;
  if (typeof candidate.sessionId !== "string") return null;
  return parsed as CoreEvent;
}
