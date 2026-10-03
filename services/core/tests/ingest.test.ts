import { describe, expect, it } from "vitest";
import { extractPages, splitTextIntoPages } from "../src/ingest";

/** 构造一个只有一页、带真实文本层的 PDF。 */
function buildPdf(text = "Hello PaperWithA ingest test."): Uint8Array {
  const objects: Record<number, string> = {
    1: "<< /Type /Catalog /Pages 2 0 R >>",
    2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    3: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    4: `<< /Length ${text.length + 44} >>\nstream\nBT /F1 24 Tf 72 700 Td (${text}) Tj ET\nendstream`,
    5: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  };
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id <= 5; id += 1) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const startxref = pdf.length;
  pdf += "xref\n0 6\n0000000000 65535 f \n";
  for (let id = 1; id <= 5; id += 1) pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

describe("splitTextIntoPages", () => {
  it("keeps page numbers contiguous across a 45-line boundary", () => {
    const pages = splitTextIntoPages(Array.from({ length: 50 }, (_, index) => `line ${index + 1}`).join("\n"));
    expect(pages.map((page) => page.pageNumber)).toEqual([1, 2]);
    expect(pages[0]?.text.startsWith("line 1")).toBe(true);
    expect(pages[1]?.text.startsWith("line 46")).toBe(true);
  });

  it("ignores a trailing empty chunk", () => {
    expect(splitTextIntoPages(`${"x\n".repeat(45)}`)).toHaveLength(1);
  });

  it("keeps an empty document as one empty page", () => {
    expect(splitTextIntoPages("")).toEqual([{ pageNumber: 1, text: "" }]);
  });
});

describe("extractPages", () => {
  it("reads markdown as text pages", async () => {
    const pages = await extractPages("notes.md", new TextEncoder().encode("# 标题\n\n正文。"));
    expect(pages).toEqual([{ pageNumber: 1, text: "# 标题\n\n正文。" }]);
  });

  it("extracts the text layer from a PDF", async () => {
    const pages = await extractPages("sample.pdf", buildPdf());
    expect(pages).toHaveLength(1);
    expect(pages[0]?.text).toContain("Hello PaperWithA ingest test.");
  });
});
