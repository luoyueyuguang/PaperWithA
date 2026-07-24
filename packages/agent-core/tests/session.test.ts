import { describe, expect, it } from "vitest";
import {
  activeAgentBranch,
  addAgentSession,
  appendAgentEvent,
  appendAgentMessage,
  archiveAgentSession,
  createAgentSession,
  createAgentWorkspace,
  finishAgentRun,
  forkAgentBranch,
  replaceAgentSession,
  selectAgentSession,
  startAgentRun,
  updateAgentSessionContext,
} from "../src/session.js";

const now = "2026-07-24T10:00:00.000Z";

function session(id = "session-1") {
  return createAgentSession({
    sessionId: id,
    branchId: `${id}:main`,
    title: "Paper analysis",
    agentProfileId: "paper-analyst",
    runtimeProfileId: "local-runtime",
    now,
  });
}

describe("AgentSession", () => {
  it("keeps multiple sessions and their contexts isolated", () => {
    let workspace = addAgentSession(createAgentWorkspace(), session("one"));
    workspace = addAgentSession(workspace, session("two"));
    const first = updateAgentSessionContext(workspace.sessions[0]!, {
      documentIds: ["paper-a"],
      fixedSourceIds: ["paper-a:p1"],
      sourceTexts: { "paper-a:p1": "evidence A" },
      retrievalVersion: "local-lexical-v1",
    }, now);
    workspace = replaceAgentSession(workspace, first);
    workspace = selectAgentSession(workspace, "one");

    expect(workspace.activeSessionId).toBe("one");
    expect(workspace.sessions[0]?.context.documentIds).toEqual(["paper-a"]);
    expect(workspace.sessions[1]?.context.documentIds).toEqual([]);
  });

  it("snapshots context for a run and preserves it after live context changes", () => {
    let current = updateAgentSessionContext(session(), {
      documentIds: ["paper-a"],
      fixedSourceIds: ["selection-a"],
      sourceTexts: { "selection-a": "fixed evidence" },
      retrievalVersion: "local-lexical-v1",
    }, now);
    current = startAgentRun(current, {
      runId: "run-1",
      model: "local",
      now,
      snapshot: {
        snapshotId: "snapshot-1",
        documentIds: ["paper-a"],
        fixedSourceIds: ["selection-a"],
        selectedSourceIds: ["selection-a"],
        omittedSourceIds: [],
        query: "why",
        retrievalVersion: "local-lexical-v1",
        tokenCount: 2,
        createdAt: now,
      },
    });
    current = updateAgentSessionContext(current, {
      documentIds: ["paper-b"],
      fixedSourceIds: [],
      sourceTexts: {},
      retrievalVersion: "local-lexical-v1",
    }, "2026-07-24T10:01:00.000Z");

    expect(activeAgentBranch(current).runs[0]?.contextSnapshot.documentIds).toEqual(["paper-a"]);
    expect(current.context.documentIds).toEqual(["paper-b"]);
  });

  it("records an ordered event stream and prevents concurrent runs in one branch", () => {
    let current = startAgentRun(session(), {
      runId: "run-1",
      model: null,
      now,
      snapshot: {
        snapshotId: "snapshot-1",
        documentIds: [],
        fixedSourceIds: [],
        selectedSourceIds: [],
        omittedSourceIds: [],
        query: "inspect",
        retrievalVersion: "local-lexical-v1",
        tokenCount: 0,
        createdAt: now,
      },
    });
    expect(() => startAgentRun(current, {
      runId: "run-2",
      model: null,
      now,
      snapshot: activeAgentBranch(current).runs[0]!.contextSnapshot,
    })).toThrow("already has an active run");

    current = appendAgentEvent(current, "run-1", { eventId: "event-1", kind: "tool-started", payload: { tool: "read" }, createdAt: now });
    current = appendAgentEvent(current, "run-1", { eventId: "event-2", kind: "tool-completed", payload: { ok: true }, createdAt: now });
    current = finishAgentRun(current, "run-1", { status: "completed", now: "2026-07-24T10:02:00.000Z" });

    expect(activeAgentBranch(current).runs[0]?.events.map((event) => event.sequence)).toEqual([0, 1]);
    expect(current.status).toBe("idle");
  });

  it("forks a branch from an immutable message boundary", () => {
    let current = appendAgentMessage(session(), { messageId: "m1", role: "user", text: "first", createdAt: now, runId: null });
    current = appendAgentMessage(current, { messageId: "m2", role: "assistant", text: "answer", createdAt: now, runId: "run-1" });
    current = appendAgentMessage(current, { messageId: "m3", role: "user", text: "later", createdAt: now, runId: null });
    current = forkAgentBranch(current, { branchId: "branch-2", fromMessageId: "m2", title: "Alternative", now });

    expect(activeAgentBranch(current).messages.map((message) => message.messageId)).toEqual(["m1", "m2"]);
    expect(current.branches[0]?.messages.map((message) => message.messageId)).toEqual(["m1", "m2", "m3"]);
  });

  it("archives only idle sessions and selects another visible session", () => {
    let workspace = addAgentSession(createAgentWorkspace(), session("one"));
    workspace = addAgentSession(workspace, session("two"));
    workspace = archiveAgentSession(workspace, "two", now);

    expect(workspace.activeSessionId).toBe("one");
    expect(workspace.sessions.find((candidate) => candidate.sessionId === "two")?.status).toBe("archived");
  });
});
