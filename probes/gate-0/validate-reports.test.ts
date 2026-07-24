import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterAll } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPORTS_DIR = join(__dirname, "reports", "gate0-v1");
const VALIDATOR_SCRIPT = join(__dirname, "validate-reports.ts");

function runValidator(): { stdout: string; exitCode: number } {
  try {
    const stdout = execSync(`npx tsx ${VALIDATOR_SCRIPT}`, {
      encoding: "utf8",
      cwd: join(__dirname, "..", ".."),
      timeout: 10000,
    });
    return { stdout: stdout.trim(), exitCode: 0 };
  } catch (err: unknown) {
    const error = err as Error & { stdout?: string; status?: number };
    return {
      stdout: (error.stdout ?? "").toString().trim(),
      exitCode: error.status ?? 1,
    };
  }
}

describe("Gate 0 Report Validation", () => {
  it("passes on current valid reports", () => {
    const { stdout, exitCode } = runValidator();
    const result = JSON.parse(stdout) as {
      status: string;
      probesValidated: number;
      totalChecks: number;
      passed: number;
      failed: number;
    };
    expect(exitCode).toBe(0);
    expect(result.status).toBe("ok");
    expect(result.probesValidated).toBe(6);
    expect(result.failed).toBe(0);
    expect(result.passed).toBe(result.totalChecks);
  });

  it("fails on a report with invalid fixtureVersion", () => {
    const probeFile = join(REPORTS_DIR, "gate0.pdf.json");
    const original = readFileSync(probeFile, "utf8");
    const originalObj = JSON.parse(original);
    const tampered = { ...originalObj, fixtureVersion: "bad-version" };

    try {
      writeFileSync(probeFile, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
      const { stdout, exitCode } = runValidator();
      const result = JSON.parse(stdout) as { status: string; failed: number };
      expect(exitCode).not.toBe(0);
      expect(result.status).toBe("fail");
      expect(result.failed).toBeGreaterThanOrEqual(1);
    } finally {
      writeFileSync(probeFile, original, "utf8");
    }
  });

  it("fails on a report with bad status", () => {
    const probeFile = join(REPORTS_DIR, "gate0.pdf.json");
    const original = readFileSync(probeFile, "utf8");
    const originalObj = JSON.parse(original);
    const tampered = { ...originalObj, status: "unknown-status" };

    try {
      writeFileSync(probeFile, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
      const { stdout, exitCode } = runValidator();
      const result = JSON.parse(stdout) as { status: string; failed: number };
      expect(exitCode).not.toBe(0);
      expect(result.status).toBe("fail");
      expect(result.failed).toBeGreaterThanOrEqual(1);
    } finally {
      writeFileSync(probeFile, original, "utf8");
    }
  });

  it("fails on a report with non-numeric metrics", () => {
    const probeFile = join(REPORTS_DIR, "gate0.shared-graph.json");
    const original = readFileSync(probeFile, "utf8");
    const originalObj = JSON.parse(original);
    const tampered = {
      ...originalObj,
      metrics: { p50Ms: "slow", p95Ms: 0.1, p99Ms: 0.1 },
    };

    try {
      writeFileSync(probeFile, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
      const { stdout, exitCode } = runValidator();
      const result = JSON.parse(stdout) as { status: string; failed: number };
      expect(exitCode).not.toBe(0);
      expect(result.status).toBe("fail");
      expect(result.failed).toBeGreaterThanOrEqual(1);
    } finally {
      writeFileSync(probeFile, original, "utf8");
    }
  });

  it("fails on a report missing PDF profiles", () => {
    const probeFile = join(REPORTS_DIR, "gate0.pdf.json");
    const original = readFileSync(probeFile, "utf8");
    const originalObj = JSON.parse(original);
    const tampered = {
      ...originalObj,
      details: { ...originalObj.details, profiles: [] },
    };

    try {
      writeFileSync(probeFile, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
      const { stdout, exitCode } = runValidator();
      const result = JSON.parse(stdout) as { status: string; failed: number };
      expect(exitCode).not.toBe(0);
      expect(result.status).toBe("fail");
      expect(result.failed).toBeGreaterThanOrEqual(1);
    } finally {
      writeFileSync(probeFile, original, "utf8");
    }
  });

  it("fails with extra unexpected probe file", () => {
    const roguePath = join(REPORTS_DIR, "gate0.rogue.json");
    const rogue = {
      probeId: "gate0.rogue",
      fixtureVersion: "gate0-v1",
      status: "pass",
      environment: { node: "20.0.0", platform: "linux", arch: "x64" },
      input: { fixture: "none", bytes: 0 },
      metrics: { p50Ms: 0, p95Ms: 0, p99Ms: 0 },
      details: {},
      errors: [],
    };

    try {
      const roguePath = join(REPORTS_DIR, "gate0.rogue.json");
      const rogue = {
        probeId: "gate0.rogue",
        fixtureVersion: "gate0-v1",
        status: "pass",
        environment: { node: "20.0.0", platform: "linux", arch: "x64" },
        input: { fixture: "none", bytes: 0 },
        metrics: { p50Ms: 0, p95Ms: 0, p99Ms: 0 },
        details: {},
        errors: [],
      };
      writeFileSync(roguePath, `${JSON.stringify(rogue, null, 2)}\n`, "utf8");
      const result = runValidator();
      expect(result.exitCode).not.toBe(0);
    } finally {
      try { execSync(`rm -f "${join(REPORTS_DIR, "gate0.rogue.json")}"`); } catch { /* cleanup */ }
    }
  });

  it("fails on a blocked report with empty errors array", () => {
    const probeFile = join(REPORTS_DIR, "gate0.sync.json");
    const original = readFileSync(probeFile, "utf8");
    const originalObj = JSON.parse(original);
    const tampered = { ...originalObj, status: "blocked" };

    try {
      writeFileSync(probeFile, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
      const { stdout, exitCode } = runValidator();
      const result = JSON.parse(stdout) as { status: string; failed: number };
      expect(exitCode).not.toBe(0);
      expect(result.status).toBe("fail");
    } finally {
      writeFileSync(probeFile, original, "utf8");
    }
  });
});
