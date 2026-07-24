import { createPlatformShell, type PlatformShell } from "@paperwitha/platform";

export const mobileCapabilities = { kind: "mobile" as const, nativeWindows: false, persistentStorage: "sqlite" as const, touchInput: true, fileImport: true };
export function createMobileShell(initial: Parameters<typeof createPlatformShell>[1]): PlatformShell {
  return createPlatformShell(mobileCapabilities, initial);
}
