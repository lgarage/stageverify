import {
  pingVendorCf,
  RESOLVE_LOCATION_SCAN_PIN_URL,
  shouldSkipVendorCfWarmup,
} from "./vendorCfWarmupShared";

let lastWarmupStartedAt = 0;

/** Fire-and-forget cold-start warmup for resolveLocationScanPin (no PIN, no session). */
export function warmupResolveLocationScanPin(): void {
  if (shouldSkipVendorCfWarmup(lastWarmupStartedAt)) return;
  lastWarmupStartedAt = Date.now();
  pingVendorCf(RESOLVE_LOCATION_SCAN_PIN_URL);
}
