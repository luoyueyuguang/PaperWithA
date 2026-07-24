import { describe, expect, it } from "vitest";
import {
  activeAgentBranch,
  addAgentSession,
  appendAgentEvent,
  appendAgentMessage,
  createAgentSession,
  createAgentWorkspace,
  finishAgentRun,
  forkAgentBranch,
  replaceAgentSession,
  selectAgentBranch,
  selectAgentSession,
  startAgentRun,
  updateAgentMessage,
  updateAgentSessionContext,
} from "../src/session.js";

const now = "2026-07-24T10:00:00.000Z";
const snapshot = (docId: string, sourceId: string) => ({
  snapshotId: `${docId}:snapshot`,
  documentIds: [docId],
  fixedSourceIds: [sourceId],
  selectedSourceIds: [sourceId],
  omittedSourceIds: [],
  query: "analyze",
  retrievalVersion: "local-lexical-v1",
  tokenCount: 5,
  createdAt: now,
});

describe("E2E Multi-Session Agent Pipeline", () => {
  it("creates sessions, sends messages, receives streaming responses, and forks", () => {
    let workspace = createAgentWorkspace();

    // Create session A with paper context
    const sessionA = createAgentSession({
      sessionId: "session-a", branchId: "a:main", title: "Analysis A",
      agentProfileId: "evidence-agent", runtimeProfileId: "local-runtime", now,
      context: { documentIds: ["paper-a"], fixedSourceIds: ["sel-1"], sourceTexts: { "sel-1": "evidence text A" }, retrievalVersion: "local-lexical-v1" },
    });
    workspace = addAgentSession(workspace, sessionA);

    // Create session B with different context
    const sessionB = createAgentSession({
      sessionId: "session-b", branchId: "b:main", title: "Analysis B",
      agentProfileId: "omp-task", runtimeProfileId: "omp-rpc", now,
      context: { documentIds: ["paper-b"], fixedSourceIds: ["sel-2"], sourceTexts: { "sel-2": "evidence text B" }, retrievalVersion: "local-lexical-v1" },
    });
    workspace = addAgentSession(workspace, sessionB);

    // Send message in session A
    let a = workspace.sessions[0]!;
    a = appendAgentMessage(a, { messageId: "a-msg-1", role: "user", text: "What is this?", createdAt: now, runId: null });
    a = startAgentRun(a, { runId: "a-run-1", model: "local", now, snapshot: snapshot("paper-a", "sel-1") });
    a = appendAgentMessage(a, { messageId: "a-msg-2", role: "assistant", text: "", createdAt: now, runId: "a-run-1" });
    a = appendAgentEvent(a, "a-run-1", { eventId: "a-ev-1", kind: "assistant-text-delta", payload: { text: "This paper" }, createdAt: now });
    a = updateAgentMessage(a, "a-msg-2", "This paper discusses attention mechanisms.", now);
    a = appendAgentEvent(a, "a-run-1", { eventId: "a-ev-2", kind: "run-completed", payload: null, createdAt: now });
    a = finishAgentRun(a, "a-run-1", { status: "completed", now });
    workspace = replaceAgentSession(workspace, a);

    // Send message in session B concurrently
    let b = workspace.sessions[1]!;
    b = appendAgentMessage(b, { messageId: "b-msg-1", role: "user", text: "Explain", createdAt: now, runId: null });
    b = startAgentRun(b, { runId: "b-run-1", model: "omp-sonnet", now, snapshot: snapshot("paper-b", "sel-2") });
    b = appendAgentMessage(b, { messageId: "b-msg-2", role: "assistant", text: "", createdAt: now, runId: "b-run-1" });
    b = appendAgentEvent(b, "b-run-1", { eventId: "b-ev-1", kind: "tool-started", payload: { tool: "read" }, createdAt: now });
    b = appendAgentEvent(b, "b-run-1", { eventId: "b-ev-2", kind: "tool-completed", payload: { ok: true }, createdAt: now });
    b = appendAgentEvent(b, "b-run-1", { eventId: "b-ev-3", kind: "assistant-text-delta", payload: { text: "Result" }, createdAt: now });
    b = updateAgentMessage(b, "b-msg-2", "Result from tool execution.", now);
    b = finishAgentRun(b, "b-run-1", { status: "completed", now });
    workspace = replaceAgentSession(workspace, b);

    // Verify context isolation
    expect(workspace.sessions[0]?.context.documentIds).toEqual(["paper-a"]);
    expect(workspace.sessions[1]?.context.documentIds).toEqual(["paper-b"]);

    // Verify messages and runs
    expect(activeAgentBranch(workspace.sessions[0]!).messages).toHaveLength(2);
    expect(activeAgentBranch(workspace.sessions[1]!).messages).toHaveLength(2);
    expect(activeAgentBranch(workspace.sessions[0]!).runs[0]?.events).toHaveLength(2);
    expect(activeAgentBranch(workspace.sessions[1]!).runs[0]?.events).toHaveLength(3);

    // Fork session A from first assistant message
    let sessionA2 = workspace.sessions[0]!;
    sessionA2 = forkAgentBranch(sessionA2, { branchId: "a:fork", fromMessageId: "a-msg-2", title: "Alternative", now });
    workspace = replaceAgentSession(workspace, sessionA2);

    // Forked branch has only messages up to fork point
    const forked = activeAgentBranch(workspace.sessions[0]!);
    expect(forked.messages).toHaveLength(2);
    expect(forked.branchId).toBe("a:fork");
    expect(forked.parentBranchId).toBe("a:main");

    // Switch back to original branch
    const back = selectAgentBranch(workspace.sessions[0]!, "a:main", now);
    expect(activeAgentBranch(back).branchId).toBe("a:main");
  });

  it("modifies live context without affecting run snapshots", () => {
    let session = createAgentSession({
      sessionId: "ctx-test", branchId: "main", title: "Context test",
      agentProfileId: "test", runtimeProfileId: "test", now,
      context: { documentIds: ["doc-1"], fixedSourceIds: ["src-1"], sourceTexts: { "src-1": "original" }, retrievalVersion: "v1" },
    });
    session = startAgentRun(session, { runId: "run-1", model: null, now, snapshot: snapshot("doc-1", "src-1") });
    session = updateAgentSessionContext(session, {
      documentIds: ["doc-2"],
      fixedSourceIds: ["src-2"],
      sourceTexts: { "src-2": "changed" },
      retrievalVersion: "v1",
    }, now);

    // Run snapshot unchanged, live context updated
    expect(activeAgentBranch(session).runs[0]?.contextSnapshot.documentIds).toEqual(["doc-1"]);
    expect(session.context.documentIds).toEqual(["doc-2"]);
  });
});
