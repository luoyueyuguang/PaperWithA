import { homedir } from "node:os";
import { join } from "node:path";

/**
 * XDG Base Directory paths for PaperWithA.
 *
 *   $XDG_DATA_HOME/paperwitha/   ← papers, results, index
 *   $XDG_CACHE_HOME/paperwitha/  ← subagent cached artifacts
 *   $XDG_CONFIG_HOME/paperwitha/ ← pi agent config
 */
export function paperwithaPaths(): {
  dataDir: string;
  papersDir: string;
  resultsDir: string;
  cacheDir: string;
  configDir: string;
  indexPath: string;
} {
  const xdgData = process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share");
  const xdgCache = process.env["XDG_CACHE_HOME"] ?? join(homedir(), ".cache");
  const xdgConfig = process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config");

  const dataDir = join(xdgData, "paperwitha");
  const papersDir = join(dataDir, "papers");
  const resultsDir = join(dataDir, "results");
  const cacheDir = join(xdgCache, "paperwitha");
  const configDir = join(xdgConfig, "paperwitha");
  const indexPath = join(dataDir, "index.json");

  return { dataDir, papersDir, resultsDir, cacheDir, configDir, indexPath };
}
