import type { SyncEnvelope, PushReceipt, PullResult } from "./sync-envelope.js";
import type { SyncPort } from "./sync-port.js";
import { hasSensitivePayload } from "./envelope-guard.js";

/** HTTP transport for the sync port. Communicates with the sync API service. */
export class HttpSyncPort implements SyncPort {
  constructor(private readonly baseUrl: string) {}

  async push(entries: SyncEnvelope[]): Promise<PushReceipt[]> {
    const safe = entries.map((e) => {
      if (hasSensitivePayload(e)) return { ...e, payload: null, rejected: true };
      return e;
    });
    const response = await fetch(`${this.baseUrl}/sync/push`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(safe),
    });
    if (!response.ok) throw new Error(`sync push failed: ${response.status}`);
    return (await response.json()) as PushReceipt[];
  }

  async pull(cursor: number | null, limit: number): Promise<PullResult> {
    const params = new URLSearchParams();
    if (cursor !== null) params.set("cursor", String(cursor));
    params.set("limit", String(limit));
    const response = await fetch(`${this.baseUrl}/sync/pull?${params.toString()}`);
    if (!response.ok) throw new Error(`sync pull failed: ${response.status}`);
    return (await response.json()) as PullResult;
  }
}
