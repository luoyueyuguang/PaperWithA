/**
 * agent 写的两个清单文件。解析失败一律返回 null：
 * 缺文件、字段非法都要报错给用户，不能静默产出一个空视频或空幻灯片。
 */

export interface FrameSpec {
  readonly file: string;
  readonly durationMs: number;
}

export interface FramesManifest {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly frames: readonly FrameSpec[];
}

export interface DeckSlide {
  readonly title: string;
  /** 相对 artifact 目录的路径。 */
  readonly file: string;
}

export interface DeckManifest {
  readonly title: string;
  readonly slides: readonly DeckSlide[];
}

export const FRAME_WIDTH = 1280;
export const FRAME_HEIGHT = 720;
const DEFAULT_FPS = 30;
export const MAX_FRAMES = 240;
export const MAX_SLIDES = 40;
const MAX_FRAME_MS = 20_000;
const DEFAULT_FRAME_MS = 1000;

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function relativeFile(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const file = value.trim();
  if (file.length === 0) return null;
  // 只接受相对路径，且不允许跳出 artifact 目录。
  if (file.startsWith("/") || file.split(/[\\/]/).includes("..")) return null;
  return file;
}

export function parseFramesManifest(raw: unknown): FramesManifest | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as { width?: unknown; height?: unknown; fps?: unknown; frames?: unknown };
  if (!Array.isArray(source.frames) || source.frames.length === 0 || source.frames.length > MAX_FRAMES) return null;
  const frames: FrameSpec[] = [];
  for (const entry of source.frames) {
    if (typeof entry !== "object" || entry === null) return null;
    const frame = entry as { file?: unknown; durationMs?: unknown };
    const file = relativeFile(frame.file);
    if (!file) return null;
    frames.push({ file, durationMs: Math.min(positiveNumber(frame.durationMs, DEFAULT_FRAME_MS), MAX_FRAME_MS) });
  }
  return {
    width: Math.round(positiveNumber(source.width, FRAME_WIDTH)),
    height: Math.round(positiveNumber(source.height, FRAME_HEIGHT)),
    fps: Math.round(positiveNumber(source.fps, DEFAULT_FPS)),
    frames,
  };
}

export function parseDeckManifest(raw: unknown): DeckManifest | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as { title?: unknown; slides?: unknown };
  if (!Array.isArray(source.slides) || source.slides.length === 0 || source.slides.length > MAX_SLIDES) return null;
  const slides: DeckSlide[] = [];
  for (const entry of source.slides) {
    if (typeof entry !== "object" || entry === null) return null;
    const slide = entry as { title?: unknown; file?: unknown };
    const file = relativeFile(slide.file);
    if (!file) return null;
    slides.push({ title: typeof slide.title === "string" && slide.title.trim().length > 0 ? slide.title.trim() : `第 ${slides.length + 1} 页`, file });
  }
  return {
    title: typeof source.title === "string" && source.title.trim().length > 0 ? source.title.trim() : "幻灯片",
    slides,
  };
}
