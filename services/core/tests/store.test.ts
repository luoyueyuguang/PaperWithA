import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { corePaths, type CorePaths } from "../src/config";
import { PaperStore } from "../src/store/papers";
import { SessionStore } from "../src/store/sessions";
import { createChatSession, appendChatMessage } from "@paperwitha/domain";

const SAMPLE = "Attention Is All You Need\n\n自注意力把序列中任意两个位置直接连起来。\n".repeat(4);

let dataDir: string;
let paths: CorePaths;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "pwa-store-"));
  paths = corePaths({ ...process.env, PAPERWITHA_DATA_DIR: dataDir });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("PaperStore", () => {
  it("stores bytes, extracts text and indexes the paper", async () => {
    const store = await PaperStore.open(paths);
    const summary = await store.add("attention.txt", new TextEncoder().encode(SAMPLE));

    expect(summary.title).toBe("attention");
    expect(summary.pageCount).toBe(1);
    expect(store.list()).toHaveLength(1);

    const text = await store.getText(summary.id);
    expect(text?.pages[0]?.text).toContain("自注意力把序列中任意两个位置直接连起来。");

    const index = JSON.parse(await readFile(paths.indexFile, "utf8")) as { papers: unknown[] };
    expect(index.papers).toHaveLength(1);
  });

  it("returns the existing entry for identical content", async () => {
    const store = await PaperStore.open(paths);
    const first = await store.add("a.txt", new TextEncoder().encode(SAMPLE));
    const second = await store.add("b.txt", new TextEncoder().encode(SAMPLE));
    expect(second.id).toBe(first.id);
    expect(store.list()).toHaveLength(1);
  });

  it("picks up files dropped into the papers directory and extracts text on demand", async () => {
    await mkdir(paths.papersDir, { recursive: true });
    await writeFile(join(paths.papersDir, "dropped.txt"), "落进目录的论文。");
    const store = await PaperStore.open(paths);

    const [summary] = store.list();
    expect(summary?.title).toBe("dropped");
    expect(summary?.pageCount).toBe(0);

    const text = await store.getText(summary!.id);
    expect(text?.pages[0]?.text).toBe("落进目录的论文。");
    expect(store.get(summary!.id)?.pageCount).toBe(1);
  });

  it("drops index entries whose file disappeared", async () => {
    const store = await PaperStore.open(paths);
    const summary = await store.add("gone.txt", new TextEncoder().encode(SAMPLE));
    await rm(join(paths.papersDir, summary.storedName));

    const reopened = await PaperStore.open(paths);
    expect(reopened.list()).toHaveLength(0);
  });

  it("removes the file and the cached text", async () => {
    const store = await PaperStore.open(paths);
    const summary = await store.add("bye.txt", new TextEncoder().encode(SAMPLE));

    await expect(store.remove(summary.id)).resolves.toBe(true);
    expect(store.list()).toHaveLength(0);
    await expect(store.remove(summary.id)).resolves.toBe(false);
    expect(await store.getText(summary.id)).toBeNull();
  });
});

describe("SessionStore", () => {
  it("round-trips sessions and filters by paper", async () => {
    const store = new SessionStore(paths);
    const first = appendChatMessage(createChatSession({ id: "s1", paperId: "p1", title: "一", now: "2026-10-03T00:00:00.000Z" }), {
      id: "m1",
      role: "user",
      text: "问题",
      createdAt: "2026-10-03T00:00:01.000Z",
      citations: [],
    });
    const second = createChatSession({ id: "s2", paperId: "p2", title: "二", now: "2026-10-03T00:00:02.000Z" });
    await store.save(first);
    await store.save(second);

    expect((await store.list()).map((session) => session.id)).toEqual(["s2", "s1"]);
    expect((await store.list("p1")).map((session) => session.id)).toEqual(["s1"]);
    expect((await store.get("s1"))?.messages[0]?.text).toBe("问题");

    await store.removeForPaper("p1");
    expect(await store.get("s1")).toBeNull();
    expect(await store.get("s2")).not.toBeNull();
  });
});
