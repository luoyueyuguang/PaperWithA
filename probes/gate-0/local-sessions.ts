import { performance } from "node:perf_hooks";
import {
  activeAgentBranch,
  addAgentSession,
  appendAgentEvent,
  createAgentSession,
  createAgentWorkspace,
  finishAgentRun,
  replaceAgentSession,
  startAgentRun,
  updateAgentSessionContext,
} from "../../packages/agent-core/src/index.js";
import { GATE_0_FIXTURE_VERSION, percentile, type ProbeReport } from "../../packages/contracts/src/probe.js";

export interface LocalSessionsProbeDetails {
  sessionCount: number;
  isolatedContexts: boolean;
  concurrentSessionRuns: boolean;
  snapshotsStable: boolean;
  orderedEvents: boolean;
  samples: Array<{ operationMs: number }>;
}

export async function runLocalSessionsProbe(): Promise<ProbeReport<LocalSessionsProbeDetails>> {
  const now = "2026-07-24T00:00:00.000Z";
  const create = (id: string) => createAgentSession({
    sessionId: id,
    branchId: `${id}:main`,
    title: id,
    agentProfileId: `${id}:agent`,
    runtimeProfileId: `${id}:runtime`,
    now,
  });
  let workspace = addAgentSession(createAgentWorkspace(), create("session-a"));
  workspace = addAgentSession(workspace, create("session-b"));
  const first = updateAgentSessionContext(workspace.sessions[0]!, {
    documentIds: ["paper-a"],
    fixedSourceIds: ["source-a"],
    sourceTexts: { "source-a": "evidence A" },
    retrievalVersion: "local-lexical-v1",
  }, now);
  const second = updateAgentSessionContext(workspace.sessions[1]!, {
    documentIds: ["paper-b"],
    fixedSourceIds: ["source-b"],
    sourceTexts: { "source-b": "evidence B" },
    retrievalVersion: "local-lexical-v1",
  }, now);
  workspace = replaceAgentSession(replaceAgentSession(workspace, first), second);

  const snapshotFor = (sessionId: string, documentId: string, sourceId: string) => ({
    snapshotId: `${sessionId}:snapshot`,
    documentIds: [documentId],
    fixedSourceIds: [sourceId],
    selectedSourceIds: [sourceId],
    omittedSourceIds: [],
    query: "inspect",
    retrievalVersion: "local-lexical-v1",
    tokenCount: 2,
    createdAt: now,
  });
  let runningA = startAgentRun(first, { runId: "run-a", snapshot: snapshotFor("session-a", "paper-a", "source-a"), model: "model-a", now });
  let runningB = startAgentRun(second, { runId: "run-b", snapshot: snapshotFor("session-b", "paper-b", "source-b"), model: "model-b", now });
  runningA = appendAgentEvent(runningA, "run-a", { eventId: "event-a1", kind: "tool-started", payload: { tool: "read" }, createdAt: now });
  runningA = appendAgentEvent(runningA, "run-a", { eventId: "event-a2", kind: "tool-completed", payload: { ok: true }, createdAt: now });
  runningB = appendAgentEvent(runningB, "run-b", { eventId: "event-b1", kind: "assistant-text-delta", payload: { text: "B" }, createdAt: now });

  const changedA = updateAgentSessionContext(runningA, {
    documentIds: ["paper-c"],
    fixedSourceIds: [],
    sourceTexts: {},
    retrievalVersion: "local-lexical-v1",
  }, now);
  const isolatedContexts = workspace.sessions[0]?.context.documentIds[0] === "paper-a"
    && workspace.sessions[1]?.context.documentIds[0] === "paper-b";
  const concurrentSessionRuns = activeAgentBranch(runningA).activeRunId === "run-a"
    && activeAgentBranch(runningB).activeRunId === "run-b";
  const snapshotsStable = activeAgentBranch(changedA).runs[0]?.contextSnapshot.documentIds[0] === "paper-a"
    && changedA.context.documentIds[0] === "paper-c";
  const orderedEvents = activeAgentBranch(runningA).runs[0]?.events.map((event) => event.sequence).join(",") === "0,1";

  const samples: Array<{ operationMs: number }> = [];
  for (let sample = 0; sample < 20; sample += 1) {
    const started = performance.now();
    let candidate = create(`sample-${sample}`);
    candidate = startAgentRun(candidate, {
      runId: `sample-run-${sample}`,
      snapshot: snapshotFor(`sample-${sample}`, "paper-a", "source-a"),
      model: null,
      now,
    });
    candidate = finishAgentRun(candidate, `sample-run-${sample}`, { status: "completed", now });
    activeAgentBranch(candidate);
    samples.push({ operationMs: performance.now() - started });
  }
  const timings = samples.map((sample) => sample.operationMs);
  const errors = [
    isolatedContexts || "session contexts leaked",
    concurrentSessionRuns || "independent sessions could not run concurrently",
    snapshotsStable || "run snapshot changed with live context",
    orderedEvents || "event sequence was not monotonic",
  ].filter((value): value is string => typeof value === "string");

  return {
    probeId: "gate0.local-sessions",
    fixtureVersion: GATE_0_FIXTURE_VERSION,
    status: errors.length === 0 ? "pass" : "fail",
    environment: { node: process.versions.node, platform: process.platform, arch: process.arch },
    input: { fixture: "two runtimes, two sessions, isolated context snapshots", bytes: Buffer.byteLength(JSON.stringify(workspace)) },
    metrics: {
      sampleCount: timings.length,
      p50Ms: percentile(timings, 50),
      p95Ms: percentile(timings, 95),
      p99Ms: percentile(timings, 99),
    },
    details: { sessionCount: workspace.sessions.length, isolatedContexts, concurrentSessionRuns, snapshotsStable, orderedEvents, samples },
    errors,
  };
}
