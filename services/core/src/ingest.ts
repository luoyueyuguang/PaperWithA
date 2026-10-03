import type { PaperPage } from "@paperwitha/domain";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

/** 纯文本按固定行数分“页”，页号只用于引用定位。 */
const LINES_PER_PAGE = 45;

export async function extractPages(fileName: string, bytes: Uint8Array): Promise<PaperPage[]> {
  if (fileName.toLowerCase().endsWith(".pdf")) return extractPdfPages(bytes);
  return splitTextIntoPages(new TextDecoder().decode(bytes));
}

export function splitTextIntoPages(text: string): PaperPage[] {
  const lines = text.split(/\r?\n/);
  const pages: PaperPage[] = [];
  for (let start = 0; start < Math.max(lines.length, 1); start += LINES_PER_PAGE) {
    const chunk = lines.slice(start, start + LINES_PER_PAGE).join("\n").trim();
    if (chunk.length === 0 && pages.length > 0) continue;
    pages.push({ pageNumber: pages.length + 1, text: chunk });
  }
  return pages;
}

async function extractPdfPages(bytes: Uint8Array): Promise<PaperPage[]> {
  const document = await pdfjs.getDocument({
    data: bytes,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;
  try {
    const pages: PaperPage[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      pages.push({ pageNumber, text: text.length > 0 ? text : "(本页没有可提取的文本)" });
      page.cleanup();
    }
    return pages;
  } finally {
    await document.destroy();
  }
}
