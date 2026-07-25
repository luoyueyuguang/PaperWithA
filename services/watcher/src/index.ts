import { watch } from "node:fs";
import { basename } from "node:path";
import { ingestPaper, loadIndex, loadPaperResult, savePaperResult, updatePaperStatus, paperwithaPaths, type PaperEntry, type PaperResult } from "@paperwitha/paper-store";
import { spawn } from "node:child_process";

const { papersDir } = paperwithaPaths();
const POLL_INTERVAL_MS = 3000;
const PI_TIMEOUT_MS = 300_000; // 5 minutes per paper

/** Run Pi to analyze a paper, store the result. */
async function analyzePaper(entry: PaperEntry): Promise<void> {
  await updatePaperStatus(entry.fileHash, "analyzing");
  console.log(`[watcher] analyzing: ${entry.title}`);

  const prompt = [
    `Analyze the paper at "${entry.storedPath}".`,
    "Return a JSON object with this exact schema:",
    '{',
    '  "fileHash": "' + entry.fileHash + '",',
    '  "analyzedAt": "<ISO timestamp>",',
    '  "model": null,',
    '  "sections": [',
    '    { "heading": "Problem Statement", "content": "...", "confidence": "stated" },',
    '    { "heading": "Author Claims", "content": "...", "confidence": "stated" },',
    '    { "heading": "Method & Approach", "content": "...", "confidence": "inferred" },',
    '    { "heading": "Key Contributions", "content": "...", "confidence": "stated" },',
    '    { "heading": "Critical Evidence", "content": "...", "confidence": "stated" },',
    '    { "heading": "Results & Limitations", "content": "...", "confidence": "stated" },',
    '    { "heading": "Open Questions", "content": "...", "confidence": "inferred" }',
    '  ]',
    '}',
    "Confidence must be one of: stated, inferred, general-knowledge, insufficient-evidence.",
    "Do not include any text outside the JSON.",
  ].join("\n");

  try {
    const output = await runPi(prompt);
    const jsonStart = output.indexOf("{");
    const jsonEnd = output.lastIndexOf("}") + 1;
    if (jsonStart < 0 || jsonEnd <= jsonStart) {
      throw new Error("no JSON found in Pi output");
    }

    const result: PaperResult = JSON.parse(output.slice(jsonStart, jsonEnd));
    result.fileHash = entry.fileHash;
    await savePaperResult(entry.fileHash, result);
    console.log(`[watcher] done: ${entry.title}`);
  } catch (err) {
    console.error(`[watcher] failed: ${entry.title}`, err);
    try { await updatePaperStatus(entry.fileHash, "failed"); } catch { /* ignore */ }
  }
}

/** Spawn Pi with a prompt and return its stdout. */
function runPi(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("pi", ["--mode", "oneshot", prompt], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: PI_TIMEOUT_MS,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`pi exited ${code}: ${stderr}`));
    });

    child.on("error", reject);
  });
}

/** Scan for newly-added papers and analyze pending ones. */
async function scanAndAnalyze(): Promise<void> {
  const index = await loadIndex();
  const pending = index.papers.filter((p) => p.status === "pending");

  for (const entry of pending) {
    await analyzePaper(entry);
  }
}

/** Start the file watcher loop. */
export function startWatcher(): void {
  console.log(`[watcher] watching ${papersDir}`);

  // Watch for new files
  try {
    watch(papersDir, { persistent: false }, async (eventType, filename) => {
      if (eventType === "rename" && filename?.endsWith(".pdf")) {
        const { join } = await import("node:path");
        const filePath = join(papersDir, filename);
        try {
          const entry = await ingestPaper(filePath);
          if (entry.status === "pending") {
            await analyzePaper(entry);
          }
        } catch (err) {
          console.error(`[watcher] ingest failed: ${filename}`, err);
        }
      }
    });
  } catch {
    // fs.watch may not be available — fall back to polling
    console.log("[watcher] fs.watch unavailable, using polling");
  }

  // Poll for pending papers
  setInterval(async () => {
    try {
      await scanAndAnalyze();
    } catch (err) {
      console.error("[watcher] scan error:", err);
    }
  }, POLL_INTERVAL_MS);

  // Also ingest any papers already placed in the directory
  void scanAndAnalyze();
}

// CLI entry point
if (process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js")) {
  startWatcher();
}
