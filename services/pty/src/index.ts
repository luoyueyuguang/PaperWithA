import { createServer } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { platform } from "node:os";
import { mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { WebSocketServer, type WebSocket } from "ws";
import { paperwithaPaths } from "@paperwitha/paper-store";

const { papersDir } = paperwithaPaths();
mkdirSync(papersDir, { recursive: true });

const shell = platform() === "win32"
  ? { bin: "cmd.exe", args: [] as string[] }
  : { bin: (process.env["SHELL"] as string) || "/bin/bash", args: [] as string[] };

const PORT = 4121;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const httpServer = createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  // DELETE /papers/:filename — remove a paper file
  if (req.method === "DELETE" && req.url?.startsWith("/papers/")) {
    const filename = decodeURIComponent(req.url.slice(8));
    const filePath = join(papersDir, filename);
    try {
      await unlink(filePath);
      console.log(`[pty] deleted: ${filename}`);
      res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
      res.end(JSON.stringify({ deleted: filename }));
    } catch {
      res.writeHead(404, { ...corsHeaders, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    }
    return;
  }

  // DELETE /papers — remove all paper files
  if (req.method === "DELETE" && req.url === "/papers") {
    try {
      const files = (await readdir(papersDir)).filter((f) => f.endsWith(".pdf"));
      let deleted = 0;
      for (const f of files) {
        try { await unlink(join(papersDir, f)); deleted++; } catch { /* skip */ }
      }
      console.log(`[pty] bulk deleted: ${deleted} files`);
      res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
      res.end(JSON.stringify({ deleted }));
    } catch {
      res.writeHead(500, corsHeaders);
      res.end(JSON.stringify({ error: "clear failed" }));
    }
    return;
  }

  // GET /papers — list papers
  if (req.method === "GET" && req.url === "/papers") {
    try {
      const files = (await readdir(papersDir)).filter((f) => f.endsWith(".pdf"));
      res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
      res.end(JSON.stringify({ files }));
    } catch {
      res.writeHead(500, corsHeaders);
      res.end(JSON.stringify({ error: "read failed" }));
    }
    return;
  }

  res.writeHead(404, corsHeaders);
  res.end("not found");
});

const wss = new WebSocketServer({ server: httpServer });

httpServer.listen(PORT, () => {
  console.log(`[pty] :${PORT}  ${shell.bin}  cwd: ${papersDir}`);
});

wss.on("connection", (ws: WebSocket) => {
  const proc: ChildProcess = spawn(shell.bin, shell.args, {
    cwd: papersDir,
    env: { ...process.env, TERM: "xterm-256color" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const send = (d: string) => { if (ws.readyState === ws.OPEN) ws.send(d); };
  proc.stdout?.on("data", (d: Buffer) => send(d.toString()));
  proc.stderr?.on("data", (d: Buffer) => send(d.toString()));
  proc.on("exit", () => { try { ws.close(); } catch {} });

  ws.on("message", (raw) => proc.stdin?.write(raw.toString()));
  ws.on("close", () => proc.kill());
  ws.on("error", () => proc.kill());
});

process.on("SIGINT", () => { wss.close(); httpServer.close(); process.exit(); });
process.on("SIGTERM", () => { wss.close(); httpServer.close(); process.exit(); });
