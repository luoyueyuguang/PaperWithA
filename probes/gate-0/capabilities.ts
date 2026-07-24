import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

interface CapabilityResult {
  available: boolean;
  command: string | null;
}

function findCommand(candidates: readonly string[]): CapabilityResult {
  const resolver = process.platform === "win32" ? "where" : "which";
  for (const candidate of candidates) {
    const result = spawnSync(resolver, [candidate], { encoding: "utf8" });
    if (result.status === 0) return { available: true, command: candidate };
  }
  return { available: false, command: null };
}

const systemOcr = findCommand(["tesseract"]);
const require = createRequire(import.meta.url);
let localOcrAvailable = false;
try {
  require("tesseract.js");
  require("@tesseract.js-data/eng");
  localOcrAvailable = true;
} catch {
  localOcrAvailable = false;
}
const ocr: CapabilityResult = {
  available: systemOcr.available || localOcrAvailable,
  command: systemOcr.available ? systemOcr.command : localOcrAvailable ? "tesseract.js-local" : null,
};
const browser = findCommand(["chromium", "chromium-browser", "google-chrome"]);
const result = {
  platform: process.platform,
  ocr,
  browser,
  gate0Impact: {
    ocr: ocr.available ? "available" : "blocked: install or provide an OCR runtime for real scan fixtures",
    browser: browser.available ? "available" : "blocked: use a managed browser or Gate 3 host for pointer preview",
  },
};

console.log(JSON.stringify(result, null, 2));
