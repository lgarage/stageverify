const RESOLVE_LOCATION_SCAN_PIN_URL =
  "https://us-central1-stageverify-db.cloudfunctions.net/resolveLocationScanPin";

const WARMUP_ABORT_MS = 8000;

let warmupStarted = false;

/** Fire-and-forget cold-start warmup for resolveLocationScanPin (no PIN, no session). */
export function warmupResolveLocationScanPin(): void {
  if (warmupStarted) return;
  warmupStarted = true;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), WARMUP_ABORT_MS);

  void fetch(RESOLVE_LOCATION_SCAN_PIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: {} }),
    signal: controller.signal,
  })
    .catch(() => {})
    .finally(() => clearTimeout(timeoutId));
}
