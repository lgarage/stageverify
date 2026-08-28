export const VENDOR_CF_WARMUP_REARM_MS = 90_000;

export const VENDOR_CF_WARMUP_ABORT_MS = 8000;

export const VENDOR_LOGIN_CF_KEEPALIVE_MS = 1500;

export const RESOLVE_LOCATION_SCAN_PIN_URL =
  "https://us-central1-stageverify-db.cloudfunctions.net/resolveLocationScanPin";

export const GET_VENDOR_RUN_DELIVERIES_URL =
  "https://us-central1-stageverify-db.cloudfunctions.net/getVendorRunDeliveries";

declare global {
  interface Window {
    /** Set by index.html inline warmup on `#/s` door routes. */
    __svVendorCfWarmupAt?: number;
  }
}

/** HTML inline warmup timestamp counts as last start when still inside the re-arm window. */
export function getEffectiveVendorCfWarmupStart(moduleLastStartedAt: number): number {
  const htmlAt =
    typeof window !== "undefined" ? window.__svVendorCfWarmupAt : undefined;
  if (
    htmlAt != null &&
    Date.now() - htmlAt < VENDOR_CF_WARMUP_REARM_MS
  ) {
    return Math.max(moduleLastStartedAt, htmlAt);
  }
  return moduleLastStartedAt;
}

export function shouldSkipVendorCfWarmup(moduleLastStartedAt: number): boolean {
  const effective = getEffectiveVendorCfWarmupStart(moduleLastStartedAt);
  return Date.now() - effective < VENDOR_CF_WARMUP_REARM_MS;
}

/** Completed tracked ping below this → instance warm; abort overlap on stop(). */
const KEEPALIVE_WARM_DURATION_MS = 400;

const keepaliveInFlight = new Set<AbortController>();

/** Most recent completed `{ trackForKeepalive: true }` ping duration (page session). */
let lastCompletedKeepaliveDurationMs: number | null = null;

/** Fire-and-forget empty POST warmup (no PIN, no session). Ignores re-arm skip. */
export function pingVendorCf(
  url: string,
  options?: { trackForKeepalive?: boolean },
): void {
  const controller = new AbortController();
  const track = options?.trackForKeepalive === true;
  const startedAt = track ? Date.now() : 0;
  if (track) {
    keepaliveInFlight.add(controller);
  }
  const timeoutId = setTimeout(
    () => controller.abort(),
    VENDOR_CF_WARMUP_ABORT_MS,
  );

  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: {} }),
    signal: controller.signal,
  })
    .catch(() => {})
    .finally(() => {
      clearTimeout(timeoutId);
      if (track) {
        lastCompletedKeepaliveDurationMs = Date.now() - startedAt;
        keepaliveInFlight.delete(controller);
      }
    });
}

function abortKeepaliveInFlight(): void {
  for (const controller of keepaliveInFlight) {
    controller.abort();
  }
  keepaliveInFlight.clear();
}

/** Abort overlap only when a tracked ping already proved the instance is warm. */
function stopKeepalivePings(intervalId: ReturnType<typeof setInterval>): void {
  clearInterval(intervalId);
  if (
    lastCompletedKeepaliveDurationMs != null &&
    lastCompletedKeepaliveDurationMs < KEEPALIVE_WARM_DURATION_MS
  ) {
    abortKeepaliveInFlight();
  }
}

/** Ping both vendor login CFs immediately (no re-arm skip). */
export function pingVendorLoginCloudFunctions(): void {
  pingVendorCf(RESOLVE_LOCATION_SCAN_PIN_URL, { trackForKeepalive: true });
  pingVendorCf(GET_VENDOR_RUN_DELIVERIES_URL, { trackForKeepalive: true });
}

/**
 * Overlapping keep-alive pings while the vendor PIN keypad is visible.
 * Returns stop(); pings ignore shouldSkipVendorCfWarmup.
 */
export function startVendorLoginCfKeepalive(): () => void {
  pingVendorLoginCloudFunctions();
  const intervalId = setInterval(
    pingVendorLoginCloudFunctions,
    VENDOR_LOGIN_CF_KEEPALIVE_MS,
  );
  return () => stopKeepalivePings(intervalId);
}
