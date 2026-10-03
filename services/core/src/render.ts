import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RenderCapabilities } from "@paperwitha/domain";
import { parseFramesManifest, type FrameSpec } from "./manifests";

function run(binary: string, args: readonly string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const { promise, resolve } = Promise.withResolvers<{ ok: boolean; stdout: string; stderr: string }>();
  execFile(
    binary,
    [...args],
    { timeout: 600_000, maxBuffer: 32 * 1024 * 1024 },
    (error, stdout, stderr) => {
      resolve({ ok: error === null, stdout: String(stdout), stderr: String(stderr) });
    },
  );
  return promise;
}

/** 只按 ENOENT 判断「没装」：某些工具（本机 ffmpeg）对 --version 返回非零退出码。 */
export async function commandExists(binary: string): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  execFile(binary, ["--version"], { timeout: 5000 }, (error) => {
    resolve(!(error && (error as NodeJS.ErrnoException).code === "ENOENT"));
  });
  return promise;
}

export async function detectRenderers(): Promise<RenderCapabilities> {
  const [svg, video, manim] = await Promise.all([
    commandExists("rsvg-convert"),
    commandExists("ffmpeg"),
    commandExists("manim"),
  ]);
  return { svg, video: video && svg, manim };
}

export async function readFramesManifest(file: string) {
  try {
    return parseFramesManifest(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return null;
  }
}

const FFMPEG_LOG_LIMIT = 400;

/** SVG → PNG。尺寸取自 manifest，保证所有帧一样大。 */
export async function svgToPng(svgFile: string, pngFile: string, width: number, height: number): Promise<void> {
  const result = await run("rsvg-convert", ["-w", String(width), "-h", String(height), "-o", pngFile, svgFile]);
  if (!result.ok) throw new Error(`rsvg-convert 失败：${(result.stderr || result.stdout).slice(0, FFMPEG_LOG_LIMIT)}`);
}

/** 把一串 PNG 按时长拼成 MP4。ffmpeg 用 concat demuxer，最后重复末帧补足时长。 */
export async function pngSequenceToMp4(
  directory: string,
  frames: readonly FrameSpec[],
  pngFiles: readonly string[],
  manifest: { width: number; height: number; fps: number },
  outputFile: string,
): Promise<number> {
  const listFile = join(directory, "frames.txt");
  const lines = frames.map((frame, index) => `file '${pngFiles[index]}'\nduration ${(frame.durationMs / 1000).toFixed(3)}`);
  lines.push(`file '${pngFiles[pngFiles.length - 1]}'`);
  await writeFile(listFile, `${lines.join("\n")}\n`, "utf8");

  const result = await run("ffmpeg", [
    "-y",
    "-loglevel", "error",
    "-f", "concat",
    "-safe", "0",
    "-i", listFile,
    "-vf", `fps=${manifest.fps},scale=${manifest.width}:${manifest.height},format=yuv420p`,
    "-c:v", "libx264",
    "-preset", "medium",
    "-movflags", "+faststart",
    outputFile,
  ]);
  await rm(listFile, { force: true });
  if (!result.ok) throw new Error(`ffmpeg 失败：${(result.stderr || result.stdout).slice(0, FFMPEG_LOG_LIMIT)}`);
  return frames.reduce((total, frame) => total + frame.durationMs, 0);
}

/** 把 SVGO 帧渲染成 MP4，返回总时长。 */
export async function renderFramesToMp4(
  directory: string,
  manifestFile: string,
  outputFile: string,
): Promise<{ durationMs: number; width: number; height: number }> {
  const manifest = await readFramesManifest(manifestFile);
  if (!manifest) throw new Error("frames.json 缺失或格式不对");

  const frameDir = join(directory, "_frames");
  await mkdir(frameDir, { recursive: true });
  const pngFiles = await Promise.all(
    manifest.frames.map(async (frame, index) => {
      const pngFile = join(frameDir, `${String(index).padStart(3, "0")}.png`);
      await svgToPng(join(directory, frame.file), pngFile, manifest.width, manifest.height);
      return pngFile;
    }),
  );

  const durationMs = await pngSequenceToMp4(directory, manifest.frames, pngFiles, manifest, outputFile);
  await rm(frameDir, { recursive: true, force: true });
  return { durationMs, width: manifest.width, height: manifest.height };
}

const DECK_HEAD = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>__TITLE__</title>
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: #0b1220; color: #e6edf7; font-family: system-ui, "Noto Sans CJK SC", sans-serif; }
section { height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 32px; page-break-after: always; }
section svg { max-width: 100%; height: auto; }
h2 { font-size: 20px; font-weight: 600; margin: 0; color: #9fb4d4; }
@media print { section { height: 100vh; } }
</style>
</head>
<body>
`;

/** 无脚本的自包含 deck：每页一张 SVG。可以打印成 PDF，也可以直接读。 */
export function buildDeckHtml(title: string, slides: readonly { readonly title: string; readonly svg: string }[]): string {
  const parts = slides.map(
    (slide, index) =>
      `<section><h2>${index + 1} / ${slides.length} · ${escapeHtml(slide.title)}</h2>${slide.svg}</section>`,
  );
  return `${DECK_HEAD.replace("__TITLE__", escapeHtml(title))}${parts.join("\n")}\n</body>\n</html>\n`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);
}
