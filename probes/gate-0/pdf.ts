import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { DocumentGraph, DocumentPage } from "../../packages/domain/src/document.js";
import {
  createCrossPageAnchor,
  visiblePageNumbers,
  type EvidenceAnchor,
} from "../../packages/reader-core/src/index.js";
import {
  GATE_0_FIXTURE_VERSION,
  percentile,
  type ProbeReport,
} from "../../packages/contracts/src/probe.js";
import { recognizeScanPages, type LocalOcrPageResult, type LocalOcrResult } from "./ocr.js";

type PdfProfile = {
  profile: "A" | "B" | "C";
  pageCount: number;
  mode: "text" | "scan";
  columns: number;
  figures: boolean;
  formulas: boolean;
};

function buildPdf(objects: readonly Buffer[]): Uint8Array {
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n", "utf8")];
  const offsets: number[] = [0];
  let length = chunks[0]!.length;
  for (const [index, object] of objects.entries()) {
    offsets.push(length);
    const prefix = Buffer.from(`${index + 1} 0 obj\n`, "utf8");
    const suffix = Buffer.from("\nendobj\n", "utf8");
    chunks.push(prefix, object, suffix);
    length += prefix.length + object.length + suffix.length;
  }
  const xrefOffset = length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, "utf8"));
  return new Uint8Array(Buffer.concat(chunks));
}

function createImagePdfFixture(pageCount: number): Uint8Array {
  const imagePaths = [
    "fixtures/gate-0/real-paper-scan-0.jpg",
    "fixtures/gate-0/real-paper-scan-1.jpg",
    "fixtures/gate-0/real-paper-scan-2.jpg",
    "fixtures/gate-0/real-paper-blank.jpg",
  ];
  const images = imagePaths.map((path) => readFileSync(path));
  const pageStart = 3;
  const contentStart = pageStart + pageCount;
  const imageStart = contentStart + pageCount;
  const pageIds = Array.from({ length: pageCount }, (_, index) => pageStart + index);
  const objects: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "utf8"),
    Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`, "utf8"),
  ];
  for (let index = 0; index < pageCount; index += 1) {
    const imageId = imageStart + Math.min(index, images.length - 1);
    objects.push(Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 ${imageId} 0 R >> >> /Contents ${contentStart + index} 0 R >>`,
      "utf8",
    ));
  }
  for (let index = 0; index < pageCount; index += 1) {
    objects.push(Buffer.from("<< /Length 34 >>\nstream\nq 612 0 0 792 0 0 cm /Im1 Do Q\nendstream", "utf8"));
  }
  for (const image of images) {
    const header = Buffer.from(
      `<< /Type /XObject /Subtype /Image /Width 1275 /Height 1650 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`,
      "utf8",
    );
    objects.push(Buffer.concat([header, image, Buffer.from("\nendstream", "utf8")]));
  }
  return buildPdf(objects);
}

function createPdfFixture(profile: PdfProfile): Uint8Array {
  if (profile.mode === "scan") return createImagePdfFixture(profile.pageCount);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: profile.pageCount }, (_, index) => `${3 + index * 2} 0 R`).join(" ")}] /Count ${profile.pageCount} >>`,
    ...Array.from({ length: profile.pageCount }, (_, index) => {
      const pageObject = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${3 + profile.pageCount * 2} 0 R >> >> /Contents ${4 + index * 2} 0 R >>`;
      const text = profile.mode === "scan"
        ? "q 0.9 g 72 72 468 648 re f Q"
        : profile.columns === 2
          ? `BT /F1 12 Tf 54 720 Td (PaperWithA B left column page ${index + 1}) Tj ET\nBT /F1 12 Tf 324 720 Td (PaperWithA B right column page ${index + 1}) Tj ET\nBT /F1 10 Tf 54 690 Td (formula x^2 + y^2 = z^2) Tj ET\nq 0.8 G 180 420 240 120 re S Q`
          : `BT /F1 18 Tf 72 720 Td (PaperWithA A fixture page ${index + 1}) Tj ET`;
      const contentObject = `<< /Length ${Buffer.byteLength(text, "utf8")} >>\nstream\n${text}\nendstream`;
      return [pageObject, contentObject];
    }).flat(),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body, "utf8"));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, "utf8");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    body += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, "utf8"));
}

export interface PdfProfileResult {
  profile: PdfProfile["profile"];
  pageCount: number;
  bytes: number;
  columns: number;
  figures: boolean;
  formulas: boolean;
  scanSimulated: boolean;
  firstPageText: string;
  textItemsOnFirstPage: number;
  visiblePageNumbers: number[];
  activePageCount: number;
  fallback: "none" | "page-only";
  crossPageAnchor: EvidenceAnchor | null;
  ocr: LocalOcrResult | null;
  ocrPages: LocalOcrPageResult[] | null;
  parseMs: number;
}

export interface PdfProbeDetails {
  profiles: PdfProfileResult[];
  crossPageAnchor: EvidenceAnchor;
  virtualized: boolean;
}

async function inspectProfile(profile: PdfProfile, timings: number[]): Promise<PdfProfileResult> {
  const pdfBytes = createPdfFixture(profile);
  const inputBytes = pdfBytes.byteLength;
  const started = performance.now();
  const document = await getDocument({
    data: pdfBytes,
    useWorkerFetch: false,
    disableFontFace: true,
    useSystemFonts: true,
  }).promise;
  const pages: DocumentPage[] = [];
  let firstPageItemCount = 0;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    if (pageNumber === 1) firstPageItemCount = content.items.length;
    pages.push({
      pageId: `${profile.profile.toLowerCase()}-page-${pageNumber}`,
      pageNumber,
      text: content.items.map((item) => ("str" in item ? item.str : "")).join(" "),
      layout: {
        columns: profile.columns,
        figureCount: profile.figures ? 1 : 0,
        formulaCount: profile.formulas ? 1 : 0,
      },
      confidence: profile.mode === "scan" ? 0.2 : 0.95,
    });
  }
  const parseMs = performance.now() - started;
  timings.push(parseMs);
  const graph: DocumentGraph = {
    graphId: `graph-pdf-fixture-${profile.profile.toLowerCase()}`,
    documentId: `document-fixture-${profile.profile.toLowerCase()}`,
    documentVersionId: `document-fixture-${profile.profile.toLowerCase()}-v1`,
    pages,
  };
  const firstText = pages[0]?.text ?? "";
  const lastText = pages[1]?.text ?? "";
  const crossPageAnchor = profile.mode === "text"
    ? createCrossPageAnchor(graph, {
      documentVersionId: graph.documentVersionId,
      startPage: 1,
      endPage: 2,
      startOffset: 0,
      endOffset: lastText.length,
    })
    : null;
  const visible = visiblePageNumbers(document.numPages, Math.ceil(document.numPages / 2), 1);
  const ocrPages = profile.mode === "scan"
    ? await recognizeScanPages(
      [
        "fixtures/gate-0/real-paper-scan-0.png",
        "fixtures/gate-0/real-paper-scan-1.png",
        "fixtures/gate-0/real-paper-scan-2.png",
      ],
      [["Attention", "All"], [], []],
    )
    : null;
  const ocr = ocrPages?.[0] ?? null;
  return {
    profile: profile.profile,
    pageCount: profile.pageCount,
    bytes: inputBytes,
    columns: profile.columns,
    figures: profile.figures,
    formulas: profile.formulas,
    scanSimulated: profile.mode === "scan",
    firstPageText: firstText,
    textItemsOnFirstPage: firstPageItemCount,
    visiblePageNumbers: visible,
    activePageCount: visible.length,
    fallback: profile.mode === "scan" ? "page-only" : "none",
    crossPageAnchor,
    ocr,
    ocrPages,
    parseMs,
  };
}

export async function runPdfProbe(): Promise<ProbeReport<PdfProbeDetails>> {
  const timings: number[] = [];
  const profiles = await Promise.all([
    inspectProfile({ profile: "A", pageCount: 20, mode: "text", columns: 1, figures: false, formulas: false }, timings),
    inspectProfile({ profile: "B", pageCount: 200, mode: "text", columns: 2, figures: true, formulas: true }, timings),
    inspectProfile({ profile: "C", pageCount: 500, mode: "scan", columns: 1, figures: false, formulas: false }, timings),
  ]);
  const profileA = profiles.find((profile) => profile.profile === "A")!;
  const profileB = profiles.find((profile) => profile.profile === "B")!;
  const profileC = profiles.find((profile) => profile.profile === "C")!;
  const crossPageAnchor = profileA.crossPageAnchor!;
  const status = profileA.pageCount === 20
    && profileB.pageCount === 200
    && profileC.pageCount === 500
    && profileB.textItemsOnFirstPage > 0
    && profileB.columns === 2
    && profileB.figures
    && profileB.formulas
    && profileC.textItemsOnFirstPage === 0
    && profileC.scanSimulated
    && profileC.fallback === "page-only"
    && profileC.ocr?.available
    && profileC.ocr.matched
    && profileC.ocrPages?.length === 3
    && profileC.ocrPages.every((page) => page.available && page.matched && page.text.length > 0 && page.confidence !== null)
    && crossPageAnchor.validity === "valid"
    ? "pass"
    : "fail";
  return {
    probeId: "gate0.pdf",
    fixtureVersion: GATE_0_FIXTURE_VERSION,
    status,
    environment: { node: process.versions.node, platform: process.platform, arch: process.arch },
    input: { fixture: "A+B+C", bytes: profiles.reduce((sum, profile) => sum + profile.bytes, 0) },
    metrics: {
      sampleCount: timings.length,
      p50Ms: percentile(timings, 50),
      p95Ms: percentile(timings, 95),
      p99Ms: percentile(timings, 99),
    },
    details: {
      profiles,
      crossPageAnchor,
      virtualized: profiles.every((profile) => profile.activePageCount <= 3),
    },
    errors: profiles.flatMap((profile) => profile.ocr?.error ? [`${profile.profile}: ${profile.ocr.error}`] : []),
  };
}
