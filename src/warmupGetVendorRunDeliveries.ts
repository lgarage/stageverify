import {
  GET_VENDOR_RUN_DELIVERIES_URL,
  shouldSkipVendorCfWarmup,
} from "./vendorCfWarmupShared";

const WARMUP_ABORT_MS = 8000;

let lastWarmupStartedAt = 0;

/** Fire-and-forget cold-start warmup for getVendorRunDeliveries (no PIN, no session). */
export function warmupGetVendorRunDeliveries(): void {
  if (shouldSkipVendorCfWarmup(lastWarmupStartedAt)) return;
  lastWarmupStartedAt = Date.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), WARMUP_ABORT_MS);

  void fetch(GET_VENDOR_RUN_DELIVERIES_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: {} }),
    signal: controller.signal,
  })
    .catch(() => {})
    .finally(() => clearTimeout(timeoutId));
}
