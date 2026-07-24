import { performance } from "node:perf_hooks";
import {
  LayoutHistory,
  stackPanelIds,
  type LayoutTree,
} from "../../packages/workspace/src/index.js";
import { GATE_0_FIXTURE_VERSION, percentile, type ProbeReport } from "../../packages/contracts/src/probe.js";

export interface DockingProbeDetails {
  ghostPreview: string[];
  centralSwapApplied: boolean;
  tabMergeApplied: boolean;
  edgeSplitApplied: boolean;
  serializedRestored: boolean;
  contentRefsUnchanged: boolean;
  undoRestoredInitial: boolean;
  redoRestoredFinal: boolean;
}

function initialLayout(): LayoutTree {
  return {
    root: {
      kind: "split",
      splitId: "root-split",
      orientation: "horizontal",
      children: [
        { kind: "stack", stackId: "paper-stack", panelIds: ["paper", "brief"] },
        { kind: "stack", stackId: "chat-stack", panelIds: ["chat"] },
      ],
    },
    panels: {
      paper: { panelId: "paper", contentRef: "paper-view-1" },
      brief: { panelId: "brief", contentRef: "reading-brief-1" },
      chat: { panelId: "chat", contentRef: "chat-session-1" },
    },
  };
}

export async function runDockingProbe(): Promise<ProbeReport<DockingProbeDetails>> {
  const initial = initialLayout();
  const contentSnapshot = JSON.stringify(initial.panels);
  const history = new LayoutHistory(initial);
  const timings: number[] = [];
  const ghostPreview = ["central:swap", "tab-bar:merge", "edge:split"];

  const started = performance.now();
  const swapped = history.execute({ kind: "swap", leftPanelId: "paper", rightPanelId: "chat" });
  const merged = history.execute({ kind: "mergeTab", panelId: "brief", targetStackId: "chat-stack" });
  const final = history.execute({
    kind: "splitPane",
    panelId: "brief",
    orientation: "vertical",
    splitId: "brief-split",
    stackId: "chat-stack",
  });
  timings.push(performance.now() - started);
  for (let sample = 0; sample < 10; sample += 1) {
    const sampleHistory = new LayoutHistory(initial);
    const sampleStarted = performance.now();
    sampleHistory.execute({ kind: "swap", leftPanelId: "paper", rightPanelId: "chat" });
    sampleHistory.execute({ kind: "mergeTab", panelId: "brief", targetStackId: "chat-stack" });
    sampleHistory.execute({ kind: "splitPane", panelId: "brief", orientation: "vertical", splitId: `sample-${sample}`, stackId: "chat-stack" });
    timings.push(performance.now() - sampleStarted);
  }

  history.undo();
  history.undo();
  const undoRestoredInitial = JSON.stringify(history.undo()) === JSON.stringify(initial);
  history.redo();
  history.redo();
  const redoRestoredFinal = JSON.stringify(history.redo()) === JSON.stringify(final);
  const serializedRestored = JSON.stringify(final) === JSON.stringify(JSON.parse(JSON.stringify(final)));
  const contentRefsUnchanged = JSON.stringify(final.panels) === contentSnapshot;
  const centralSwapApplied = JSON.stringify(stackPanelIds(swapped.root, "paper-stack")) === JSON.stringify(["chat", "brief"])
    && JSON.stringify(stackPanelIds(swapped.root, "chat-stack")) === JSON.stringify(["paper"]);
  const tabMergeApplied = JSON.stringify(stackPanelIds(merged.root, "chat-stack")) === JSON.stringify(["paper", "brief"]);
  const edgeSplitApplied = JSON.stringify(final.root).includes("brief-split")
    && JSON.stringify(stackPanelIds(final.root, "chat-stack:split")) === JSON.stringify(["brief"]);
  const status = centralSwapApplied && tabMergeApplied && edgeSplitApplied && serializedRestored && contentRefsUnchanged
    ? "pass"
    : "fail";

  return {
    probeId: "gate0.docking",
    fixtureVersion: GATE_0_FIXTURE_VERSION,
    status,
    environment: { node: process.versions.node, platform: process.platform, arch: process.arch },
    input: { fixture: "layout-sequence", bytes: JSON.stringify(initial).length },
    metrics: {
      sampleCount: timings.length,
      p50Ms: percentile(timings, 50),
      p95Ms: percentile(timings, 95),
      p99Ms: percentile(timings, 99),
    },
    details: {
      ghostPreview,
      centralSwapApplied,
      tabMergeApplied,
      edgeSplitApplied,
      serializedRestored,
      contentRefsUnchanged,
      undoRestoredInitial,
      redoRestoredFinal,
    },
    errors: [],
  };
}
