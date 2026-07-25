import type { SyncEnvelope } from "./sync-envelope.js";

const SENSITIVE_KEY_PATTERNS = /\b(api[_-]?key|secret|password|token|credential|auth)\b/i;

/** Reject envelopes carrying plaintext credentials before local enqueue. */
export function hasSensitivePayload(envelope: SyncEnvelope): boolean {
  if (envelope.entityType === "credential") return true;
  return hasSensitiveData(envelope.payload);
}

function hasSensitiveData(value: unknown): boolean {
  if (typeof value === "string") return SENSITIVE_KEY_PATTERNS.test(value);
  if (typeof value !== "object" || value === null) return false;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERNS.test(key)) return true;
    if (hasSensitiveData((value as Record<string, unknown>)[key])) return true;
  }
  return false;
}

/** Build a SyncEnvelope with required fields. */
export function createEnvelope(params: {
  operationId: string;
  actorId: string;
  deviceId: string;
  entityType: string;
  entityId: string;
  baseRevision: string | null;
  payload: unknown;
  createdAt: string;
  tombstone?: boolean;
}): SyncEnvelope | { error: "sensitive_payload" } {
  const envelope: SyncEnvelope = {
    operationId: params.operationId,
    actorId: params.actorId,
    deviceId: params.deviceId,
    entityType: params.entityType,
    entityId: params.entityId,
    baseRevision: params.baseRevision,
    payload: params.payload,
    createdAt: params.createdAt,
  };
  if (params.tombstone !== undefined) envelope.tombstone = params.tombstone;
  if (hasSensitivePayload(envelope)) return { error: "sensitive_payload" };
  return envelope;
}
