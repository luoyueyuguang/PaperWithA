import { createPlatformShell, type PlatformShell } from "@paperwitha/platform";
import { invoke } from "@tauri-apps/api/core";

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
