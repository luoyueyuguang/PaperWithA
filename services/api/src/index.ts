import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { InMemorySyncServer } from "@paperwitha/sync";

const syncServer = new InMemorySyncServer();
const PORT = Number(process.env["PORT"]) || 4120;

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  // POST /sync/push
  if (req.method === "POST" && url.pathname === "/sync/push") {
    try {
      const body = await readBody(req);
      const entries = JSON.parse(body);
      if (!Array.isArray(entries)) return json(res, 400, { error: "expected array" });
      const receipts = syncServer.push(entries);
      return json(res, 200, receipts);
    } catch {
      return json(res, 400, { error: "invalid request" });
    }
  }

  // GET /sync/pull?cursor=N&limit=N
  if (req.method === "GET" && url.pathname === "/sync/pull") {
    const cursor = url.searchParams.has("cursor") ? Number(url.searchParams.get("cursor")) : null;
    const limit = Number(url.searchParams.get("limit")) || 50;
    const result = syncServer.pull(cursor, limit);
    return json(res, 200, result);
  }

  // GET /health
  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { status: "ok", operationCount: syncServer.count });
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`PaperWithA sync API listening on http://localhost:${PORT}`);
});
