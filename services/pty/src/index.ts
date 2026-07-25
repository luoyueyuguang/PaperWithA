import { spawn, type ChildProcess } from "node:child_process";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { WebSocketServer, type WebSocket } from "ws";

/** Resolve papers directory cross-platform via XDG (Linux), ~/Library (macOS), %APPDATA% (Windows). */
function resolvePapersDir(): string {
  const home = homedir();
  const p = platform();

  if (p === "win32") {
    const appData = process.env["APPDATA"] ?? join(home, "AppData", "Roaming");
    return join(appData, "paperwitha", "papers");
  }
  if (p === "darwin") {
    return join(home, "Library", "Application Support", "paperwitha", "papers");
  }
  // Linux / others: XDG
  const xdg = (process.env["XDG_DATA_HOME"] as string) ?? join(home, ".local", "share");
  return join(xdg, "paperwitha", "papers");
}

/** Pick the best available shell for the current platform. */
function resolveShell(): { bin: string; args: string[] } {
  const p = platform();
  if (p === "win32") {
    return { bin: "cmd.exe", args: [] };
  }
  const envShell = process.env["SHELL"];
  if (envShell) return { bin: envShell, args: [] };
  return { bin: "/bin/bash", args: [] };
}

const papersDir = resolvePapersDir();
mkdirSync(papersDir, { recursive: true });

const { bin, args } = resolveShell();
const PORT = 4121;
const wss = new WebSocketServer({ port: PORT });
console.log(`[pty] :${PORT}  ${bin}  cwd: ${papersDir}`);

wss.on("connection", (ws: WebSocket) => {
  console.log("[pty] connect");
  const shell: ChildProcess = spawn(bin, args, {
    cwd: papersDir,
    env: { ...process.env, TERM: "xterm-256color" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const send = (data: string) => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  };

  shell.stdout?.on("data", (d: Buffer) => send(d.toString()));
  shell.stderr?.on("data", (d: Buffer) => send(d.toString()));
  shell.on("exit", () => { try { ws.close(); } catch { /* */ } });

  ws.on("message", (raw) => shell.stdin?.write(raw.toString()));
  ws.on("close", () => shell.kill());
  ws.on("error", () => shell.kill());
  setTimeout(() => send(""), 100);
});

process.on("SIGINT", () => { wss.close(); process.exit(); });
process.on("SIGTERM", () => { wss.close(); process.exit(); });
