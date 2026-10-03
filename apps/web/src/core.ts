import { CoreClient } from "@paperwitha/api-client";

/**
 * 同源部署（core 直接托管 web 产物，或 vite dev 走 /api 代理）时用 window.location.origin；
 * Tauri 等外壳里用 VITE_CORE_URL 指向 http://127.0.0.1:4130。
 */
export const client = new CoreClient({
  baseUrl: import.meta.env.VITE_CORE_URL ?? window.location.origin,
});

/** core 的错误响应体是 `{ error: "…" }`，api-client 把它整体作为 message 抛出，这里取出里面的文本。 */
export function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const start = raw.indexOf("{");
  if (start < 0) return raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start));
  } catch {
    return raw;
  }
  if (typeof parsed === "object" && parsed !== null && "error" in parsed && typeof parsed.error === "string") {
    return parsed.error;
  }
  return raw;
}
