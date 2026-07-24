import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createWorker } from "tesseract.js";

const require = createRequire(import.meta.url);
const englishData = require("@tesseract.js-data/eng") as {
  langPath: string;
  gzip: boolean;
};

export interface LocalOcrPageResult {
  available: boolean;
  matched: boolean;
  imagePath: string;
  expectedTerms: string[];
  text: string;
  confidence: number | null;
  elapsedMs: number;
  error: string | null;
}

export interface LocalOcrResult extends LocalOcrPageResult {}

export async function recognizeScanPages(
  imagePaths: readonly string[],
  expectedTermsByPage: readonly string[][] = imagePaths.map(() => []),
): Promise<LocalOcrPageResult[]> {
  const worker = await createWorker("eng", 1, {
    langPath: englishData.langPath,
    gzip: englishData.gzip,
    cacheMethod: "none",
  });
  try {
    const pages: LocalOcrPageResult[] = [];
    for (const [index, imagePath] of imagePaths.entries()) {
      const expectedTerms = expectedTermsByPage[index] ?? [];
      const started = performance.now();
      try {
        const image = await readFile(join(process.cwd(), imagePath));
        const result = await worker.recognize(image);
        const text = result.data.text.replace(/\s+/g, " ").trim();
        const confidence = typeof result.data.confidence === "number" ? result.data.confidence : null;
        pages.push({
          available: true,
          matched: expectedTerms.every((term) => text.includes(term)),
          imagePath,
          expectedTerms,
          text,
          confidence,
          elapsedMs: performance.now() - started,
          error: null,
        });
      } catch (error) {
        pages.push({
          available: true,
          matched: false,
          imagePath,
          expectedTerms,
          text: "",
          confidence: null,
          elapsedMs: performance.now() - started,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return pages;
  } finally {
    await worker.terminate();
  }
}

export async function recognizeScanFixture(
  imagePath = "fixtures/gate-0/ocr-scan.png",
  expectedTerms = ["PaperWithA", "OCR fixture"],
): Promise<LocalOcrResult> {
  const [page] = await recognizeScanPages([imagePath], [expectedTerms]);
  if (!page) throw new Error(`OCR produced no result for ${imagePath}`);
  return page;
}
