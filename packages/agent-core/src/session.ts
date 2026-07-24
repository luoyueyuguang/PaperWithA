export type AgentSessionStatus = "idle" | "running" | "waiting-approval" | "failed" | "archived";
import { createSandboxWorkspace, type SandboxWorkspace } from "./sandbox.js";
export type AgentRunStatus = "running" | "completed" | "failed" | "cancelled";
export type AgentMessageRole = "user" | "assistant";

export interface AgentRuntimeProfile {
  runtimeProfileId: string;
  adapterKind: string;
  displayName: string;
  launchMode: "embedded" | "subprocess" | "http";
  enabled: boolean;
}

export interface AgentProfile {
  agentProfileId: string;
  runtimeProfileId: string;
  name: string;
  description: string;
  defaultModel: string | null;
  enabledTools: string[];
}

export interface AgentSessionContext {
  documentIds: string[];
  fixedSourceIds: string[];
  sourceTexts: Record<string, string>;
  retrievalVersion: string;
}

export interface AgentContextSnapshot {
  snapshotId: string;
  documentIds: string[];
  fixedSourceIds: string[];
  selectedSourceIds: string[];
  omittedSourceIds: string[];
  query: string;
  retrievalVersion: string;
  tokenCount: number;
  createdAt: string;
}

export interface AgentMessage {
  messageId: string;
  role: AgentMessageRole;
  text: string;
  createdAt: string;
  runId: string | null;
}

export type AgentEventKind =
  | "assistant-text-delta"
  | "tool-started"
  | "tool-progress"
  | "tool-completed"
  | "tool-failed"
  | "approval-requested"
  | "approval-resolved"
  | "artifact-created"
  | "run-steered"
  | "run-cancelled"
  | "run-completed"
  | "run-failed";

export interface AgentEvent {
  eventId: string;
  runId: string;
  sequence: number;
  kind: AgentEventKind;
  payload: unknown;
  createdAt: string;
}

export interface AgentRun {
  runId: string;
  branchId: string;
  contextSnapshot: AgentContextSnapshot;
  model: string | null;
  status: AgentRunStatus;
  events: AgentEvent[];
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

export interface AgentSessionBranch {
  branchId: string;
  title: string;
  parentBranchId: string | null;
  forkedFromMessageId: string | null;
  frameworkSessionRef: string | null;
  messages: AgentMessage[];
  runs: AgentRun[];
  activeRunId: string | null;
  sandbox: SandboxWorkspace;
  createdAt: string;
}

export interface AgentSession {
  sessionId: string;
  title: string;
  agentProfileId: string;
  runtimeProfileId: string;
  context: AgentSessionContext;
  branches: AgentSessionBranch[];
  activeBranchId: string;
  status: AgentSessionStatus;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentWorkspaceState {
  sessions: AgentSession[];
  activeSessionId: string | null;
}

export interface CreateAgentSessionInput {
  sessionId: string;
  branchId: string;
  title: string;
  agentProfileId: string;
  runtimeProfileId: string;
  context?: Partial<AgentSessionContext>;
  now: string;
}

const emptyContext = (): AgentSessionContext => ({
  documentIds: [],
  fixedSourceIds: [],
  sourceTexts: {},
  retrievalVersion: "local-lexical-v1",
});

export function createAgentSession(input: CreateAgentSessionInput): AgentSession {
  const context = { ...emptyContext(), ...input.context };
  return {
    sessionId: input.sessionId,
    title: input.title.trim() || "Untitled session",
    agentProfileId: input.agentProfileId,
    runtimeProfileId: input.runtimeProfileId,
    context: {
      documentIds: [...context.documentIds],
      fixedSourceIds: [...context.fixedSourceIds],
      sourceTexts: { ...context.sourceTexts },
      retrievalVersion: context.retrievalVersion,
    },
    branches: [{
      branchId: input.branchId,
      title: "Main",
      parentBranchId: null,
      forkedFromMessageId: null,
      frameworkSessionRef: null,
      messages: [],
      runs: [],
      activeRunId: null,
      sandbox: createSandboxWorkspace(),
      createdAt: input.now,
    }],
    activeBranchId: input.branchId,
    status: "idle",
    pinned: false,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function activeAgentBranch(session: AgentSession): AgentSessionBranch {
  const branch = session.branches.find((candidate) => candidate.branchId === session.activeBranchId);
  if (!branch) throw new Error(`active branch not found: ${session.activeBranchId}`);
  return branch;
}

function replaceBranch(session: AgentSession, branch: AgentSessionBranch, now: string): AgentSession {
  return {
    ...session,
    branches: session.branches.map((candidate) => candidate.branchId === branch.branchId ? branch : candidate),
    updatedAt: now,
  };
}

export function updateAgentSessionContext(session: AgentSession, context: AgentSessionContext, now: string): AgentSession {
  return {
    ...session,
    context: {
      documentIds: [...context.documentIds],
      fixedSourceIds: [...context.fixedSourceIds],
      sourceTexts: { ...context.sourceTexts },
      retrievalVersion: context.retrievalVersion,
    },
    updatedAt: now,
  };
}

export function appendAgentMessage(session: AgentSession, message: AgentMessage): AgentSession {
  const branch = activeAgentBranch(session);
  if (branch.messages.some((candidate) => candidate.messageId === message.messageId)) {
    throw new Error(`duplicate message: ${message.messageId}`);
  }
  return replaceBranch(session, { ...branch, messages: [...branch.messages, { ...message }] }, message.createdAt);
}
export function updateAgentMessage(
  session: AgentSession,
  messageId: string,
  text: string,
  now: string,
): AgentSession {
  const branch = activeAgentBranch(session);
  if (!branch.messages.some((message) => message.messageId === messageId)) throw new Error(`message not found: ${messageId}`);
  const messages = branch.messages.map((message) => message.messageId === messageId ? { ...message, text } : message);
  return replaceBranch(session, { ...branch, messages }, now);
}

export function startAgentRun(
  session: AgentSession,
  input: { runId: string; snapshot: AgentContextSnapshot; model: string | null; now: string },
): AgentSession {
  const branch = activeAgentBranch(session);
  if (branch.activeRunId) throw new Error(`branch already has an active run: ${branch.activeRunId}`);
  if (branch.runs.some((run) => run.runId === input.runId)) throw new Error(`duplicate run: ${input.runId}`);
  const run: AgentRun = {
    runId: input.runId,
    branchId: branch.branchId,
    contextSnapshot: {
      ...input.snapshot,
      documentIds: [...input.snapshot.documentIds],
      fixedSourceIds: [...input.snapshot.fixedSourceIds],
      selectedSourceIds: [...input.snapshot.selectedSourceIds],
      omittedSourceIds: [...input.snapshot.omittedSourceIds],
    },
    model: input.model,
    status: "running",
    events: [],
    startedAt: input.now,
    finishedAt: null,
    error: null,
  };
  const next = replaceBranch(session, { ...branch, runs: [...branch.runs, run], activeRunId: run.runId }, input.now);
  return { ...next, status: "running" };
}

export function appendAgentEvent(
  session: AgentSession,
  runId: string,
  event: Omit<AgentEvent, "runId" | "sequence">,
): AgentSession {
  const branch = activeAgentBranch(session);
  const run = branch.runs.find((candidate) => candidate.runId === runId);
  if (!run) throw new Error(`run not found: ${runId}`);
  if (run.status !== "running") throw new Error(`cannot append event to ${run.status} run`);
  if (run.events.some((candidate) => candidate.eventId === event.eventId)) throw new Error(`duplicate event: ${event.eventId}`);
  const nextRun = { ...run, events: [...run.events, { ...event, runId, sequence: run.events.length }] };
  const nextBranch = { ...branch, runs: branch.runs.map((candidate) => candidate.runId === runId ? nextRun : candidate) };
  return replaceBranch(session, nextBranch, event.createdAt);
}

export function finishAgentRun(
  session: AgentSession,
  runId: string,
  outcome: { status: Exclude<AgentRunStatus, "running">; now: string; error?: string },
): AgentSession {
  const branch = activeAgentBranch(session);
  const run = branch.runs.find((candidate) => candidate.runId === runId);
  if (!run) throw new Error(`run not found: ${runId}`);
  if (run.status !== "running") throw new Error(`run already finished: ${runId}`);
  const nextRun: AgentRun = {
    ...run,
    status: outcome.status,
    finishedAt: outcome.now,
    error: outcome.error ?? null,
  };
  const nextBranch = {
    ...branch,
    runs: branch.runs.map((candidate) => candidate.runId === runId ? nextRun : candidate),
    activeRunId: null,
  };
  const next = replaceBranch(session, nextBranch, outcome.now);
  return { ...next, status: outcome.status === "failed" ? "failed" : "idle" };
}

export function forkAgentBranch(
  session: AgentSession,
  input: { branchId: string; fromMessageId: string; title: string; now: string },
): AgentSession {
  if (session.branches.some((branch) => branch.branchId === input.branchId)) throw new Error(`duplicate branch: ${input.branchId}`);
  const source = activeAgentBranch(session);
  const messageIndex = source.messages.findIndex((message) => message.messageId === input.fromMessageId);
  if (messageIndex < 0) throw new Error(`fork message not found: ${input.fromMessageId}`);
  const branch: AgentSessionBranch = {
    branchId: input.branchId,
    title: input.title.trim() || "Branch",
    parentBranchId: source.branchId,
    forkedFromMessageId: input.fromMessageId,
    frameworkSessionRef: null,
    messages: source.messages.slice(0, messageIndex + 1).map((message) => ({ ...message })),
    runs: [],
    activeRunId: null,
    sandbox: { files: source.sandbox.files.map((f) => ({ ...f })), runs: [], activeRunId: null },
    createdAt: input.now,
  };
  return {
    ...session,
    branches: [...session.branches, branch],
    activeBranchId: branch.branchId,
    status: "idle",
    updatedAt: input.now,
  };
}

export function selectAgentBranch(session: AgentSession, branchId: string, now: string): AgentSession {
  if (!session.branches.some((branch) => branch.branchId === branchId)) throw new Error(`branch not found: ${branchId}`);
  return { ...session, activeBranchId: branchId, status: activeAgentBranch({ ...session, activeBranchId: branchId }).activeRunId ? "running" : "idle", updatedAt: now };
}

export function createAgentWorkspace(): AgentWorkspaceState {
  return { sessions: [], activeSessionId: null };
}

export function addAgentSession(workspace: AgentWorkspaceState, session: AgentSession): AgentWorkspaceState {
  if (workspace.sessions.some((candidate) => candidate.sessionId === session.sessionId)) throw new Error(`duplicate session: ${session.sessionId}`);
  return { sessions: [...workspace.sessions, session], activeSessionId: session.sessionId };
}

export function replaceAgentSession(workspace: AgentWorkspaceState, session: AgentSession): AgentWorkspaceState {
  if (!workspace.sessions.some((candidate) => candidate.sessionId === session.sessionId)) throw new Error(`session not found: ${session.sessionId}`);
  return { ...workspace, sessions: workspace.sessions.map((candidate) => candidate.sessionId === session.sessionId ? session : candidate) };
}

export function selectAgentSession(workspace: AgentWorkspaceState, sessionId: string): AgentWorkspaceState {
  const session = workspace.sessions.find((candidate) => candidate.sessionId === sessionId);
  if (!session || session.status === "archived") throw new Error(`active session not found: ${sessionId}`);
  return { ...workspace, activeSessionId: sessionId };
}

export function archiveAgentSession(workspace: AgentWorkspaceState, sessionId: string, now: string): AgentWorkspaceState {
  const session = workspace.sessions.find((candidate) => candidate.sessionId === sessionId);
  if (!session) throw new Error(`session not found: ${sessionId}`);
  if (session.status === "running" || session.status === "waiting-approval") throw new Error("cannot archive an active session");
  const sessions = workspace.sessions.map((candidate) => candidate.sessionId === sessionId ? { ...candidate, status: "archived" as const, updatedAt: now } : candidate);
  const nextActive = workspace.activeSessionId === sessionId
    ? sessions.find((candidate) => candidate.status !== "archived")?.sessionId ?? null
    : workspace.activeSessionId;
  return { sessions, activeSessionId: nextActive };
}
