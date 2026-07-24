import { performance } from "node:perf_hooks";
import type { DocumentGraph } from "../../packages/domain/src/document.js";
import { GATE_0_FIXTURE_VERSION, percentile, type ProbeReport } from "../../packages/contracts/src/probe.js";
import { DocumentGraphCache } from "../../packages/reader-core/src/graph.js";
import { createPaperViewState, updatePaperView } from "../../packages/reader-core/src/paper-view.js";

export interface SharedGraphProbeDetails {
  graphIdentityShared: boolean;
  parseCalls: number;
  firstViewPage: number;
  secondViewPage: number;
  firstViewZoom: number;
  secondViewZoom: number;
  graphPages: number;
}

export async function runSharedGraphProbe(): Promise<ProbeReport<SharedGraphProbeDetails>> {
  const timings: number[] = [];
  const cache = new DocumentGraphCache();
  let parseCalls = 0;
  const loader = async (documentVersionId: string): Promise<DocumentGraph> => {
    parseCalls += 1;
    await Promise.resolve();
    return {
      graphId: "graph-shared-fixture",
      documentId: "document-fixture-1",
      documentVersionId,
      pages: Array.from({ length: 20 }, (_, index) => ({
        pageId: `page-${index + 1}`,
        pageNumber: index + 1,
        text: `Shared graph page ${index + 1}`,
      })),
      blobHash: null,
    };
  };

  const started = performance.now();
  const [firstGraph, secondGraph] = await Promise.all([
    cache.getOrCreate("document-fixture-1-v1", loader),
    cache.getOrCreate("document-fixture-1-v1", loader),
  ]);
  const firstView = updatePaperView(
    createPaperViewState("view-1", "document-fixture-1", "document-fixture-1-v1"),
    { scrollAnchor: { pageNumber: 8, relativeOffset: 0.25 }, zoom: 1.2 },
  );
  const secondView = updatePaperView(
    createPaperViewState("view-2", "document-fixture-1", "document-fixture-1-v1"),
    { scrollAnchor: { pageNumber: 2, relativeOffset: 0.5 }, zoom: 0.9 },
  );
  timings.push(performance.now() - started);
  for (let sample = 0; sample < 10; sample += 1) {
    const sampleCache = new DocumentGraphCache();
    const sampleStarted = performance.now();
    await Promise.all([
      sampleCache.getOrCreate(`sample-${sample}`, async () => firstGraph),
      sampleCache.getOrCreate(`sample-${sample}`, async () => firstGraph),
    ]);
    timings.push(performance.now() - sampleStarted);
  }

  const graphIdentityShared = firstGraph === secondGraph;
  const status = graphIdentityShared && parseCalls === 1 && firstView.scrollAnchor.pageNumber !== secondView.scrollAnchor.pageNumber
    ? "pass"
    : "fail";
  return {
    probeId: "gate0.shared-graph",
    fixtureVersion: GATE_0_FIXTURE_VERSION,
    status,
    environment: {
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
    },
    input: { fixture: "sharedGraph", bytes: 20 * 64 },
    metrics: {
      sampleCount: timings.length,
      p50Ms: percentile(timings, 50),
      p95Ms: percentile(timings, 95),
      p99Ms: percentile(timings, 99),
    },
    details: {
      graphIdentityShared,
      parseCalls,
      firstViewPage: firstView.scrollAnchor.pageNumber,
      secondViewPage: secondView.scrollAnchor.pageNumber,
      firstViewZoom: firstView.zoom,
      secondViewZoom: secondView.zoom,
      graphPages: firstGraph.pages.length,
    },
    errors: [],
  };
}
