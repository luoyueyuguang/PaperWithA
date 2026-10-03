import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { titleFromFileName, type PaperPage, type PaperSummary, type PaperText } from "@paperwitha/domain";
import type { CorePaths } from "../config";
import { extractPages } from "../ingest";
import { readJsonFile, writeJsonFile } from "./json-file";

interface PaperIndexFile {
  papers: PaperSummary[];
}

function hashOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export class PaperStore {
  private constructor(
    private readonly paths: CorePaths,
    private readonly index: PaperSummary[],
  ) {}

  /** 读取索引，并与 papers 目录对齐：目录里多出来的补进索引，文件丢失的删掉。 */
  static async open(paths: CorePaths): Promise<PaperStore> {
    await mkdir(paths.papersDir, { recursive: true });
    await mkdir(paths.textDir, { recursive: true });
    const stored = (await readJsonFile<PaperIndexFile>(paths.indexFile))?.papers ?? [];
    const store = new PaperStore(paths, stored.filter((paper) => typeof paper?.id === "string"));
    const changed = await store.reconcile();
    if (changed) await store.persist();
    return store;
  }

  list(): readonly PaperSummary[] {
    return [...this.index].sort((left, right) => right.addedAt.localeCompare(left.addedAt));
  }

  get(id: string): PaperSummary | undefined {
    return this.index.find((paper) => paper.id === id);
  }

  async add(fileName: string, bytes: Uint8Array): Promise<PaperSummary> {
    const id = hashOf(bytes).slice(0, 12);
    const existing = this.get(id);
    if (existing) return existing;

    const storedName = `${id}-${fileName}`;
    await writeFile(join(this.paths.papersDir, storedName), bytes);
    const pages = await extractPages(fileName, bytes);
    await this.writeText(id, pages);

    const summary: PaperSummary = {
      id,
      title: titleFromFileName(fileName),
      fileName,
      storedName,
      size: bytes.byteLength,
      pageCount: pages.length,
      addedAt: new Date().toISOString(),
    };
    this.index.push(summary);
    await this.persist();
    return summary;
  }

  async remove(id: string): Promise<boolean> {
    const paper = this.get(id);
    if (!paper) return false;
    await rm(join(this.paths.papersDir, paper.storedName), { force: true });
    await rm(this.textPath(id), { force: true });
    this.index.splice(this.index.indexOf(paper), 1);
    await this.persist();
    return true;
  }

  filePath(id: string): string | null {
    const paper = this.get(id);
    return paper ? join(this.paths.papersDir, paper.storedName) : null;
  }

  async readBytes(id: string): Promise<Uint8Array | null> {
    const path = this.filePath(id);
    if (!path) return null;
    try {
      return await readFile(path);
    } catch {
      return null;
    }
  }

  /** 文本缺失时按需抽取，并回填页数。 */
  async getText(id: string): Promise<PaperText | null> {
    const paper = this.get(id);
    if (!paper) return null;
    const cached = await readJsonFile<PaperText>(this.textPath(id));
    if (cached) return cached;

    const bytes = await this.readBytes(id);
    if (!bytes) return null;
    const pages = await extractPages(paper.fileName, bytes);
    await this.writeText(id, pages);
    if (paper.pageCount !== pages.length) {
      const next = { ...paper, pageCount: pages.length };
      this.index[this.index.indexOf(paper)] = next;
      await this.persist();
    }
    return { paperId: id, pages };
  }

  private textPath(id: string): string {
    return join(this.paths.textDir, `${id}.json`);
  }

  private writeText(id: string, pages: readonly PaperPage[]): Promise<void> {
    return writeJsonFile(this.textPath(id), { paperId: id, pages } satisfies PaperText);
  }

  private async reconcile(): Promise<boolean> {
    const names = await readdir(this.paths.papersDir).catch(() => [] as string[]);
    const onDisk = names.filter((name) => !name.startsWith("."));
    const known = new Set(this.index.map((paper) => paper.storedName));
    let changed = false;

    for (const name of onDisk) {
      if (known.has(name)) continue;
      const info = await stat(join(this.paths.papersDir, name));
      if (!info.isFile()) continue;
      const bytes = await readFile(join(this.paths.papersDir, name));
      const id = hashOf(bytes).slice(0, 12);
      if (this.get(id)) continue;
      this.index.push({
        id,
        title: titleFromFileName(name.replace(/^[0-9a-f]{12}-/, "")),
        fileName: name.replace(/^[0-9a-f]{12}-/, ""),
        storedName: name,
        size: info.size,
        pageCount: 0,
        addedAt: info.mtime.toISOString(),
      });
      changed = true;
    }

    const present = new Set(onDisk);
    const missing = this.index.filter((paper) => !present.has(paper.storedName));
    if (missing.length > 0) {
      for (const paper of missing) this.index.splice(this.index.indexOf(paper), 1);
      changed = true;
    }
    return changed;
  }

  private persist(): Promise<void> {
    return writeJsonFile(this.paths.indexFile, { papers: this.index } satisfies PaperIndexFile);
  }
}
