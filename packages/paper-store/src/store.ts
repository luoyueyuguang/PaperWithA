import { mkdir, readdir, stat, readFile, writeFile } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import { createHash } from "node:crypto";
import { paperwithaPaths } from "./paths.js";

/** Index entry for a paper tracked by PaperWithA. */
export interface PaperEntry {
  /** SHA-256 of the original PDF file. */
  fileHash: string;
  /** Original filename (e.g. "attention.pdf"). */
  fileName: string;
  /** Human-readable title derived from filename. */
  title: string;
  /** Filesystem path to the stored copy. */
  storedPath: string;
  /** ISO timestamp when the paper was first indexed. */
  importedAt: string;
  /** Path to the subagent result file, or null if not yet analyzed. */
  resultPath: string | null;
  /** Analysis status. */
  status: "pending" | "analyzing" | "done" | "failed";
}

export interface PaperIndex {
  papers: PaperEntry[];
}

/** Result produced by a paper-analysis subagent. */
export interface PaperResult {
  fileHash: string;
  analyzedAt: string;
  model: string | null;
  sections: Array<{
    heading: string;
    content: string;
    confidence: "stated" | "inferred" | "general-knowledge" | "insufficient-evidence";
  }>;
}

/**
 * Compute SHA-256 of a file by reading it in full.
 */
export async function computeFileHash(filePath: string): Promise<string> {
  const data = await readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Derive a human-readable title from a filename.
 * "attention-is-all-you-need.pdf" → "Attention Is All You Need"
 */
export function titleFromFileName(fileName: string): string {
  return basename(fileName, extname(fileName))
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || "Untitled";
}

/**
 * Open (or create) the PaperWithA data directories and return the index.
 */
export async function loadIndex(): Promise<PaperIndex> {
  const { indexPath, papersDir, resultsDir } = paperwithaPaths();
  await mkdir(papersDir, { recursive: true });
  await mkdir(resultsDir, { recursive: true });

  try {
    const raw = await readFile(indexPath, "utf-8");
    return JSON.parse(raw) as PaperIndex;
  } catch {
    return { papers: [] };
  }
}

async function saveIndex(index: PaperIndex): Promise<void> {
  const { indexPath } = paperwithaPaths();
  await writeFile(indexPath, JSON.stringify(index, null, 2), "utf-8");
}

/**
 * Add a paper PDF to the store.  Copies the file into the papers directory,
 * indexes it, and returns the entry.
 */
export async function ingestPaper(sourcePath: string): Promise<PaperEntry> {
  const index = await loadIndex();
  const fileHash = await computeFileHash(sourcePath);

  // Deduplicate by hash.
  const existing = index.papers.find((p) => p.fileHash === fileHash);
  if (existing) return existing;

  const fileName = basename(sourcePath);
  const title = titleFromFileName(fileName);
  const { papersDir } = paperwithaPaths();

  // Copy into papers/ — use hash prefix to avoid collisions.
  const storedName = `${fileHash.slice(0, 12)}-${fileName}`;
  const storedPath = join(papersDir, storedName);
  await writeFile(storedPath, await readFile(sourcePath));

  const resultPath = join(paperwithaPaths().resultsDir, `${fileHash}.json`);
  const entry: PaperEntry = {
    fileHash,
    fileName,
    title,
    storedPath,
    importedAt: new Date().toISOString(),
    resultPath,
    status: "pending",
  };

  index.papers.push(entry);
  await saveIndex(index);
  return entry;
}

/**
 * Mark a paper's analysis as started / done / failed.
 */
export async function updatePaperStatus(
  fileHash: string,
  status: PaperEntry["status"],
): Promise<void> {
  const index = await loadIndex();
  const entry = index.papers.find((p) => p.fileHash === fileHash);
  if (entry) {
    entry.status = status;
    await saveIndex(index);
  }
}

/**
 * Store subagent result for a paper.
 */
export async function savePaperResult(fileHash: string, result: PaperResult): Promise<void> {
  const { resultsDir } = paperwithaPaths();
  const resultPath = join(resultsDir, `${fileHash}.json`);
  await writeFile(resultPath, JSON.stringify(result, null, 2), "utf-8");
  await updatePaperStatus(fileHash, "done");
}

/**
 * Load subagent result for a paper, or null if not found.
 */
export async function loadPaperResult(fileHash: string): Promise<PaperResult | null> {
  const { resultsDir } = paperwithaPaths();
  try {
    const raw = await readFile(join(resultsDir, `${fileHash}.json`), "utf-8");
    return JSON.parse(raw) as PaperResult;
  } catch {
    return null;
  }
}
