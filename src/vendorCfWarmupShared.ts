export const VENDOR_CF_WARMUP_REARM_MS = 90_000;

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
