const GET_VENDOR_RUN_DELIVERIES_URL =
  "https://us-central1-stageverify-db.cloudfunctions.net/getVendorRunDeliveries";

const WARMUP_ABORT_MS = 8000;
const WARMUP_REARM_MS = 90_000;

let lastWarmupStartedAt = 0;

/** Fire-and-forget cold-start warmup for getVendorRunDeliveries (no PIN, no session). */
export function warmupGetVendorRunDeliveries(): void {
  const now = Date.now();
  if (now - lastWarmupStartedAt < WARMUP_REARM_MS) return;
  lastWarmupStartedAt = now;

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
