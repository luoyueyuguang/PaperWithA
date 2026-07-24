import { describe, expect, it } from "vitest";
import { IdempotentInbox, Outbox } from "../src/sync.js";

describe("sync operations", () => {
  it("applies one operation once and keeps conflicts visible", () => {
    const entry = {
      operationId: "op-1",
      actorId: "actor",
      deviceId: "device",
      entityType: "annotation",
      entityId: "annotation",
      baseRevision: null,
      payload: { text: "note" },
      createdAt: "2026-07-23T00:00:00.000Z",
    };
    const outbox = new Outbox();
    const inbox = new IdempotentInbox();
    let applied = 0;
    outbox.enqueue(entry);
    outbox.enqueue(entry);

    expect(inbox.apply(entry, null, () => { applied += 1; })).toBe("accepted");
    expect(inbox.apply(entry, null, () => { applied += 1; })).toBe("duplicate");
    expect(inbox.apply({ ...entry, operationId: "op-2", baseRevision: "old" }, "new", () => { applied += 1; })).toBe("conflict");
    expect(outbox.pending()).toHaveLength(1);
    expect(applied).toBe(1);
  });
  it("rejects API keys before adding them to the outbox", () => {
    const outbox = new Outbox();
    expect(() => outbox.enqueue({
      operationId: "op-secret",
      actorId: "actor",
      deviceId: "device",
      entityType: "annotation",
      entityId: "annotation",
      baseRevision: null,
      payload: { apiKey: "secret" },
      createdAt: "2026-07-23T00:00:00.000Z",
    })).toThrow("sensitive credentials");
    expect(outbox.pending()).toHaveLength(0);
  });
});
