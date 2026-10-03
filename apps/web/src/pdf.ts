import { GlobalWorkerOptions, TextLayer, getDocument, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

/** 页面容器的可用宽度 → 页面缩放。过窄的窗口也要保证可读。 */
const MIN_FIT_SCALE = 0.4;
const MAX_FIT_SCALE = 3;
const FALLBACK_SCALE = 1.4;
/** 用户缩放之后的绝对上下限，防止渲染出荒唐尺寸的位图。 */
const MIN_SCALE = 0.1;
const MAX_SCALE = 8;

export function loadPdf(bytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  // pdf.js 会接管这份数据并在 destroy() 时释放，所以复制一份，避免影响调用方的 buffer。
  const task = getDocument({ data: new Uint8Array(bytes.slice(0)) });
  return task.promise;
}

export interface PdfPageTarget {
  readonly canvas: HTMLCanvasElement;
  /** 叠加在 canvas 上的可选文本层容器（class="textLayer"）。 */
  readonly textLayer: HTMLDivElement | null;
  /** 可用宽度（CSS px）；缺省时用固定缩放。 */
  readonly availableWidth?: number;
  /** 用户在「适应宽度」之上的缩放倍数，默认 1。 */
  readonly zoom?: number;
}

export interface PdfPageRender {
  readonly cancel: () => void;
  readonly done: Promise<void>;
}

export function renderPdfPage(document: PDFDocumentProxy, pageNumber: number, target: PdfPageTarget): PdfPageRender {
  let cancelled = false;
  let renderTask: RenderTask | null = null;
  let textLayer: TextLayer | null = null;

  const done = (async () => {
    const page = await document.getPage(pageNumber);
    if (cancelled) return;

    const base = page.getViewport({ scale: 1 });
    const available = target.availableWidth;
    const fit =
      available && available > 0
        ? Math.min(Math.max(available / base.width, MIN_FIT_SCALE), MAX_FIT_SCALE)
        : FALLBACK_SCALE;
    const scale = Math.min(Math.max(fit * (target.zoom ?? 1), MIN_SCALE), MAX_SCALE);
    const viewport = page.getViewport({ scale });

    const canvas = target.canvas;
    const outputScale = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas 2d 上下文不可用");

    renderTask = page.render({
      canvasContext: context,
      viewport,
      transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
    });
    await renderTask.promise;
    if (cancelled) return;

    const container = target.textLayer;
    if (!container) return;
    container.replaceChildren();
    container.style.setProperty("--scale-factor", String(viewport.scale));
    textLayer = new TextLayer({ textContentSource: await page.streamTextContent(), container, viewport });
    await textLayer.render();
  })();

  return {
    cancel: () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        // 渲染已完成时 cancel 会抛，忽略。
      }
      try {
        textLayer?.cancel();
      } catch {
        // 同上。
      }
    },
    done,
  };
}
