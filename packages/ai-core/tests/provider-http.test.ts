import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { ProviderClient } from "../src/provider.js";

let server: Server;
let endpoint = "";

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.method !== "POST") { response.statusCode = 404; response.end(); return; }
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end('data: {"delta":"network"}\n\ndata: [DONE]\n\n');
  }).listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("provider test server did not expose a port");
  endpoint = `http://127.0.0.1:${address.port}/chat`;
});

afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

describe("ProviderClient HTTP", () => {
  it("streams from an actual local SSE endpoint", async () => {
    const url = new URL(endpoint);
    const client = new ProviderClient({ providerId: "local", manifestVersion: "1", apiVersion: "paperwitha.provider.v1", transport: "sse", endpoint, allowedDomains: [url.hostname], authentication: { scheme: "none" }, requestMapping: { kind: "json-pointer", path: "" }, responseMapping: { kind: "json-pointer", path: "/delta" } });
    const events = [];
    for await (const event of client.streamChat({ model: "local", messages: [{ role: "user", content: "hello" }] })) events.push(event);
    expect(events).toEqual([{ kind: "delta", text: "network" }, { kind: "done", text: "" }]);
  });
});
