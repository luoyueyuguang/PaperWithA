import { describe, expect, it } from "vitest";
import { evaluateMapping, parseSseEvents, ProviderClient, validateProviderManifest, type ProviderStreamError } from "../src/provider.js";

describe("ProviderManifest", () => {
  it("rejects executable mappings and undeclared domains", () => {
    const errors = validateProviderManifest({
      providerId: "fixture",
      apiVersion: "paperwitha.provider.v1",
      transport: "sse",
      endpoint: "https://unapproved.test/chat",
      allowedDomains: ["approved.test"],
      authentication: { scheme: "api-key" },
      requestMapping: { kind: "script", source: "danger" },
      responseMapping: { kind: "json-pointer", path: "/delta" },
    });
    expect(errors.map((error) => error.code)).toEqual(["undeclared-domain", "unsupported-mapping"]);
  });

  it("turns malformed SSE into a classified stream error", () => {
    try {
      parseSseEvents("data: {not-json}\n\n");
      throw new Error("expected malformed stream error");
    } catch (error) {
      expect((error as ProviderStreamError).code).toBe("malformed-stream");
    }
  });
  it("preserves SSE event order", () => {
    expect(parseSseEvents('data: {"delta":"a"}\n\ndata: [DONE]\n\n')).toEqual([
      { kind: "delta", text: "a" },
      { kind: "done", text: "" },
    ]);
  });
  it("maps OpenAI-style SSE payloads declaratively", () => {
    expect(parseSseEvents('data: {"choices":[{"delta":{"content":"mapped"}}]}\n\n', { kind: "json-pointer", path: "/choices/0/delta/content" })).toEqual([{ kind: "delta", text: "mapped" }]);
  });
  it("rejects manifests without an authentication scheme", () => {
    const errors = validateProviderManifest({
      providerId: "fixture",
      apiVersion: "paperwitha.provider.v1",
      transport: "sse",
      endpoint: "https://approved.test/chat",
      allowedDomains: ["approved.test"],
      requestMapping: { kind: "json-pointer", path: "/messages" },
      responseMapping: { kind: "json-pointer", path: "/delta" },
    });
    expect(errors.map((error) => error.code)).toContain("incomplete-auth");
  });
});

describe("ProviderClient", () => {
  const manifest = {
    providerId: "fixture",
    manifestVersion: "1",
    apiVersion: "paperwitha.provider.v1",
    transport: "sse" as const,
    endpoint: "https://approved.test/chat",
    allowedDomains: ["approved.test"],
    authentication: { scheme: "none" as const },
    requestMapping: { kind: "json-pointer" as const, path: "/messages" },
    responseMapping: { kind: "json-pointer" as const, path: "/delta" },
  };

  it("evaluates restricted declarative mappings", () => {
    expect(evaluateMapping({ kind: "list", items: [{ kind: "literal", value: "x" }, { kind: "json-pointer", path: "/name" }] }, { name: "y" })).toEqual(["x", "y"]);
  });

  it("streams SSE through the validated manifest", async () => {
    const client = new ProviderClient(manifest, { fetchImpl: async () => new Response('data: {"delta":"hello"}\n\ndata: [DONE]\n\n', { status: 200 }) });
    const events = [];
    for await (const event of client.streamChat({ model: "fixture", messages: [{ role: "user", content: "hi" }] })) events.push(event);
    expect(events).toEqual([{ kind: "delta", text: "hello" }, { kind: "done", text: "" }]);
  });
});
