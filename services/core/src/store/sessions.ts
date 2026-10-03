import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ChatSession } from "@paperwitha/domain";
import type { CorePaths } from "../config";
import { readJsonFile, writeJsonFile } from "./json-file";

export class SessionStore {
  constructor(private readonly paths: CorePaths) {}

  async list(paperId?: string): Promise<readonly ChatSession[]> {
    const sessions = await this.readAll();
    const filtered = paperId ? sessions.filter((session) => session.paperId === paperId) : sessions;
    return filtered.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  get(id: string): Promise<ChatSession | null> {
    return readJsonFile<ChatSession>(this.path(id));
  }

  save(session: ChatSession): Promise<void> {
    return writeJsonFile(this.path(session.id), session);
  }

  async remove(id: string): Promise<void> {
    await rm(this.path(id), { force: true });
  }

  async removeForPaper(paperId: string): Promise<void> {
    for (const session of await this.list(paperId)) await this.remove(session.id);
  }

  private path(id: string): string {
    return join(this.paths.sessionsDir, `${id}.json`);
  }

  private async readAll(): Promise<ChatSession[]> {
    const names = await readdir(this.paths.sessionsDir).catch(() => [] as string[]);
    const sessions: ChatSession[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const session = await readJsonFile<ChatSession>(join(this.paths.sessionsDir, name));
      if (session && typeof session.id === "string") sessions.push(session);
    }
    return sessions;
  }
}
