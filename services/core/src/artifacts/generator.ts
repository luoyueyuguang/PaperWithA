import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ARTIFACT_KIND_LABEL, type Artifact, type ArtifactSlide, type RenderCapabilities } from "@paperwitha/domain";
import { renderPaperMarkdown, type EmbeddedAgent } from "../agent";
import { parseDeckManifest } from "../manifests";
import { buildDeckHtml, renderFramesToMp4 } from "../render";
import { buildArtifactSystemPrompt, buildArtifactTaskPrompt, contextDocument, type ArtifactContext } from "./prompt";

export interface ArtifactJobOptions {
  readonly artifact: Artifact;
  readonly directory: string;
  readonly context: ArtifactContext;
}

export interface ArtifactJobDeps {
  readonly agent: EmbeddedAgent;
  readonly renderers: RenderCapabilities;
  readonly onUpdate: (artifact: Artifact) => void;
}

export async function runArtifactJob(job: ArtifactJobOptions, deps: ArtifactJobDeps): Promise<Artifact> {
  const { artifact, directory } = job;
  const title = `${ARTIFACT_KIND_LABEL[artifact.kind]} · ${job.context.paper.title}`;

  try {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "paper.md"), renderPaperMarkdown(job.context.paper, job.context.pages), "utf8");
    await writeFile(join(directory, "context.md"), contextDocument(job.context), "utf8");
    deps.onUpdate({ ...artifact, title });

    await deps.agent.runOnce({
      label: `artifact:${artifact.id}`,
      cwd: directory,
      instructions: buildArtifactSystemPrompt(artifact.kind, deps.renderers),
      prompt: buildArtifactTaskPrompt(artifact.kind, job.context),
    });

    const produced = await collectOutput(artifact.kind, directory, deps.renderers);
    const ready: Artifact = {
      ...artifact,
      title,
      status: "ready",
      updatedAt: new Date().toISOString(),
      error: null,
      entry: produced.entry,
      slides: produced.slides,
      durationMs: produced.durationMs,
    };
    deps.onUpdate(ready);
    return ready;
  } catch (error) {
    const failed: Artifact = {
      ...artifact,
      title,
      status: "failed",
      updatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      entry: null,
      slides: [],
      durationMs: null,
    };
    deps.onUpdate(failed);
    return failed;
  }
}

interface ProducedOutput {
  readonly entry: string;
  readonly slides: readonly ArtifactSlide[];
  readonly durationMs: number | null;
}

async function collectOutput(
  kind: Artifact["kind"],
  directory: string,
  renderers: RenderCapabilities,
): Promise<ProducedOutput> {
  const present = await listFiles(directory);
  const describe = () => (present.length > 0 ? present.join(", ") : "（目录是空的）");

  if (kind === "diagram") {
    if (!present.includes("diagram.svg")) throw new Error(`没有生成 diagram.svg。目录里有：${describe()}`);
    return { entry: "diagram.svg", slides: [], durationMs: null };
  }

  if (kind === "animation") {
    // 有帧清单就自己渲染：产物与清单一致，也能算出时长。没有才用 agent 直接产出的 mp4（manim 路径）。
    const video = present.find((name) => name.endsWith(".mp4"));
    if (!present.includes("frames.json")) {
      if (video) return { entry: video, slides: [], durationMs: null };
      throw new Error(`没有生成 animation.mp4 或 frames.json。目录里有：${describe()}`);
    }
    if (!renderers.video) throw new Error("机器上缺少 ffmpeg 或 rsvg-convert，无法把帧序列渲染成视频");
    const rendered = await renderFramesToMp4(directory, join(directory, "frames.json"), join(directory, "animation.mp4"));
    return { entry: "animation.mp4", slides: [], durationMs: rendered.durationMs };
  }

  if (!present.includes("deck.json")) throw new Error(`没有生成 deck.json。目录里有：${describe()}`);
  const deck = parseDeckManifest(JSON.parse(await readFile(join(directory, "deck.json"), "utf8")));
  if (!deck) throw new Error("deck.json 格式不对：需要 {title, slides:[{title, file}]}");

  const slides: ArtifactSlide[] = [];
  for (const [index, slide] of deck.slides.entries()) {
    if (!(await fileExists(join(directory, slide.file)))) {
      throw new Error(`deck.json 指向的 ${slide.file} 不存在。目录里有：${describe()}`);
    }
    slides.push({ index: index + 1, title: slide.title, file: slide.file });
  }

  const svgs = await Promise.all(slides.map((slide) => readFile(join(directory, slide.file), "utf8")));
  await writeFile(
    join(directory, "deck.html"),
    buildDeckHtml(
      deck.title,
      slides.map((slide, index) => ({ title: slide.title, svg: svgs[index] ?? "" })),
    ),
    "utf8",
  );
  return { entry: "deck.html", slides, durationMs: null };
}

const LIST_DEPTH = 4;

/** 列出产物文件（相对路径）。manim 会把 mp4 写到 media/videos/... 里，所以要往下找几层。 */
async function listFiles(directory: string, prefix = "", depth = 0): Promise<string[]> {
  if (depth > LIST_DEPTH) return [];
  const entries = await readdir(join(directory, prefix), { withFileTypes: true }).catch(() => []);
  const found: string[] = [];
  for (const entry of entries) {
    const relative = prefix.length > 0 ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      found.push(...(await listFiles(directory, relative, depth + 1)));
      continue;
    }
    // 输入文件与脚本不算产物。
    if (entry.name.endsWith(".md") || entry.name.endsWith(".py")) continue;
    found.push(relative);
  }
  return found.sort();
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
