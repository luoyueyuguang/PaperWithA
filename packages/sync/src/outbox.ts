import type { SyncEnvelope, PushReceipt } from "./sync-envelope.js";
import type { SyncPort } from "./sync-port.js";
import { hasSensitivePayload } from "./envelope-guard.js";

export type OutboxState = {
  pending: SyncEnvelope[];
  lastSuccessfulCursor: number | null;
};

export function createOutbox(): OutboxState {
  return { pending: [], lastSuccessfulCursor: null };
}

/** Enqueue a locally-generated operation. Rejects sensitive payloads. */
export function enqueue(outbox: OutboxState, envelope: SyncEnvelope): OutboxState | { error: "sensitive_payload" } {
  if (hasSensitivePayload(envelope)) return { error: "sensitive_payload" };
  return { ...outbox, pending: [...outbox.pending, envelope] };
}

/** Attempt to push all pending envelopes. Returns receipts + remaining pending. */
export async function pushPending(
  outbox: OutboxState,
  port: SyncPort,
): Promise<{ outbox: OutboxState; receipts: PushReceipt[] }> {
  if (!outbox.pending.length) return { outbox, receipts: [] };
  try {
    const receipts = await port.push(outbox.pending);
    const rejected = new Set(receipts.filter((r) => r.status === "rejected").map((r) => r.operationId));
    const conflicts = new Set(receipts.filter((r) => r.status === "conflict").map((r) => r.operationId));
    const pending = outbox.pending.filter((e) => rejected.has(e.operationId) || conflicts.has(e.operationId));
    return { outbox: { ...outbox, pending }, receipts };
  } catch {
    return { outbox, receipts: outbox.pending.map((e) => ({ operationId: e.operationId, status: "rejected" as const })) };
  }
}

/** Remove successfully pushed entries from the outbox. */
export function ackPushed(outbox: OutboxState, receipts: PushReceipt[]): OutboxState {
  const acked = new Set(receipts.filter((r) => r.status === "accepted" || r.status === "duplicate").map((r) => r.operationId));
  return { ...outbox, pending: outbox.pending.filter((e) => !acked.has(e.operationId)) };
}
