import type { SyncEnvelope } from "./sync-envelope.js";

export type InboxState = {
  processedIds: Set<string>;
  cursor: number | null;
};

export function createInbox(): InboxState {
  return { processedIds: new Set(), cursor: null };
}

/** Apply pulled envelopes, filtering out already-processed operations (idempotent). */
export function applyPull(
  inbox: InboxState,
  entries: SyncEnvelope[],
  nextCursor: number | null,
): { inbox: InboxState; newEntries: SyncEnvelope[] } {
  const newEntries: SyncEnvelope[] = [];
  const processedIds = new Set(inbox.processedIds);
  for (const entry of entries) {
    if (processedIds.has(entry.operationId)) continue;
    processedIds.add(entry.operationId);
    newEntries.push(entry);
  }
  return {
    inbox: { processedIds, cursor: nextCursor ?? inbox.cursor },
    newEntries,
  };
}

/** Serialize InboxState for persistence (Set → array for JSON). */
export function serializeInbox(inbox: InboxState): { processedIds: string[]; cursor: number | null } {
  return { processedIds: [...inbox.processedIds], cursor: inbox.cursor };
}

/** Deserialize InboxState from persistence. */
export function deserializeInbox(data: { processedIds?: string[]; cursor?: number | null }): InboxState {
  return {
    processedIds: new Set(data.processedIds ?? []),
    cursor: data.cursor ?? null,
  };
}
