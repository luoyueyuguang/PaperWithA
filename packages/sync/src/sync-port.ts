import type { SyncEnvelope, PushReceipt, PullResult } from "./sync-envelope.js";

export interface SyncPort {
  push(entries: SyncEnvelope[]): Promise<PushReceipt[]>;
  pull(cursor: number | null, limit: number): Promise<PullResult>;
}
