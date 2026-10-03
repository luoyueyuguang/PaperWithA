import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Artifact } from "@paperwitha/domain";
import type { CorePaths } from "../config";
import { readJsonFile, writeJsonFile } from "./json-file";

/** 每个图件一个目录：artifacts/<artifactId>/meta.json + 产物文件。 */
export class ArtifactStore {
  constructor(private readonly paths: CorePaths) {}

  directory(id: string): string {
    return join(this.paths.artifactsDir, id);
  }

  get(id: string): Promise<Artifact | null> {
    return readJsonFile<Artifact>(join(this.directory(id), "meta.json"));
  }

  async list(sessionId?: string): Promise<readonly Artifact[]> {
    const names = await readdir(this.paths.artifactsDir).catch(() => [] as string[]);
    const artifacts: Artifact[] = [];
    for (const name of names) {
      const artifact = await this.get(name);
      if (!artifact) continue;
      if (sessionId && artifact.sessionId !== sessionId) continue;
      artifacts.push(artifact);
    }
    return artifacts.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  save(artifact: Artifact): Promise<void> {
    return writeJsonFile(join(this.directory(artifact.id), "meta.json"), artifact);
  }

  async remove(id: string): Promise<void> {
    await rm(this.directory(id), { recursive: true, force: true });
  }

  async removeForSession(sessionId: string): Promise<void> {
    for (const artifact of await this.list(sessionId)) await this.remove(artifact.id);
  }

  /** core 重启会把进行中的生成留在 running，这里统一标成失败，避免 UI 一直转圈。 */
  async failInterrupted(): Promise<number> {
    let count = 0;
    for (const artifact of await this.list()) {
      if (artifact.status !== "running") continue;
      await this.save({
        ...artifact,
        status: "failed",
        error: "core 重启，生成中断",
        updatedAt: new Date().toISOString(),
      });
      count += 1;
    }
    return count;
  }
}
