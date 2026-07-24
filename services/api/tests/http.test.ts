import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createSyncApi } from "../src/app.js";
import { HttpSyncPort } from "@paperwitha/sync";

let server: Server;
let endpoint = "";

beforeAll(async () => {
  server = createSyncApi().listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("sync test server did not expose a port");
  endpoint = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

describe("sync HTTP API", () => {
  it("round-trips push and pull through the actual HTTP server", async () => {
    const port = new HttpSyncPort(endpoint);
    const results = await port.push([{ operationId: "http-op-1", actorId: "a", deviceId: "d", entityType: "note", entityId: "n", baseRevision: null, payload: { text: "hello" }, createdAt: "2026-01-01T00:00:00Z" }]);
    expect(results[0]?.status).toBe("accepted");
    const pulled = await port.pull(null);
    expect(pulled.entries[0]?.operationId).toBe("http-op-1");
  });
});
