import { createPlatformShell, type PlatformShell } from "@paperwitha/platform";
import { invoke } from "@tauri-apps/api/core";
import {
  AgentHost,
  createOmpRpcAdapter,
  createPiRpcAdapter,
  createOpenCodeHttpAdapter,
} from "@paperwitha/agent-runtime-node";
import { execSync } from "node:child_process";

export const desktopCapabilities = {
  kind: "desktop" as const,
  nativeWindows: true,
  persistentStorage: "sqlite" as const,
  touchInput: false,
  fileImport: true,
};

export function createDesktopShell(
  initial: Parameters<typeof createPlatformShell>[1],
): PlatformShell {
  return createPlatformShell(desktopCapabilities, initial);
}

/** Load workspace state from the app data directory. */
export async function loadDesktopWorkspace(): Promise<string> {
  try {
    return await invoke<string>("load_workspace");
  } catch {
    return "{}";
  }
}

/** Save workspace state to the app data directory. */
export async function saveDesktopWorkspace(data: string): Promise<void> {
  await invoke("save_workspace", { data });
}

/** Get the app version from Cargo.toml. */
export async function getDesktopVersion(): Promise<string> {
  return invoke<string>("get_app_version");
}

/** Check if running inside Tauri (not in a plain browser). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Describes whether a specific agent runtime is available on this desktop. */
export interface DesktopRuntimeAvailability {
  runtimeProfileId: string;
  displayName: string;
  available: boolean;
  reason?: string;
}

/** Options for creating the desktop AgentHost. */
export interface DesktopAgentHostOptions {
  ompCommand?: string;
  piCommand?: string;
  openCodeUrl?: string;
}

/**
 * Create an AgentHost pre-configured with OMP, Pi, and OpenCode adapters.
 * Only usable in a Node.js runtime (Tauri desktop, not web).
 */
export function createDesktopAgentHost(
  options: DesktopAgentHostOptions = {},
): AgentHost {
  return new AgentHost({
    adapters: [
      createOmpRpcAdapter({ command: options.ompCommand }),
      createPiRpcAdapter({ command: options.piCommand }),
      createOpenCodeHttpAdapter({ baseUrl: options.openCodeUrl }),
    ],
  });
}

/** Check which agent runtimes are available in the current environment. */
export async function getAvailableDesktopRuntimes(
  options: DesktopAgentHostOptions & { signal?: AbortSignal } = {},
): Promise<DesktopRuntimeAvailability[]> {
  const results: DesktopRuntimeAvailability[] = [];

  // OMP — check for binary on PATH
  try {
    execSync(`command -v ${options.ompCommand ?? "omp"}`, { stdio: "ignore" });
    results.push({
      runtimeProfileId: "omp-rpc",
      displayName: "OMP (RPC)",
      available: true,
    });
  } catch {
    results.push({
      runtimeProfileId: "omp-rpc",
      displayName: "OMP (RPC)",
      available: false,
      reason: `"${options.ompCommand ?? "omp"}" not found on PATH`,
    });
  }

  // Pi — check for binary on PATH
  try {
    execSync(`command -v ${options.piCommand ?? "pi"}`, { stdio: "ignore" });
    results.push({
      runtimeProfileId: "pi-rpc",
      displayName: "Pi (RPC)",
      available: true,
    });
  } catch {
    results.push({
      runtimeProfileId: "pi-rpc",
      displayName: "Pi (RPC)",
      available: false,
      reason: `"${options.piCommand ?? "pi"}" not found on PATH`,
    });
  }

  // OpenCode — HTTP health check
  const openCodeUrl = (options.openCodeUrl ?? "http://127.0.0.1:4096").replace(
    /\/$/,
    "",
  );
  try {
    const resp = await fetch(`${openCodeUrl}/health`, {
      signal: options.signal,
    });
    results.push({
      runtimeProfileId: "opencode-http",
      displayName: "OpenCode (HTTP)",
      available: resp.ok,
      reason: resp.ok ? undefined : `HTTP ${resp.status}`,
    });
  } catch (err) {
    results.push({
      runtimeProfileId: "opencode-http",
      displayName: "OpenCode (HTTP)",
      available: false,
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  return results;
}
