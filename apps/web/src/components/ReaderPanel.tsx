import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type Ref } from "react";
import type { PaperSummary, PaperText } from "@paperwitha/domain";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { client, errorText } from "../core";
import { loadPdf, renderPdfPage } from "../pdf";

export interface ReaderHandle {
  /** 滚动到指定页并短暂高亮；Chat 里的引用标签用它跳页。 */
  scrollToPage(pageNumber: number): void;
}

export interface ReaderPanelProps {
  readonly paper: PaperSummary | null;
  readonly text: PaperText | null;
  readonly loading: boolean;
  readonly textError: string | null;
  readonly onAsk: (pageNumber: number, quote: string) => void;
}

interface Selection {
  readonly page: number;
  readonly quote: string;
  readonly left: number;
  readonly top: number;
}

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;
const ZOOM_WHEEL_STEP = 0.1;
/** 缩放后校正阅读位置的等待时间：PDF 页面尺寸是异步改的。 */
const ZOOM_ANCHOR_MS = 240;

interface ZoomAnchor {
  readonly page: number;
  /** 视口顶端落在该页内的相对位置，0 表示正好在页面顶端。 */
  readonly offsetRatio: number;
}

export const ReaderPanel = forwardRef(function ReaderPanel(props: ReaderPanelProps, ref: Ref<ReaderHandle>) {
  const isPdf = props.paper !== null && props.paper.fileName.toLowerCase().endsWith(".pdf");
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const paperId = props.paper?.id ?? null;
  const [zoomByPaper, setZoomByPaper] = useState<Record<string, number>>({});
  const zoomAnchor = useRef<ZoomAnchor | null>(null);
  const zoom = (paperId ? zoomByPaper[paperId] : undefined) ?? 1;

  /** 每篇论文各自记住缩放倍数；改之前先记下当前读到哪儿。 */
  const changeZoom = useCallback(
    (next: number) => {
      if (!paperId) return;
      const clamped = Math.min(Math.max(Math.round(next * 100) / 100, ZOOM_MIN), ZOOM_MAX);
      const scroll = scrollRef.current;
      if (scroll && clamped !== zoom) {
        const viewportTop = scroll.getBoundingClientRect().top;
        const pages = [...scroll.querySelectorAll<HTMLElement>("[data-page]")];
        const current = pages.find((page) => page.getBoundingClientRect().bottom > viewportTop + 1) ?? pages[0];
        if (current) {
          const rect = current.getBoundingClientRect();
          zoomAnchor.current = {
            page: Number(current.dataset["page"]),
            offsetRatio: rect.height > 0 ? Math.min(Math.max((viewportTop - rect.top) / rect.height, 0), 1) : 0,
          };
        }
      }
      setZoomByPaper((previous) => ({ ...previous, [paperId]: clamped }));
    },
    [paperId, zoom],
  );

  // 缩放把页面尺寸改了，这里把视口拉回同一页的同一相对位置。等两帧再校正一次。
  useEffect(() => {
    const anchor = zoomAnchor.current;
    const scroll = scrollRef.current;
    if (!anchor || !scroll) return;
    const restore = () => {
      if (zoomAnchor.current !== anchor) return;
      const target = scroll.querySelector<HTMLElement>(`[data-page="${anchor.page}"]`);
      if (!target) return;
      const rect = target.getBoundingClientRect();
      scroll.scrollTop += rect.top + anchor.offsetRatio * rect.height - scroll.getBoundingClientRect().top;
    };
    const frame = requestAnimationFrame(() => requestAnimationFrame(restore));
    const timer = window.setTimeout(() => {
      restore();
      zoomAnchor.current = null;
    }, ZOOM_ANCHOR_MS);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [zoom]);

  // Ctrl/⌘ + 滚轮缩放论文本身，而不是整个界面。
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      changeZoom(zoom + (event.deltaY < 0 ? ZOOM_WHEEL_STEP : -ZOOM_WHEEL_STEP));
    };
    scroll.addEventListener("wheel", onWheel, { passive: false });
    return () => scroll.removeEventListener("wheel", onWheel);
  }, [changeZoom, zoom]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToPage(pageNumber: number) {
        const scroll = scrollRef.current;
        if (!scroll) return;
        const target = scroll.querySelector<HTMLElement>(`[data-page="${pageNumber}"]`);
        if (!target) return;
        scroll.scrollTop = Math.max(target.offsetTop - 8, 0);
        target.classList.add("page-flash");
        window.setTimeout(() => target.classList.remove("page-flash"), 1600);
      },
    }),
    [],
  );

  // 可用宽度决定 PDF 页面的缩放，窗口变化时重排。
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const measure = () => setAvailableWidth(Math.max(scroll.clientWidth - 48, 0));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroll);
    return () => observer.disconnect();
  }, [paperId]);

  // PDF 字节 → pdf.js 文档；换论文时销毁上一份。
  useEffect(() => {
    if (!paperId || !isPdf) {
      setPdf(null);
      setPdfError(null);
      setPdfLoading(false);
      return;
    }
    let cancelled = false;
    setPdf(null);
    setSelection(null);
    setPdfError(null);
    setPdfLoading(true);
    void (async () => {
      try {
        const bytes = await client.getPaperFile(paperId);
        const document = await loadPdf(bytes);
        if (cancelled) {
          void document.destroy();
          return;
        }
        pdfRef.current = document;
        setPdf(document);
      } catch (error) {
        if (!cancelled) setPdfError(errorText(error));
      } finally {
        if (!cancelled) setPdfLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      const document = pdfRef.current;
      pdfRef.current = null;
      if (document) void document.destroy();
    };
  }, [paperId, isPdf]);

  // 页面切换时清掉旧选区。
  useEffect(() => {
    setSelection(null);
    setNote(null);
  }, [paperId]);

  const captureSelection = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    const current = window.getSelection();
    if (!current || current.isCollapsed || current.rangeCount === 0) {
      setSelection(null);
      return;
    }
    const quote = current.toString().replace(/\s+/g, " ").trim();
    if (quote.length === 0) {
      setSelection(null);
      return;
    }
    const range = current.getRangeAt(0);
    const node = range.startContainer;
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    const pageElement = element?.closest("[data-page]");
    const page = Number(pageElement?.getAttribute("data-page"));
    if (!pageElement || !Number.isInteger(page)) {
      setSelection(null);
      return;
    }
    const bodyRect = body.getBoundingClientRect();
    const rect = range.getBoundingClientRect();
    setSelection({
      page,
      quote,
      left: Math.min(Math.max(rect.left - bodyRect.left + rect.width / 2, 96), Math.max(bodyRect.width - 96, 96)),
      top: Math.max(rect.top - bodyRect.top, 10),
    });
  }, []);

  const copyCitation = useCallback(async () => {
    if (!selection || !props.paper) return;
    const payload = `${props.paper.title} 第 ${selection.page} 页：“${selection.quote}”`;
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    try {
      await navigator.clipboard.writeText(payload);
      setNote("引用已复制");
    } catch (error) {
      setNote(`复制失败：${errorText(error)}`);
    }
    window.setTimeout(() => setNote(null), 2200);
  }, [selection, props.paper]);

  const pageCount = pdf ? pdf.numPages : (props.text?.pages.length ?? 0);

  return (
    <section className="panel reader" aria-label="阅读器">
      <header className="panel-head">
        <div className="reader-head-row">
          <div className="reader-head-text">
            <h2 className="panel-title">{props.paper ? props.paper.title : "阅读器"}</h2>
            <p className="panel-subtitle">
              {props.paper ? `${pageCount} 页 · ${props.paper.fileName}` : "选择左侧论文后在此阅读原文"}
            </p>
          </div>
          {props.paper && (
            <div className="zoom-controls" role="group" aria-label="缩放">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => changeZoom(zoom - ZOOM_STEP)}
                disabled={zoom <= ZOOM_MIN}
                title="缩小"
              >
                −
              </button>
              <button className="btn btn-ghost btn-sm zoom-value" onClick={() => changeZoom(1)} title="恢复到 100%">
                {Math.round(zoom * 100)}%
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => changeZoom(zoom + ZOOM_STEP)}
                disabled={zoom >= ZOOM_MAX}
                title="放大"
              >
                ＋
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="reader-body" ref={bodyRef}>
        <div
          className="reader-scroll"
          ref={scrollRef}
          style={{ "--reader-zoom": zoom } as CSSProperties}
          onMouseUp={captureSelection}
          onKeyUp={captureSelection}
          onScroll={() => setSelection(null)}
        >
          {!props.paper && <p className="empty-hint center">还没有选中论文。</p>}
          {props.paper && props.loading && <p className="empty-hint center">正在加载正文…</p>}
          {props.paper && !props.loading && props.textError && (
            <p className="status status-error center">读取正文失败：{props.textError}</p>
          )}
          {props.paper && !props.loading && !props.textError && isPdf && pdfLoading && (
            <p className="empty-hint center">正在加载 PDF…</p>
          )}
          {props.paper && isPdf && pdfError && (
            <p className="status status-error center">
              PDF 加载失败（{props.paper.fileName}）：{pdfError}
            </p>
          )}
          {pdf &&
            Array.from({ length: pdf.numPages }, (_, index) => (
              <PdfPage key={index + 1} doc={pdf} pageNumber={index + 1} width={availableWidth} zoom={zoom} />
            ))}
          {!isPdf &&
            props.text?.pages.map((page) => (
              <article className="paper-page text-page" data-page={page.pageNumber} key={page.pageNumber}>
                <div className="page-number">第 {page.pageNumber} 页</div>
                <div className="page-text">
                  {page.text
                    .split(/\n+/)
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0)
                    .map((line, index) => (
                      <p key={index}>{line}</p>
                    ))}
                  {page.text.trim().length === 0 && <p className="muted">（本页没有文本）</p>}
                </div>
              </article>
            ))}
        </div>

        {selection && (
          <div className="selection-toolbar" style={{ left: selection.left, top: selection.top }}>
            <span className="selection-page">第 {selection.page} 页</span>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                props.onAsk(selection.page, selection.quote);
                setSelection(null);
              }}
            >
              问这段
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => void copyCitation()}>
              复制引用
            </button>
          </div>
        )}
        {note && <div className="reader-toast">{note}</div>}
      </div>
    </section>
  );
});

function PdfPage({
  doc,
  pageNumber,
  width,
  zoom,
}: {
  readonly doc: PDFDocumentProxy;
  readonly pageNumber: number;
  readonly width: number;
  readonly zoom: number;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [near, setNear] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 渲染过的页面保留位图；只有回到视野附近才重绘。否则每次缩放都要重画整篇的几十页。
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const intersecting = entries.some((entry) => entry.isIntersecting);
        if (intersecting) setVisible(true);
        setNear(intersecting);
      },
      { root: frame.closest(".reader-scroll"), rootMargin: "800px 0px" },
    );
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !near || width <= 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const render = renderPdfPage(doc, pageNumber, { canvas, textLayer: textRef.current, availableWidth: width, zoom });
    let live = true;
    render.done.then(
      () => {
        if (live) setError(null);
      },
      (reason: unknown) => {
        if (live) setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      live = false;
      render.cancel();
    };
  }, [visible, near, width, zoom, doc, pageNumber]);

  return (
    <article className="paper-page pdf-page" data-page={pageNumber} ref={frameRef}>
      <div className="page-number">第 {pageNumber} 页</div>
      <div className="page-frame">
        <canvas ref={canvasRef} />
        <div className="textLayer" ref={textRef} />
      </div>
      {error && <p className="status status-error">第 {pageNumber} 页渲染失败：{error}</p>}
    </article>
  );
}
