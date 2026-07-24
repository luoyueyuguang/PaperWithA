import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline/promises";
import type { Readable } from "node:stream";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";

export interface JsonlRpcOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  readyEvent: string;
  readyTimeoutMs?: number;
}

export interface JsonlRpcRequest {
  id?: string;
  type: string;
  [key: string]: unknown;
}

export interface JsonlRpcResponse {
  id?: string;
  type: string;
  success?: boolean;
  data?: unknown;
  error?: string;
  command?: string;
  [key: string]: unknown;
}

export interface JsonlRpcEvent {
  type: string;
  [key: string]: unknown;
}

export type JsonlRpcFrame = JsonlRpcResponse | JsonlRpcEvent;

export class JsonlRpcProcess {
  readonly pid: number;
  private process: ChildProcessWithoutNullStreams;
  readonly workingDirectory: string;
  private nextId = 0;
  private pendingRequests = new Map<string, (frame: JsonlRpcResponse) => void>();

  private constructor(process: ChildProcessWithoutNullStreams, workingDirectory: string) {
    this.process = process;
    this.pid = process.pid!;
    this.workingDirectory = workingDirectory;
  }

  static async spawn(options: JsonlRpcOptions): Promise<JsonlRpcProcess> {
    const env = { ...process.env, ...options.env };
    const workingDir = options.cwd ?? join(tmpdir(), await mkdtemp("paperwitha-sandbox-"));
    const child = spawn(options.command, options.args, {
      cwd: workingDir,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.on("error", () => { /* caller observes close */ });
    child.stderr.on("data", () => { /* captured for debugging */ });

    const instance = new JsonlRpcProcess(child, workingDir);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`${options.command} did not emit "${options.readyEvent}" within ${options.readyTimeoutMs ?? 10000}ms`));
      }, options.readyTimeoutMs ?? 10000);

      const readline = createInterface({ input: child.stdout as Readable, crlfDelay: Infinity });
      readline.on("line", (line: string) => {
        try {
          const frame = JSON.parse(line) as JsonlRpcFrame;
          if (frame.type === options.readyEvent) {
            clearTimeout(timeout);
            readline.close();
            resolve();
          }
        } catch { /* ignore malformed lines during startup */ }
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        reject(new Error(`${options.command} exited with code ${code} before ready`));
      });
    });

    instance.startFrameReader();
    return instance;
  }

  private startFrameReader(): void {
    const readline = createInterface({ input: this.process.stdout as Readable, crlfDelay: Infinity });
    readline.on("line", (line: string) => {
      void this.dispatchLine(line);
    });
  }

  private async dispatchLine(line: string): Promise<void> {
    try {
      const frame = JSON.parse(line) as JsonlRpcFrame;
      if (!frame.type) return;
      if (frame.type === "response" && typeof frame.id === "string") {
        const resolve = this.pendingRequests.get(frame.id);
        if (resolve) {
          this.pendingRequests.delete(frame.id);
          resolve(frame as JsonlRpcResponse);
        }
      }
    } catch { /* ignore */ }
  }

  request(command: JsonlRpcRequest): Promise<JsonlRpcResponse> {
    const id = command.id ?? `rpc-${++this.nextId}`;
    const frame = { ...command, id };
    return new Promise<JsonlRpcResponse>((resolve, reject) => {
      this.pendingRequests.set(id, resolve);
      try {
        this.process.stdin.write(JSON.stringify(frame) + "\n", (err) => {
          if (err) {
            this.pendingRequests.delete(id);
            reject(err);
          }
        });
      } catch (err) {
        this.pendingRequests.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  subscribe(listener: (event: JsonlRpcEvent) => void): () => void {
    const readline = createInterface({ input: this.process.stdout as Readable, crlfDelay: Infinity });
    let active = true;
    readline.on("line", (line: string) => {
      if (!active) return;
      try {
        const frame = JSON.parse(line) as JsonlRpcFrame;
        if (frame.type && frame.type !== "response") {
          listener(frame as JsonlRpcEvent);
        }
      } catch { /* ignore */ }
    });
    return () => { active = false; readline.close(); };
  }

  async dispose(): Promise<void> {
    try { await this.request({ type: "session_dispose" }); } catch { /* best effort */ }
    this.process.stdin.end();
    this.process.kill();
    await new Promise<void>((resolve) => this.process.on("close", () => resolve()));
  }
}
