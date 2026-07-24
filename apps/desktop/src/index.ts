import { createPlatformShell, type PlatformShell } from "@paperwitha/platform";

export const desktopCapabilities = { kind: "desktop" as const, nativeWindows: true, persistentStorage: "sqlite" as const, touchInput: false, fileImport: true };
export function createDesktopShell(initial: Parameters<typeof createPlatformShell>[1]): PlatformShell {
  return createPlatformShell(desktopCapabilities, initial);
}
