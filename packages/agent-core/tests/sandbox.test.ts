import { describe, expect, it } from "vitest";
import {
  completeSandboxRun,
  createSandboxWorkspace,
  deleteSandboxFile,
  publishArtifact,
  readSandboxFile,
  startSandboxRun,
  writeSandboxFile,
  DEFAULT_SANDBOX_POLICY,
} from "../src/sandbox.js";

describe("SandboxWorkspace", () => {
  const now = "2026-07-24T10:00:00.000Z";

  it("writes and reads files within the policy limit", () => {
    let ws = createSandboxWorkspace();
    ws = writeSandboxFile(ws, "main.py", "print('hello')", DEFAULT_SANDBOX_POLICY, now);
    ws = writeSandboxFile(ws, "data.csv", "a,b,c", DEFAULT_SANDBOX_POLICY, now);

    expect(readSandboxFile(ws, "main.py")?.content).toBe("print('hello')");
    expect(readSandboxFile(ws, "data.csv")?.content).toBe("a,b,c");
    expect(ws.files.length).toBe(2);
  });

  it("enforces total size limits", () => {
    let ws = createSandboxWorkspace();
    const policy = { ...DEFAULT_SANDBOX_POLICY, maxTotalBytes: 10 };
    ws = writeSandboxFile(ws, "a.txt", "12345", policy, now);
    expect(() => writeSandboxFile(ws, "b.txt", "123456", policy, now)).toThrow("exceeds policy limit");
  });

  it("completes a run and publishes an artifact", () => {
    let ws = createSandboxWorkspace();
    ws = writeSandboxFile(ws, "calc.py", "2+2", DEFAULT_SANDBOX_POLICY, now);
    ws = startSandboxRun(ws, { runId: "run-1", branchId: "branch-1", command: "python", args: ["calc.py"], cwd: "/workspace", now });
    ws = completeSandboxRun(ws, "run-1", { exitCode: 0, stdout: "4\n", stderr: "", now });
    const artifact = publishArtifact(ws, {
      artifactId: "art-1",
      runId: "run-1",
      sessionId: "session-1",
      name: "result",
      kind: "data",
      mediaType: "text/plain",
      content: "4",
      evidenceLinks: [],
      now,
    });

    expect(ws.runs[0]?.status).toBe("completed");
    expect(ws.runs[0]?.exitCode).toBe(0);
    expect(artifact.name).toBe("result");
  });

  it("deletes files and prevents duplicate active runs", () => {
    let ws = writeSandboxFile(createSandboxWorkspace(), "tmp.txt", "delete me", DEFAULT_SANDBOX_POLICY, now);
    ws = deleteSandboxFile(ws, "tmp.txt");
    expect(readSandboxFile(ws, "tmp.txt")).toBeNull();

    ws = startSandboxRun(ws, { runId: "run-1", branchId: "b1", command: "echo", args: [], cwd: "/", now });
    expect(() => startSandboxRun(ws, { runId: "run-2", branchId: "b1", command: "echo", args: [], cwd: "/", now })).toThrow("already has an active run");
  });
});
