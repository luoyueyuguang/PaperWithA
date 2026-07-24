import { performance } from "node:perf_hooks";
import { GATE_0_FIXTURE_VERSION, percentile, type ProbeReport } from "../../packages/contracts/src/probe.js";
import { buildContext, type ContextSource } from "../../packages/context/src/index.js";

export interface ContextProbeDetails {
  selectedSourceIds: string[];
  omittedSourceIds: string[];
  fixedSourceFirst: boolean;
  outsiderExcluded: boolean;
  ordinaryCropExplained: boolean;
  fixedBudgetFailure: boolean;
  repeatable: boolean;
}

export async function runContextProbe(): Promise<ProbeReport<ContextProbeDetails>> {
  const sources: ContextSource[] = [
    { sourceId: "paper-a-intro", documentId: "paper-a", text: "method evidence baseline result" },
    { sourceId: "paper-b-method", documentId: "paper-b", text: "method comparison result" },
    { sourceId: "paper-b-limit", documentId: "paper-b", text: "limitation and future work" },
    { sourceId: "outsider", documentId: "paper-outsider", text: "method evidence should never enter" },
  ];
  const contextSet = {
    documents: ["paper-a", "paper-b"],
    fixedSourceIds: ["paper-a-intro"],
    query: "method result",
    retrievalVersion: "lexical-v1",
  };
  const timings: number[] = [];
  const started = performance.now();
  const first = buildContext(contextSet, sources, 7);
  const second = buildContext(contextSet, sources, 7);
  const fixedFailure = buildContext(contextSet, sources, 2);
  timings.push(performance.now() - started);
  for (let sample = 0; sample < 10; sample += 1) {
    const sampleStarted = performance.now();
    buildContext(contextSet, sources, 7);
    buildContext(contextSet, sources, 2);
    timings.push(performance.now() - sampleStarted);
  }
  const outsiderExcluded = !first.selectedSourceIds.includes("outsider") && !first.omittedSourceIds.includes("outsider");
  const ordinaryCropExplained = first.omittedSourceIds.length > 0;
  const fixedBudgetFailure = fixedFailure.status === "budget_exceeded"
    && fixedFailure.selectedSourceIds.includes("paper-a-intro");
  const status = first.status === "ready"
    && first.selectedSourceIds[0] === "paper-a-intro"
    && outsiderExcluded
    && ordinaryCropExplained
    && fixedBudgetFailure
    && JSON.stringify(first) === JSON.stringify(second)
    ? "pass"
    : "fail";

  return {
    probeId: "gate0.context",
    fixtureVersion: GATE_0_FIXTURE_VERSION,
    status,
    environment: { node: process.versions.node, platform: process.platform, arch: process.arch },
    input: { fixture: "two-documents-with-outsider", bytes: JSON.stringify(sources).length },
    metrics: { sampleCount: timings.length, p50Ms: percentile(timings, 50), p95Ms: percentile(timings, 95), p99Ms: percentile(timings, 99) },
    details: {
      selectedSourceIds: first.selectedSourceIds,
      omittedSourceIds: first.omittedSourceIds,
      fixedSourceFirst: first.selectedSourceIds[0] === "paper-a-intro",
      outsiderExcluded,
      ordinaryCropExplained,
      fixedBudgetFailure,
      repeatable: JSON.stringify(first) === JSON.stringify(second),
    },
    errors: [],
  };
}
