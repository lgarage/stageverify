# stageverify Model Dossier (local)

> **Hot tier — read index first.** Match your task to a tag; open § detail only if needed.
> Universal model wisdom: agent-ops skill §2. Outcome write-back: skill §8.
> Cold detail: `PROJECT_STATUS/archives/dossier-notes.md`

## Index

| Tag | Open when task touches… | One-line rule |
|-----|-------------------------|---------------|
| `qr-routing` | QR, scan, deep links, ESL tags | **Only** `scanRouting.ts` + `receiveQrUrls.ts` — never duplicate logic in App/Receive/Pickup |
| `zone-lookup` | staging code → delivery | `getDeliveryDetailsByStagingCode`; match zones via `getAllStagingLocationIds` |
| `receive-deep-link` | `/receive` URL params or camera | `deepLinkPending` before camera; failed lookup → show error (no silent empty screen) |
| `encode-qr` | building QR URLs | `receiveQrUrls.ts`; always `encodeURIComponent` on params |
| `html5-qr-type` | camera scanner | `Html5QrcodeInstance` from `qrScannerTypes.ts` — no `any` |
| `delivery-status` | new `DeliveryStatus` | update `RECEIVE_BLOCKED` and `ZONE_CLEARED` in same change |
| `backend-critical` | rules, CF writes, schema | archetype `backend-write-critical`; Sonnet gate before deploy |
| `billing` | model / tier pick | Composer 2.5 default; Sonnet 4.6 for gate/review only |

## § qr-routing
- Entry points: URL deep link, camera callback, manual input — all call `handleScannedQr(raw, target)`.
- Targets: `"receive-page"` \| `"checkin-page"` \| `"app-checkin"`.
- Zone tags: `buildZoneEslQrUrl` — pickup-ready → `#/pickup?job=`, vendor flow → `#/receive?id=`, empty → `#/receive?zone=`.

## § zone-lookup
- QR routing: `getDeliveryDetailsByStagingCode` (includes pickup-ready).
- Receive-only (exclude blocked): `getDeliveryDetailsPublicByStagingCode`.
- Occupancy map: `mapActiveZoneOccupancyByCode`.

## § billing
- Composer 2.5 = orchestrator + default worker (included quota).
- Sonnet 4.6 = security gate + authority review only (on-demand cost).
- **Public Firestore writes:** code fix + `firebase deploy --only firestore:rules` in the same session — `npm run deploy` (gh-pages) does not ship rules.

## § backend-critical
- Trial: Composer implements; Sonnet grades. 3/5 clean passes.
- Mandatory Sonnet gate after rules/CF/schema **and** multi-file route/Firestore read changes.

## Active outcome log (≤15 rows → rotate to archives/outcomes/)
| Date | Task | Archetype | Model | Conf→ | Outcome | Note |
|------|------|-----------|-------|-------|---------|------|
| 2026-06-02 | Public pickup "Failed to record" (rules+batch) | backend-write-critical + service-logic | Composer 2.5 | 72→**93** | ok* | *User verify pending; rules deployed to stageverify-db |
| 2026-06-02 | Public pickup auth-only read fix (ddfa475) | service-logic | Composer 2.5 | 90→65 | partial | Code correct; rules not deployed — error persisted |
| 2026-06-02 | Pickup Done highlight + completion UX | ui-component | Composer 2.5 | 88→90 | ok | |
| 2026-06-02 | Shop Stock Pick List MVP | multi-file-feature | Composer 2.5 | 88→92 | ok | Sonnet gate fixes applied |
