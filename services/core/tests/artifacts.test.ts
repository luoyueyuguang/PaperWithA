import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Artifact } from "@paperwitha/domain";
import { corePaths, type CorePaths } from "../src/config";
import { parseDeckManifest, parseFramesManifest } from "../src/manifests";
import { buildDeckHtml } from "../src/render";
import { ArtifactStore } from "../src/store/artifacts";

describe("parseFramesManifest", () => {
  it("accepts a well-formed manifest and clamps frame durations", () => {
    const manifest = parseFramesManifest({
      width: 1280,
      height: 720,
      fps: 30,
      frames: [
        { file: "frames/f01.svg", durationMs: 900 },
        { file: "frames/f02.svg", durationMs: 999_999 },
      ],
    });
    expect(manifest).toEqual({
      width: 1280,
      height: 720,
      fps: 30,
      frames: [
        { file: "frames/f01.svg", durationMs: 900 },
        { file: "frames/f02.svg", durationMs: 20_000 },
      ],
    });
  });

  it("fills in defaults for missing dimensions", () => {
    const manifest = parseFramesManifest({ frames: [{ file: "a.svg" }] });
    expect(manifest).toEqual({ width: 1280, height: 720, fps: 30, frames: [{ file: "a.svg", durationMs: 1000 }] });
  });

  it("rejects empty, oversized or path-traversing frame lists", () => {
    expect(parseFramesManifest({ frames: [] })).toBeNull();
    expect(parseFramesManifest({ frames: "nope" })).toBeNull();
    expect(parseFramesManifest({ frames: [{ file: "../../etc/passwd" }] })).toBeNull();
    expect(parseFramesManifest({ frames: [{ file: "/etc/passwd" }] })).toBeNull();
    expect(parseFramesManifest({ frames: Array.from({ length: 241 }, () => ({ file: "a.svg" })) })).toBeNull();
  });
});

describe("parseDeckManifest", () => {
  it("keeps titles and files in order", () => {
    expect(parseDeckManifest({ title: "论文速览", slides: [{ title: "开头", file: "slides/01.svg" }, { file: "slides/02.svg" }] }))
      .toEqual({
        title: "论文速览",
        slides: [
          { title: "开头", file: "slides/01.svg" },
          { title: "第 2 页", file: "slides/02.svg" },
        ],
      });
  });

  it("rejects manifests without usable slides", () => {
    expect(parseDeckManifest({ slides: [] })).toBeNull();
    expect(parseDeckManifest({ slides: [{ file: "../x.svg" }] })).toBeNull();
    expect(parseDeckManifest(null)).toBeNull();
  });
});

describe("buildDeckHtml", () => {
  it("inlines every slide with its page number and escapes titles", () => {
    const html = buildDeckHtml("A & B", [
      { title: "第一页", svg: '<svg viewBox="0 0 1280 720"></svg>' },
      { title: "第二页", svg: '<svg viewBox="0 0 1280 720"></svg>' },
    ]);
    expect(html).toContain("<title>A &amp; B</title>");
    expect(html).toContain("1 / 2 · 第一页");
    expect(html).toContain("2 / 2 · 第二页");
    expect(html.match(/<svg/g)).toHaveLength(2);
    expect(html).not.toContain("<script");
  });
});

function sampleArtifact(id: string, sessionId: string, status: Artifact["status"]): Artifact {
  return {
    id,
    sessionId,
    messageId: null,
    kind: "diagram",
    title: "图解 · 测试",
    status,
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z",
    error: null,
    entry: null,
    slides: [],
    durationMs: null,
  };
}

describe("ArtifactStore", () => {
  let dataDir: string;
  let paths: CorePaths;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pwa-artifacts-"));
    paths = corePaths({ ...process.env, PAPERWITHA_DATA_DIR: dataDir });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("filters by session and fails runs interrupted by a restart", async () => {
    const store = new ArtifactStore(paths);
    await store.save(sampleArtifact("a", "s1", "running"));
    await store.save(sampleArtifact("b", "s1", "ready"));
    await store.save(sampleArtifact("c", "s2", "running"));

    expect((await store.list("s1")).map((artifact) => artifact.id)).toEqual(["a", "b"]);
    expect(await store.failInterrupted()).toBe(2);

    const failed = await store.get("a");
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toBe("core 重启，生成中断");
    expect((await store.get("b"))?.status).toBe("ready");
    expect(await store.failInterrupted()).toBe(0);
  });

  it("removes every artifact of a session", async () => {
    const store = new ArtifactStore(paths);
    await store.save(sampleArtifact("a", "s1", "ready"));
    await store.save(sampleArtifact("b", "s2", "ready"));

    await store.removeForSession("s1");
    expect(await store.get("a")).toBeNull();
    expect(await store.get("b")).not.toBeNull();
  });
});
