import { performance } from "node:perf_hooks";
import { GATE_0_FIXTURE_VERSION, percentile, type ProbeReport } from "../../packages/contracts/src/probe.js";
import {
  parseSseEvents,
  validateProviderManifest,
  type ProviderManifest,
} from "../../packages/ai-core/src/index.js";

export interface ProviderProbeDetails {
  validManifestErrors: number;
  scriptMappingRejected: boolean;
  undeclaredDomainRejected: boolean;
  malformedStreamRejected: boolean;
  streamEvents: string[];
  errorCodes: string[];
  fallbackAttempted: boolean;
}

export async function runProviderProbe(): Promise<ProbeReport<ProviderProbeDetails>> {
  const validManifest: ProviderManifest = {
    providerId: "fixture-provider",
    manifestVersion: "1",
    apiVersion: "paperwitha.provider.v1",
    transport: "sse",
    endpoint: "https://api.fixture.test/v1/chat",
    allowedDomains: ["fixture.test"],
    authentication: { scheme: "api-key" },
    requestMapping: { kind: "json-pointer", path: "/messages" },
    responseMapping: { kind: "json-pointer", path: "/delta" },
  };
  const timings: number[] = [];
  let validErrors = validateProviderManifest(validManifest);
  let scriptErrors = validateProviderManifest({ ...validManifest, requestMapping: { kind: "script", source: "fetch('https://unexpected.test')" } });
  let domainErrors = validateProviderManifest({ ...validManifest, endpoint: "https://unapproved.test/v1/chat" });
  let stream = parseSseEvents('data: {"delta":"Hello"}\n\ndata: {"delta":" world"}\n\ndata: [DONE]\n\n');
  let malformedStreamRejected = false;
  for (let sample = 0; sample < 10; sample += 1) {
    const started = performance.now();
    validErrors = validateProviderManifest(validManifest);
    scriptErrors = validateProviderManifest({ ...validManifest, requestMapping: { kind: "script", source: "fetch('https://unexpected.test')" } });
    domainErrors = validateProviderManifest({ ...validManifest, endpoint: "https://unapproved.test/v1/chat" });
    stream = parseSseEvents('data: {"delta":"Hello"}\n\ndata: {"delta":" world"}\n\ndata: [DONE]\n\n');
    try {
      parseSseEvents("data: {not-json}\n\n");
    } catch (error) {
      malformedStreamRejected = error instanceof Error && error.name === "ProviderStreamError";
    }
    timings.push(performance.now() - started);
  }
  const scriptMappingRejected = scriptErrors.some((error) => error.code === "unsupported-mapping");
  const undeclaredDomainRejected = domainErrors.some((error) => error.code === "undeclared-domain");
  const fallbackAttempted = false;
  const status = validErrors.length === 0 && scriptMappingRejected && undeclaredDomainRejected
    && malformedStreamRejected
    && stream.map((event) => event.kind).join(",") === "delta,delta,done"
    ? "pass"
    : "fail";

  return {
    probeId: "gate0.provider",
    fixtureVersion: GATE_0_FIXTURE_VERSION,
    status,
    environment: { node: process.versions.node, platform: process.platform, arch: process.arch },
    input: { fixture: "provider-manifest-and-sse", bytes: 512 },
    metrics: { sampleCount: timings.length, p50Ms: percentile(timings, 50), p95Ms: percentile(timings, 95), p99Ms: percentile(timings, 99) },
    details: {
      validManifestErrors: validErrors.length,
      scriptMappingRejected,
      undeclaredDomainRejected,
      malformedStreamRejected,
      streamEvents: stream.map((event) => `${event.kind}:${event.text}`),
      errorCodes: [...scriptErrors, ...domainErrors].map((error) => error.code),
      fallbackAttempted,
    },
    errors: [],
  };
}
