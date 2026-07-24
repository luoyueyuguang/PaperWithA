export type ProbeStatus = "pass" | "fail" | "blocked";

export interface ProbeReport<Details> {
  probeId: string;
  fixtureVersion: string;
  status: ProbeStatus;
  environment: {
    node: string;
    platform: string;
    arch: string;
  };
  input: {
    fixture: string;
    bytes: number;
  };
  metrics: {
    sampleCount: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
  };
  details: Details;
  errors: string[];
}

export const GATE_0_FIXTURE_VERSION = "gate0-v1";

export function percentile(values: readonly number[], percentileRank: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileRank / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
}
