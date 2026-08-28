import {
  GET_VENDOR_RUN_DELIVERIES_URL,
  pingVendorCf,
  shouldSkipVendorCfWarmup,
} from "./vendorCfWarmupShared";

let lastWarmupStartedAt = 0;

/** Fire-and-forget cold-start warmup for getVendorRunDeliveries (no PIN, no session). */
export function warmupGetVendorRunDeliveries(): void {
  if (shouldSkipVendorCfWarmup(lastWarmupStartedAt)) return;
  lastWarmupStartedAt = Date.now();
  pingVendorCf(GET_VENDOR_RUN_DELIVERIES_URL);
}
