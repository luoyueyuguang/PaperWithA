import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runPdfProbe } from "./pdf.js";
import { runSharedGraphProbe } from "./shared-graph.js";
import { runDockviewProbe } from "./dockview.js";
import { runProviderProbe } from "./provider.js";
import { runContextProbe } from "./context.js";
import { runLocalSessionsProbe } from "./local-sessions.js";

const reportsDirectory = join(process.cwd(), "probes/gate-0/reports/gate0-v1");

const availableProbes = [
  { id: "pdf", status: "implemented" },
  { id: "shared-graph", status: "implemented" },
  { id: "docking", status: "implemented" },
  { id: "provider", status: "implemented" },
  { id: "context", status: "implemented" },
  { id: "local-sessions", status: "implemented" },
] as const;

async function main(): Promise<void> {
  if (process.argv.includes("--list")) {
    console.log(JSON.stringify({ fixtureVersion: "gate0-v1", probes: availableProbes }, null, 2));
    return;
  }

  const requested = process.argv.slice(2);
  const probeIds = requested.length > 0 ? requested : availableProbes.map((probe) => probe.id);
  const reports = [];

  for (const probeId of probeIds) {
    if (probeId === "pdf") reports.push(await runPdfProbe());
    else if (probeId === "shared-graph") reports.push(await runSharedGraphProbe());
    else if (probeId === "docking") reports.push(await runDockviewProbe());
    else if (probeId === "provider") reports.push(await runProviderProbe());
    else if (probeId === "context") reports.push(await runContextProbe());
    else if (probeId === "local-sessions") reports.push(await runLocalSessionsProbe());
    else throw new Error(`Probe ${probeId} is not implemented yet`);
  }

  await mkdir(reportsDirectory, { recursive: true });
  for (const report of reports) {
    await writeFile(
      join(reportsDirectory, `${report.probeId}.json`),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
  }
  console.log(JSON.stringify(reports, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
