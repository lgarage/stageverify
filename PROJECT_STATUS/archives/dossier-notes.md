# Dossier archive (cold — read only when index points here)

Rotated from MODEL_DOSSIER.md quality bar. Not loaded at session start.

## qr-routing (2026-06-02)
- Sonnet audit: ReceivingPage camera missed pickup URLs that deep links handled — root cause was duplicated logic across App/Receive/Pickup.
- Fix: centralize in `src/scanRouting.ts` (`handleScannedQr`, `syncScanIntent`, `resolveZoneScanDisposition`).

## zone-lookup (2026-06-02)
- Never inline `listDeliveries` + `stagingLocationCode` string match.
- Pickup check-off must use `getAllStagingLocationIds`, not primary `stagingLocation` only.

## receive-deep-link (legacy)
- `hasReceiveDeepLink` / `deepLinkPending` / `urlDeepLinkHandledRef` before starting camera on `/receive`.

## misc (rotated)
- **no-duplicate-collection-reads** — pass preloaded `stagingLocations` on zone page when scaling.
- **fn-name-must-match-behavior** — `deactivateZone` sets Planned; rename if behavior changes.
