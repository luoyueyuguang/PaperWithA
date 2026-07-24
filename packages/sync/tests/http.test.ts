import { describe, expect, it } from "vitest";
import { HttpSyncPort } from "../src/http.js";

describe("HttpSyncPort", () => {
  it("uses the push and pull protocol", async () => {
    const requests: string[] = [];
    const port = new HttpSyncPort("http://sync.test", async (input) => {
      requests.push(String(input));
      return String(input).endsWith("/push")
        ? new Response(JSON.stringify([{ operationId: "op-1", status: "accepted", serverSequence: 1, revision: "r1" }]), { status: 200 })
        : new Response(JSON.stringify({ cursor: 1, entries: [] }), { status: 200 });
    });
    const result = await port.push([{ operationId: "op-1", actorId: "a", deviceId: "d", entityType: "note", entityId: "n", baseRevision: null, payload: {}, createdAt: "2026-01-01T00:00:00Z" }]);
    const pulled = await port.pull(null);
    expect(result[0]?.status).toBe("accepted");
    expect(pulled.cursor).toBe(1);
    expect(requests).toEqual(["http://sync.test/v1/sync/push", "http://sync.test/v1/sync/pull"]);
  });
});
