import { assertSyncPayload, type PushStatus, type SyncEnvelope } from "./sync.js";

export interface SyncPushResult {
  operationId: string;
  status: PushStatus;
  serverSequence?: number;
  revision?: string;
}

export interface SyncPullResult {
  cursor: number | null;
  entries: SyncEnvelope[];
}

export interface SyncPort {
  push(entries: readonly SyncEnvelope[]): Promise<SyncPushResult[]>;
  pull(cursor: number | null): Promise<SyncPullResult>;
}

export class InMemorySyncServer implements SyncPort {
  private readonly operations = new Map<string, SyncEnvelope>();
  private readonly revisions = new Map<string, string>();
  private sequence = 0;

  async push(entries: readonly SyncEnvelope[]): Promise<SyncPushResult[]> {
    return entries.map((entry) => this.pushOne(entry));
  }

  async pull(cursor: number | null): Promise<SyncPullResult> {
    const entries = [...this.operations.values()]
      .filter((entry) => (entry.serverSequence ?? 0) > (cursor ?? 0))
      .sort((left, right) => (left.serverSequence ?? 0) - (right.serverSequence ?? 0));
    return { cursor: entries.length ? entries[entries.length - 1]!.serverSequence ?? cursor : cursor, entries: structuredClone(entries) };
  }

  private pushOne(entry: SyncEnvelope): SyncPushResult {
    assertSyncPayload(entry.payload);
    const existing = this.operations.get(entry.operationId);
    if (existing) {
      if (existing.serverSequence === undefined) return { operationId: entry.operationId, status: "duplicate" };
      const revision = this.revisions.get(`${entry.entityType}:${entry.entityId}`);
      return { operationId: entry.operationId, status: "duplicate", serverSequence: existing.serverSequence, ...(revision ? { revision } : {}) };
    }
    const entityKey = `${entry.entityType}:${entry.entityId}`;
    const currentRevision = this.revisions.get(entityKey) ?? null;
    if (entry.baseRevision !== null && entry.baseRevision !== currentRevision) {
      return currentRevision === null ? { operationId: entry.operationId, status: "conflict" } : { operationId: entry.operationId, status: "conflict", revision: currentRevision };
    }
    const serverSequence = ++this.sequence;
    const revision = `server-r${serverSequence}`;
    const stored = { ...structuredClone(entry), serverSequence };
    this.operations.set(entry.operationId, stored);
    this.revisions.set(entityKey, revision);
    return { operationId: entry.operationId, status: "accepted", serverSequence, revision };
  }
}
