export interface SandboxFile {
  /** Virtual path relative to the sandbox root. */
  path: string;
  /** File content as UTF-8 text. */
  content: string;
  /** Last modification time in ISO 8601. */
  updatedAt: string;
}

export interface SandboxRun {
  runId: string;
  branchId: string;
  status: "running" | "completed" | "failed";
  command: string;
  args: string[];
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
  filesSnapshot: SandboxFile[];
}

export interface PublishedArtifact {
  artifactId: string;
  runId: string;
  branchId: string;
  sessionId: string;
  name: string;
  kind: "notebook" | "code" | "chart" | "data" | "report" | "other";
  mediaType: string;
  content: string;
  evidenceLinks: string[];
  createdAt: string;
}

export interface SandboxWorkspace {
  files: SandboxFile[];
  runs: SandboxRun[];
  activeRunId: string | null;
}

export interface SandboxPolicy {
  /** Maximum total file size in bytes. Default 1 MiB. */
  maxTotalBytes: number;
  /** Allowed file extensions. Empty = allow all. */
  allowedExtensions: string[];
  /** Maximum runtime per run in milliseconds. Default 30000. */
  maxRuntimeMs: number;
}

export const DEFAULT_SANDBOX_POLICY: SandboxPolicy = {
  maxTotalBytes: 1024 * 1024,
  allowedExtensions: [],
  maxRuntimeMs: 30000,
};

export function createSandboxWorkspace(): SandboxWorkspace {
  return { files: [], runs: [], activeRunId: null };
}

export function writeSandboxFile(
  workspace: SandboxWorkspace,
  path: string,
  content: string,
  policy: SandboxPolicy,
  now: string,
): SandboxWorkspace {
  const normalized = path.startsWith("/") ? path.slice(1) : path;
  if (policy.allowedExtensions.length > 0) {
    const ext = normalized.split(".").pop() ?? "";
    if (!policy.allowedExtensions.includes(ext)) throw new Error(`file extension .${ext} not allowed`);
  }
  const existing = workspace.files.find((f) => f.path === normalized);
  const existingBytes = existing ? new TextEncoder().encode(existing.content).byteLength : 0;
  const newBytes = new TextEncoder().encode(content).byteLength;
  const totalBytes = workspace.files.reduce((sum, f) => sum + new TextEncoder().encode(f.content).byteLength, 0) - existingBytes + newBytes;
  if (totalBytes > policy.maxTotalBytes) throw new Error("sandbox file size exceeds policy limit");
  const file: SandboxFile = { path: normalized, content, updatedAt: now };
  return {
    ...workspace,
    files: existing ? workspace.files.map((f) => f.path === normalized ? file : f) : [...workspace.files, file],
  };
}

export function deleteSandboxFile(workspace: SandboxWorkspace, path: string): SandboxWorkspace {
  const normalized = path.startsWith("/") ? path.slice(1) : path;
  return { ...workspace, files: workspace.files.filter((f) => f.path !== normalized) };
}

export function readSandboxFile(workspace: SandboxWorkspace, path: string): SandboxFile | null {
  const normalized = path.startsWith("/") ? path.slice(1) : path;
  return workspace.files.find((f) => f.path === normalized) ?? null;
}

export function startSandboxRun(
  workspace: SandboxWorkspace,
  input: { runId: string; branchId: string; command: string; args: string[]; cwd: string; now: string },
): SandboxWorkspace {
  if (workspace.activeRunId) throw new Error("sandbox already has an active run");
  const run: SandboxRun = {
    runId: input.runId,
    branchId: input.branchId,
    status: "running",
    command: input.command,
    args: input.args,
    cwd: input.cwd,
    stdout: "",
    stderr: "",
    exitCode: null,
    startedAt: input.now,
    finishedAt: null,
    filesSnapshot: workspace.files.map((f) => ({ ...f })),
  };
  return { ...workspace, runs: [...workspace.runs, run], activeRunId: run.runId };
}

export function completeSandboxRun(
  workspace: SandboxWorkspace,
  runId: string,
  outcome: { exitCode: number; stdout: string; stderr: string; now: string },
): SandboxWorkspace {
  const run = workspace.runs.find((r) => r.runId === runId);
  if (!run) throw new Error(`run not found: ${runId}`);
  const updated: SandboxRun = {
    ...run,
    status: outcome.exitCode === 0 ? "completed" : "failed",
    exitCode: outcome.exitCode,
    stdout: outcome.stdout,
    stderr: outcome.stderr,
    finishedAt: outcome.now,
  };
  return {
    ...workspace,
    runs: workspace.runs.map((r) => r.runId === runId ? updated : r),
    activeRunId: null,
  };
}

export function publishArtifact(
  workspace: SandboxWorkspace,
  input: {
    artifactId: string;
    runId: string;
    sessionId: string;
    name: string;
    kind: PublishedArtifact["kind"];
    mediaType: string;
    content: string;
    evidenceLinks: string[];
    now: string;
  },
): PublishedArtifact {
  if (!workspace.runs.some((r) => r.runId === input.runId)) throw new Error(`run not found: ${input.runId}`);
  return {
    artifactId: input.artifactId,
    runId: input.runId,
    branchId: workspace.runs.find((r) => r.runId === input.runId)!.branchId,
    sessionId: input.sessionId,
    name: input.name,
    kind: input.kind,
    mediaType: input.mediaType,
    content: input.content,
    evidenceLinks: input.evidenceLinks,
    createdAt: input.now,
  };
}

declare function setTimeout(cb: () => void, ms: number): unknown;
declare function clearTimeout(id: unknown): void;
