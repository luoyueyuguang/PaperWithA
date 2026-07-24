import { performance } from "node:perf_hooks";
import { GATE_0_FIXTURE_VERSION, percentile, type ProbeReport } from "../../packages/contracts/src/probe.js";
import { IdempotentInbox, nextCursor, Outbox, type SyncEnvelope } from "../../packages/sync/src/index.js";

export interface SyncProbeDetails {
  localCommitBeforePush: boolean;
  pendingBeforePush: number;
  firstPushStatus: string;
  duplicatePushStatus: string;
  conflictStatus: string;
  cursorRecovered: boolean;
  replayCount: number;
  apiKeyInEnvelope: boolean;
}

export async function runSyncProbe(): Promise<ProbeReport<SyncProbeDetails>> {
  const entry: SyncEnvelope = {
    operationId: "operation-1",
    actorId: "actor-1",
    deviceId: "device-1",
    entityType: "annotation",
    entityId: "annotation-1",
    baseRevision: null,
    payload: { text: "offline note" },
    createdAt: "2026-07-23T00:00:00.000Z",
  };
  const conflictEntry: SyncEnvelope = {
    ...entry,
    operationId: "operation-2",
    baseRevision: "revision-0",
    payload: { text: "conflicting note" },
  };
  const acceptedPullEntry: SyncEnvelope = {
    ...entry,
    operationId: "operation-pull-1",
    serverSequence: 12,
  };
  const outbox = new Outbox();
  const inbox = new IdempotentInbox();
  const localProjection: unknown[] = [];
  const timings: number[] = [];
  const started = performance.now();
  localProjection.push(entry.payload);
  outbox.enqueue(entry);
  outbox.enqueue(entry);
  const pendingBeforePush = outbox.pending().length;
  const localProjectionBeforePush = localProjection.length;
  const firstPushStatus = inbox.apply(entry, null, (payload) => localProjection.push(payload));
  const duplicatePushStatus = inbox.apply(entry, null, (payload) => localProjection.push(payload));
  const conflictStatus = inbox.apply(conflictEntry, "revision-1", (payload) => localProjection.push(payload));
  const cursor = nextCursor([acceptedPullEntry], null);
  const resumedCursor = nextCursor([], cursor);
  let apiKeyInEnvelope = true;
  try {
    outbox.enqueue({ ...entry, operationId: "operation-forbidden", payload: { apiKey: "secret" } });
  } catch {
    apiKeyInEnvelope = false;
  }
  timings.push(performance.now() - started);
  for (let sample = 0; sample < 10; sample += 1) {
    const sampleInbox = new IdempotentInbox();
    const sampleStarted = performance.now();
    sampleInbox.apply(entry, null, () => undefined);
    sampleInbox.apply(entry, null, () => undefined);
    timings.push(performance.now() - sampleStarted);
  }
  const localCommitBeforePush = pendingBeforePush === 1 && localProjectionBeforePush === 1;
  const cursorRecovered = cursor === 12 && resumedCursor === 12;
  const replayCount = inbox.appliedCount;
  const status = localCommitBeforePush
    && firstPushStatus === "accepted"
    && duplicatePushStatus === "duplicate"
    && conflictStatus === "conflict"
    && cursorRecovered
    && replayCount === 1
    && !apiKeyInEnvelope
    ? "pass"
    : "fail";

  return {
    probeId: "gate0.sync",
    fixtureVersion: GATE_0_FIXTURE_VERSION,
    status,
    environment: { node: process.versions.node, platform: process.platform, arch: process.arch },
    input: { fixture: "offline-duplicate-conflict", bytes: JSON.stringify(entry).length },
    metrics: { sampleCount: timings.length, p50Ms: percentile(timings, 50), p95Ms: percentile(timings, 95), p99Ms: percentile(timings, 99) },
    details: {
      localCommitBeforePush,
      pendingBeforePush,
      firstPushStatus,
      duplicatePushStatus,
      conflictStatus,
      cursorRecovered,
      replayCount,
      apiKeyInEnvelope,
    },
    errors: [],
  };
}
