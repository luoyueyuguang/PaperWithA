import type { SyncEnvelope, PushReceipt, PullResult } from "./sync-envelope.js";
import { hasSensitivePayload } from "./envelope-guard.js";

/** Server-side in-memory sync store. Single-process, no persistence. */
export class InMemorySyncServer {
  private readonly operations: SyncEnvelope[] = [];
  private readonly operationIds = new Set<string>();
  private nextSequence = 1;

  /** Accept a push batch. Rejects sensitive payloads. */
  push(entries: SyncEnvelope[]): PushReceipt[] {
    return entries.map((entry) => {
      if (hasSensitivePayload(entry)) {
        return { operationId: entry.operationId, status: "rejected" as const };
      }
      if (this.operationIds.has(entry.operationId)) {
        return { operationId: entry.operationId, status: "duplicate" as const };
      }
      const stored: SyncEnvelope = { ...entry, serverSequence: this.nextSequence++ };
      this.operations.push(stored);
      this.operationIds.add(stored.operationId);
      return { operationId: stored.operationId, status: "accepted" as const };
    });
  }

  /** Pull operations after a cursor. */
  pull(cursor: number | null, limit: number): PullResult {
    const start = cursor ?? 0;
    const slice = this.operations.slice(start, start + limit);
    const nextCursor = start + slice.length < this.operations.length ? start + slice.length : null;
    return { entries: slice, nextCursor };
  }

  /** Number of stored operations. */
  get count(): number {
    return this.operations.length;
  }
}
