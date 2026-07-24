import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { InMemorySyncServer } from "@paperwitha/sync";

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createSyncApi(store = new InMemorySyncServer()): Server {
  return createServer(async (request: IncomingMessage, response: ServerResponse) => {
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-headers", "content-type");
    if (request.method === "OPTIONS") { response.statusCode = 204; response.end(); return; }
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (request.method === "POST" && url.pathname === "/v1/sync/push") {
        const payload = await readJson(request);
        if (!Array.isArray(payload)) throw new Error("push body must be an array");
        response.end(JSON.stringify(await store.push(payload)));
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/sync/pull") {
        const rawCursor = url.searchParams.get("cursor");
        const cursor = rawCursor === null ? null : Number(rawCursor);
        response.end(JSON.stringify(await store.pull(Number.isFinite(cursor) ? cursor : null)));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not-found" }));
    } catch (error) {
      response.statusCode = 400;
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
}
