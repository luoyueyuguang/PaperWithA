import { CoreClient } from "@paperwitha/api-client";

/** core 服务地址，可在 .env 里用 EXPO_PUBLIC_CORE_URL 覆盖。 */
export const CORE_URL = process.env.EXPO_PUBLIC_CORE_URL ?? "http://127.0.0.1:4130";

/** 全局唯一的 core 客户端；移动端直接用 RN 的全局 WebSocket。 */
export const core = new CoreClient({ baseUrl: CORE_URL });

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
