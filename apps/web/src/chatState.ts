import type { Artifact, ChatMessage, CoreEvent } from "@paperwitha/domain";

export type ToolState = "running" | "ok" | "error";

export interface ToolActivity {
  readonly id: string;
  readonly toolName: string;
  readonly detail: string;
  readonly state: ToolState;
}

/** 一个会话在 UI 里的全部状态：已落定的消息 + 正在流式的草稿 + 工具活动 + 图件。 */
export interface SessionView {
  readonly messages: readonly ChatMessage[];
  readonly draft: string;
  readonly activities: readonly ToolActivity[];
  readonly error: string | null;
  readonly runId: string | null;
  readonly running: boolean;
  readonly artifacts: readonly Artifact[];
}

export function createSessionView(messages: readonly ChatMessage[] = [], artifacts: readonly Artifact[] = []): SessionView {
  return {
    messages: [...messages],
    draft: "",
    activities: [],
    error: null,
    runId: null,
    running: false,
    artifacts: sortArtifacts(artifacts),
  };
}

/** `createdAt` 升序；sort 是稳定的，同一毫秒创建的图件保持先后插入顺序。 */
export function sortArtifacts(artifacts: readonly Artifact[]): readonly Artifact[] {
  return [...artifacts].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

/** 同一个 id 覆盖旧值；新 id 追加后按 `createdAt` 排序。 */
export function upsertArtifact(artifacts: readonly Artifact[], artifact: Artifact): readonly Artifact[] {
  if (!artifacts.some((existing) => existing.id === artifact.id)) return sortArtifacts([...artifacts, artifact]);
  return artifacts.map((existing) => (existing.id === artifact.id ? artifact : existing));
}

/** 服务端全量列表并进本地状态：同 id 时 `updatedAt` 较新的一方胜出（本地实时事件通常更新）。 */
export function mergeArtifacts(current: readonly Artifact[], incoming: readonly Artifact[]): readonly Artifact[] {
  let merged: readonly Artifact[] = current;
  for (const artifact of incoming) {
    const existing = merged.find((candidate) => candidate.id === artifact.id);
    if (!existing) {
      merged = [...merged, artifact];
    } else if (existing.updatedAt <= artifact.updatedAt) {
      merged = merged.map((candidate) => (candidate.id === artifact.id ? artifact : candidate));
    }
  }
  return sortArtifacts(merged);
}

export function reduceSessionView(view: SessionView, event: CoreEvent): SessionView {
  switch (event.type) {
    case "run-started":
      return { ...view, running: true, runId: event.runId, draft: "", activities: [], error: null };
    case "text-delta":
      return { ...view, draft: view.draft + event.delta };
    case "tool-start":
      return {
        ...view,
        activities: [
          ...view.activities,
          { id: `${event.runId}:${view.activities.length}`, toolName: event.toolName, detail: event.detail, state: "running" },
        ],
      };
    case "tool-end":
      return { ...view, activities: closeActivity(view.activities, event.toolName, event.isError) };
    case "message-completed":
      return { ...view, draft: "", messages: appendMessage(view.messages, event.message) };
    case "run-completed":
      return { ...view, running: false, runId: null, draft: "" };
    case "run-failed":
      return { ...view, running: false, runId: null, error: event.message };
    case "artifact-updated":
      return { ...view, artifacts: upsertArtifact(view.artifacts, event.artifact) };
  }
}

function closeActivity(activities: readonly ToolActivity[], toolName: string, isError: boolean): readonly ToolActivity[] {
  const state: ToolState = isError ? "error" : "ok";
  let target = -1;
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (activity && activity.state === "running" && activity.toolName === toolName) {
      target = index;
      break;
    }
  }
  if (target < 0) return [...activities, { id: `orphan:${activities.length}`, toolName, detail: "", state }];
  return activities.map((activity, index) => (index === target ? { ...activity, state } : activity));
}

function appendMessage(messages: readonly ChatMessage[], message: ChatMessage): readonly ChatMessage[] {
  if (messages.some((existing) => existing.id === message.id)) return messages;
  return [...messages, message];
}
