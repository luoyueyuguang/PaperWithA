import type { SyncEnvelope } from "./sync.js";
import type { SyncPort, SyncPullResult, SyncPushResult } from "./server.js";

export class HttpSyncPort implements SyncPort {
  constructor(private readonly endpoint: string, private readonly fetchImpl: typeof fetch = globalThis.fetch) {}
  async push(entries: readonly SyncEnvelope[]): Promise<SyncPushResult[]> {
    const response = await this.fetchImpl(`${this.endpoint.replace(/\/$/, "")}/v1/sync/push`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(entries) });
    if (!response.ok) throw new Error(`sync push failed: HTTP ${response.status}`);
    const payload = await response.json() as unknown;
    if (!Array.isArray(payload)) throw new Error("sync push response must be an array");
    return payload as SyncPushResult[];
  }
  async pull(cursor: number | null): Promise<SyncPullResult> {
    const suffix = cursor === null ? "" : `?cursor=${encodeURIComponent(String(cursor))}`;
    const response = await this.fetchImpl(`${this.endpoint.replace(/\/$/, "")}/v1/sync/pull${suffix}`);
    if (!response.ok) throw new Error(`sync pull failed: HTTP ${response.status}`);
    const payload = await response.json() as SyncPullResult;
    if (!Array.isArray(payload.entries)) throw new Error("sync pull response must contain entries");
    return payload;
  }
}
