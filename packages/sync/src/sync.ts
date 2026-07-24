export interface SyncEnvelope {
  operationId: string;
  actorId: string;
  deviceId: string;
  entityType: string;
  entityId: string;
  baseRevision: string | null;
  payload: unknown;
  createdAt: string;
  serverSequence?: number;
  tombstone?: boolean;
}

export type PushStatus = "accepted" | "duplicate" | "conflict" | "rejected";

function containsSensitiveKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => containsSensitiveKey(item));
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(([key, nested]) => {
    const normalized = key.toLowerCase();
    return normalized === "apikey"
      || normalized === "api_key"
      || normalized === "secret"
      || normalized === "password"
      || containsSensitiveKey(nested);
  });
}

export function assertSyncPayload(payload: unknown): void {
  if (containsSensitiveKey(payload)) throw new Error("sensitive credentials cannot enter SyncEnvelope");
}
export class Outbox {
  private readonly entries = new Map<string, SyncEnvelope>();

  enqueue(entry: SyncEnvelope): void {
    assertSyncPayload(entry.payload);
    if (!this.entries.has(entry.operationId)) this.entries.set(entry.operationId, entry);
  }

  pending(): SyncEnvelope[] {
    return [...this.entries.values()];
  }

  acknowledge(operationId: string): void {
    this.entries.delete(operationId);
  }
}

export class IdempotentInbox {
  private readonly appliedOperationIds = new Set<string>();

  apply(
    entry: SyncEnvelope,
    currentRevision: string | null,
    project: (payload: unknown) => void,
  ): PushStatus {
    if (this.appliedOperationIds.has(entry.operationId)) return "duplicate";
    if (entry.baseRevision !== null && entry.baseRevision !== currentRevision) return "conflict";
    project(entry.payload);
    this.appliedOperationIds.add(entry.operationId);
    return "accepted";
  }

  get appliedCount(): number {
    return this.appliedOperationIds.size;
  }
}

export function nextCursor(entries: readonly SyncEnvelope[], currentCursor: number | null): number | null {
  const sequences = entries
    .map((entry) => entry.serverSequence)
    .filter((sequence): sequence is number => sequence !== undefined);
  if (sequences.length === 0) return currentCursor;
  return Math.max(currentCursor ?? 0, ...sequences);
}
