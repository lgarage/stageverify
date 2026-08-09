/** In-memory freshness helper for client `getAppSettings` (no Firebase imports). */

export const APP_SETTINGS_CACHE_TTL_MS = 60_000;

export function isAppSettingsCacheFresh(
  fetchedAtMs: number,
  nowMs: number,
  ttlMs: number = APP_SETTINGS_CACHE_TTL_MS,
): boolean {
  return nowMs - fetchedAtMs < ttlMs;
}
