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

describe("E2E Sandbox Pipeline", () => {
  const now = "2026-07-24T10:00:00.000Z";

  it("writes code, runs experiment, publishes artifact, verifies trace", () => {
    let ws = createSandboxWorkspace();

    // Write experiment code
    ws = writeSandboxFile(ws, "experiment.py", "import numpy as np\nresult = np.mean([1,2,3])\nprint(result)", DEFAULT_SANDBOX_POLICY, now);
    ws = writeSandboxFile(ws, "data.csv", "1,2,3\n4,5,6", DEFAULT_SANDBOX_POLICY, now);

    expect(ws.files).toHaveLength(2);
    expect(readSandboxFile(ws, "experiment.py")?.content).toContain("numpy");

    // Run
    ws = startSandboxRun(ws, { runId: "run-1", branchId: "branch-1", command: "python", args: ["experiment.py"], cwd: "/workspace", now });
    expect(ws.activeRunId).toBe("run-1");
    expect(ws.runs[0]?.status).toBe("running");

    // Complete
    ws = completeSandboxRun(ws, "run-1", { exitCode: 0, stdout: "2.0\n", stderr: "", now });
    expect(ws.activeRunId).toBeNull();
    expect(ws.runs[0]?.status).toBe("completed");
    expect(ws.runs[0]?.exitCode).toBe(0);
    expect(ws.runs[0]?.stdout).toBe("2.0\n");

    // Files snapshot captured at run start
    expect(ws.runs[0]?.filesSnapshot).toHaveLength(2);

    // Publish artifact
    const artifact = publishArtifact(ws, {
      artifactId: "art-1", runId: "run-1", sessionId: "session-1",
      name: "experiment-result", kind: "data", mediaType: "text/plain",
      content: "2.0", evidenceLinks: ["doc-1:anchor:3"], now,
    });
    expect(artifact.kind).toBe("data");
    expect(artifact.evidenceLinks).toEqual(["doc-1:anchor:3"]);

    // Clean up
    ws = deleteSandboxFile(ws, "data.csv");
    expect(ws.files).toHaveLength(1);
  });

  it("enforces total size and prevents concurrent runs", () => {
    let ws = createSandboxWorkspace();
    const tinyPolicy = { ...DEFAULT_SANDBOX_POLICY, maxTotalBytes: 20 };

    ws = writeSandboxFile(ws, "a.txt", "12345678901234567890", tinyPolicy, now);
    expect(() => writeSandboxFile(ws, "b.txt", "x", tinyPolicy, now))
      .toThrow("exceeds policy limit");

    ws = startSandboxRun(ws, { runId: "r1", branchId: "b1", command: "echo", args: [], cwd: "/", now });
    expect(() => startSandboxRun(ws, { runId: "r2", branchId: "b1", command: "echo", args: [], cwd: "/", now }))
      .toThrow("already has an active run");
  });
});
