import { describe, expect, it } from "vitest";
import { JsonRepository, MemoryStoragePort } from "../src/storage.js";

describe("JsonRepository", () => {
  it("round-trips JSON and discards corrupt state", () => {
    const port = new MemoryStoragePort();
    const repository = new JsonRepository<{ count: number }>(port, "state");
    repository.write({ count: 2 });
    expect(repository.read({ count: 0 })).toEqual({ count: 2 });
    port.set("state", "not-json");
    expect(repository.read({ count: 0 })).toEqual({ count: 0 });
    expect(port.get("state")).toBeNull();
  });
});
