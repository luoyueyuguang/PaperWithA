import { homedir } from "node:os";
import { join } from "node:path";

export const CORE_HOST = "127.0.0.1";
export const CORE_PORT = 4130;

export interface CorePaths {
  readonly dataDir: string;
  readonly papersDir: string;
  readonly textDir: string;
  readonly sessionsDir: string;
  readonly workspacesDir: string;
  readonly artifactsDir: string;
  readonly indexFile: string;
  readonly agentDir: string;
  /** 用户自定义回答风格；文件存在时追加到系统提示词。 */
  readonly styleFile: string;
}

function resolveDataHome(env: NodeJS.ProcessEnv): string {
  const xdg = env["XDG_DATA_HOME"]?.trim();
  return xdg && xdg.length > 0 ? xdg : join(homedir(), ".local", "share");
}

function resolveConfigHome(env: NodeJS.ProcessEnv): string {
  const xdg = env["XDG_CONFIG_HOME"]?.trim();
  return xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
}

export function corePaths(env: NodeJS.ProcessEnv = process.env): CorePaths {
  const dataDir = env["PAPERWITHA_DATA_DIR"]?.trim() || join(resolveDataHome(env), "paperwitha");
  return {
    dataDir,
    papersDir: join(dataDir, "papers"),
    textDir: join(dataDir, "text"),
    sessionsDir: join(dataDir, "sessions"),
    workspacesDir: join(dataDir, "workspaces"),
    artifactsDir: join(dataDir, "artifacts"),
    indexFile: join(dataDir, "index.json"),
    // 默认与用户自己的 omp 共用凭证与模型目录。
    agentDir: env["PAPERWITHA_AGENT_DIR"]?.trim() || join(homedir(), ".omp", "agent"),
    styleFile: env["PAPERWITHA_STYLE_FILE"]?.trim() || join(resolveConfigHome(env), "paperwitha", "style.md"),
  };
}

export function corePort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env["PAPERWITHA_PORT"]);
  return Number.isInteger(raw) && raw > 0 && raw < 65536 ? raw : CORE_PORT;
}
