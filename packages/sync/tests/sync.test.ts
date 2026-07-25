import { describe, expect, it } from "vitest";
import { createEnvelope, hasSensitivePayload } from "../src/envelope-guard.js";
import { createOutbox, enqueue, pushPending, ackPushed } from "../src/outbox.js";
import { createInbox, applyPull, serializeInbox, deserializeInbox } from "../src/inbox.js";
import { InMemorySyncServer } from "../src/server.js";
import type { SyncPort, SyncEnvelope } from "../src/index.js";

function makeEntry(overrides: Partial<SyncEnvelope> = {}): SyncEnvelope {
  return {
    operationId: `op-${Math.random().toString(16).slice(2)}`,
    actorId: "test",
    deviceId: "test-device",
    entityType: "chat-message",
    entityId: "msg-1",
    baseRevision: "rev-1",
    payload: { text: "hello" },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const mockPort: SyncPort = {
  async push() {
    return [{ operationId: "op-1", status: "accepted" }];
  },
  async pull() {
    return { entries: [], nextCursor: null };
  },
};

describe("envelope guard", () => {
  it("rejects api-key in payload", () => {
    const env = makeEntry({ payload: { apiKey: "sk-123" } });
    expect(hasSensitivePayload(env)).toBe(true);
  });

  it("rejects credential entity type", () => {
    const env = makeEntry({ entityType: "credential" });
    expect(hasSensitivePayload(env)).toBe(true);
  });

  it("allows normal payloads", () => {
    const env = makeEntry({ payload: { text: "hello" } });
    expect(hasSensitivePayload(env)).toBe(false);
  });

  it("createEnvelope rejects sensitive payload", () => {
    const result = createEnvelope({
      operationId: "op-1",
      actorId: "test",
      deviceId: "test",
      entityType: "chat-message",
      entityId: "msg-1",
      baseRevision: null,
      payload: { password: "secret" },
      createdAt: new Date().toISOString(),
    });
    expect(result).toEqual({ error: "sensitive_payload" });
  });
});

describe("outbox", () => {
  it("enqueues and pushes", async () => {
    const outbox = createOutbox();
    const entry = makeEntry();
    const withPending = enqueue(outbox, entry);
    if ("error" in withPending) throw new Error("unexpected");
    expect(withPending.pending).toHaveLength(1);
  });

  it("rejects sensitive payload at enqueue", () => {
    const result = enqueue(createOutbox(), makeEntry({ payload: { apiKey: "sk-123" } }));
    expect(result).toEqual({ error: "sensitive_payload" });
  });

  it("acks successfully pushed entries", () => {
    const outbox = createOutbox();
    const entry = makeEntry();
    const withPending = enqueue(outbox, entry);
    if ("error" in withPending) throw new Error("unexpected");
    const acked = ackPushed(withPending, [{ operationId: entry.operationId, status: "accepted" }]);
    expect(acked.pending).toHaveLength(0);
  });

  it("keeps conflicting entries unacked", () => {
    const outbox = createOutbox();
    const entry = makeEntry();
    const withPending = enqueue(outbox, entry);
    if ("error" in withPending) throw new Error("unexpected");
    const acked = ackPushed(withPending, [{ operationId: entry.operationId, status: "conflict" }]);
    expect(acked.pending).toHaveLength(1);
  });
});

describe("inbox", () => {
  it("applies new entries and ignores duplicates", () => {
    const inbox = createInbox();
    const e1 = makeEntry({ operationId: "op-1" });
    const first = applyPull(inbox, [e1], 1);
    expect(first.newEntries).toHaveLength(1);

    const second = applyPull(first.inbox, [e1], 1);
    expect(second.newEntries).toHaveLength(0);
  });

  it("round-trips serialization", () => {
    const inbox = createInbox();
    const e1 = makeEntry({ operationId: "op-1" });
    const applied = applyPull(inbox, [e1], 3);
    const serialized = serializeInbox(applied.inbox);
    const restored = deserializeInbox(serialized);
    expect(restored.cursor).toBe(3);
    expect(restored.processedIds.has("op-1")).toBe(true);
  });
});

describe("InMemorySyncServer", () => {
  it("accepts and pulls operations", () => {
    const server = new InMemorySyncServer();
    const entry = makeEntry();
    const receipts = server.push([entry]);
    expect(receipts[0]?.status).toBe("accepted");

    const result = server.pull(null, 10);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.operationId).toBe(entry.operationId);
    expect(result.entries[0]?.serverSequence).toBe(1);
  });

  it("handles duplicates", () => {
    const server = new InMemorySyncServer();
    const entry = makeEntry();
    server.push([entry]);
    const receipts = server.push([entry]);
    expect(receipts[0]?.status).toBe("duplicate");
  });

  it("rejects sensitive payloads server-side", () => {
    const server = new InMemorySyncServer();
    const entry = makeEntry({ payload: { secret: "abc" } });
    const receipts = server.push([entry]);
    expect(receipts[0]?.status).toBe("rejected");
  });

  it("pagination works", () => {
    const server = new InMemorySyncServer();
    server.push([makeEntry(), makeEntry(), makeEntry()]);
    const page1 = server.pull(null, 2);
    expect(page1.entries).toHaveLength(2);
    expect(page1.nextCursor).toBe(2);
    const page2 = server.pull(page1.nextCursor, 2);
    expect(page2.entries).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
  });
});
