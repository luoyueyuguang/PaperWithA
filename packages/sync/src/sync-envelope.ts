export type SyncEnvelope = {
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
};

export type PushStatus = "accepted" | "duplicate" | "conflict" | "rejected";

export type PushReceipt = {
  operationId: string;
  status: PushStatus;
};

export type PullResult = {
  entries: SyncEnvelope[];
  nextCursor: number | null;
};
