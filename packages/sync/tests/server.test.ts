import { describe, expect, it } from "vitest";
import { InMemorySyncServer } from "../src/server.js";

describe("InMemorySyncServer", () => {
  it("is idempotent and exposes cursor-based pull", async () => {
    const server = new InMemorySyncServer();
    const entry = { operationId: "op-1", actorId: "a", deviceId: "d", entityType: "note", entityId: "n", baseRevision: null, payload: { text: "hello" }, createdAt: "2026-01-01T00:00:00.000Z" };
    expect((await server.push([entry]))[0]?.status).toBe("accepted");
    expect((await server.push([entry]))[0]?.status).toBe("duplicate");
    const pulled = await server.pull(null);
    expect(pulled.entries).toHaveLength(1);
    expect((await server.pull(pulled.cursor)).entries).toHaveLength(0);
  });

  it("rejects stale revisions without storing the operation", async () => {
    const server = new InMemorySyncServer();
    const base = { operationId: "op-1", actorId: "a", deviceId: "d", entityType: "note", entityId: "n", baseRevision: null, payload: {}, createdAt: "2026-01-01T00:00:00.000Z" };
    const accepted = (await server.push([base]))[0]!;
    const conflict = await server.push([{ ...base, operationId: "op-2", baseRevision: "old" }]);
    expect(accepted.status).toBe("accepted");
    expect(conflict[0]?.status).toBe("conflict");
    expect((await server.pull(null)).entries).toHaveLength(1);
  });
});
