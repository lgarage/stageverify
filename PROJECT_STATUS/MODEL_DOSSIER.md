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
| `encode-qr` | building QR URLs | `buildEslTagQrUrl` + `EslQrCode` — dispatcher print = zone e-tag; `forPrint` → prod base; zone assigned → `#/r?z=` not long id |
| `html5-qr-type` | camera scanner | `Html5QrcodeInstance` from `qrScannerTypes.ts` — no `any` |
| `delivery-status` | new `DeliveryStatus` | update `RECEIVE_BLOCKED` and `ZONE_CLEARED` in same change |
| `backend-critical` | rules, CF writes, schema | archetype `backend-write-critical`; Sonnet gate before deploy |
| `billing` | model / tier pick | Composer 2.5 default; Sonnet 4.6 for gate/review only |
| `agent-lessons` | repeating mistakes, QR/hash races, "say fixed" too early | Read **§ agent-lessons** (+ Diagnose before tweak) before public routes / scan fixes |
| `scope-rejections` | portal nav, Settings vs Vendors, duplicate sidebar | **≤8 rows** in `USER_SCOPE_REJECTIONS.md` only when editing that nav |

## § qr-routing
- Entry points: URL deep link, camera callback, manual input — all call `handleScannedQr(raw, target)`.
- Targets: `"receive-page"` \| `"checkin-page"` \| `"app-checkin"`.
- Zone tags + dispatcher print: `buildEslTagQrUrl` / `buildZoneEslQrUrl` — compact `#/p?` / `#/r?i=` / `#/r?z=` by status.

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

## § agent-lessons (2026-06-02 — pickup portal arc)

Hard-won mistakes — **read before declaring UI/Firestore work done.**

1. **Do not say "fixed" without Playwright.** Build alone is insufficient. Interactive flows need `scripts/verify-*.mjs` (clicks + assert end state). Pickup: `npm run verify:pickup` then `:prod` after deploy.
2. **`npm run deploy` ≠ Firestore rules.** gh-pages ships the SPA only. Public technician writes need `firebase deploy --only firestore:rules --project stageverify-db` in the **same session** as the code change.
3. **Public routes must not call auth-only reads.** `listDeliveries()` loads `jobs` → empty or throws when logged out. Pickup uses `loadPickupReadyDeliveriesPublic()`. Any new public page: audit for `getDeliveryDetails`, `listDeliveries`, `fetchAll<Job>`.
4. **`recordPickupEvent` / technician writes:** use delivery doc + batch write; never reload `getDeliveryDetails` after commit on technician path (permission denied for unauth).
5. **Logged-in browser ≠ Playwright.** Dan may see data while headless test sees empty list — always verify unauthenticated or with the verify script.
6. **Confidence downgrade when user still sees the bug.** Code-only fix that doesn't deploy rules or pass E2E → lower conf, do not mark ok until Playwright + user path green.
7. **Auto-submit and Done must share the same gates** (shop stock + staged item checklists) — any second code path bypassing a gate will reproduce the bug.

### Diagnose before tweak (2026-06-02 QR)

Map **appear** vs **tap** before camera/fps tweaks (Sonnet postmortem on double-navigation):

| Phase | Hooks | Hash / routing |
|-------|--------|----------------|
| Appear (preview) | `onQrPreview`, `startScanPrefetch` | **None** — prefetch read-only |
| Tap (confirm) | `confirmPreview`, `onDecode`, `handleQrFromCamera` | `applyHashFromScannedQr`, `scanRouting`, deep-link `useEffect` |

**Grep preview path only:** `applyHashFromScannedQr`, `location.hash`, `useSearchParams`, `urlDeepLinkHandledRef`, `confirmingRef`, `resetFlow` (must clear deep-link ref).

**Rule:** prefetch = read-only; navigation/hash only on confirm.

**One acceptance test first:** scan → yellow pill → tap → single correct route (no flash/wrong portal).

**Sonnet-style trace when:** 2+ failed fixes on same bug, or preview + async prefetch + hash/deep-link in one flow.

### QR confidence scoring (2026-06-02 — Dan + Sonnet arc)

Composer **over-scored** several QR passes; user still saw bugs until Sonnet traced appear vs tap and Firestore serial reads.

| Archetype / symptom | Start conf (Composer) | After user still broken | After Sonnet + fix shipped | Composer solo? |
|---------------------|----------------------|-------------------------|----------------------------|----------------|
| `encode-qr` (shorter URL, level M) | 88 | **70** if claimed “scan fixed” | **85** encode only; **not** a scan-reliability fix | Yes |
| `qr-scan-ios` (html5-qrcode won’t read) | 85 | **60** after fps/region-only tweaks | **75** with `qrScannerConfig` + pill UX; native Camera may still win on ESL | Yes, escalate if 2nd fail |
| `qr-preview-pill` + routing (pill tap / wrong route) | 82 | **45** (hash changed on **appear**, not tap) | **88** after `80c1815` (hash only on confirm) | **No** — needed Sonnet trace |
| `qr-perf` (“Loading delivery…”) | 80 | **55** while still full lookup + serial `getDoc` | **85** after parallel hydrate + zone skip re-read (`36c5b2e`) | Sonnet audit → Composer impl OK |
| Dispatcher print ≠ e-tag QR | 75 | N/A (scope miss) | **80** after `buildEslTagQrUrl` unify (`f41edf8`) | Yes |

**Rules for next QR session**

1. **Triage three symptoms first** (write one line each): (a) won’t decode, (b) slow after decode, (c) wrong portal/route after tap. Do not mix fixes across columns.
2. **Second failed fix on same symptom → stop tweaking camera/URL**; run appear vs tap table (above) or Task Sonnet 4.6 trace-only (no code until root cause named).
3. **Do not log `confAfter` ≥ 90** on QR until Playwright or Dan confirms pill → tap → single navigation on **occupied** zone (e.g. G2), not empty G1.
4. **Compact QR** = module density only; never substitute for routing/prefetch bugs.

**How agents get better here:** one row in this table when QR ships; grep `applyHashFromScannedQr` before any prefetch change; reuse `verify:pickup` / add route-specific verify; downgrade conf in brain `outcomes/*.jsonl` when Dan says “still not fixed” (see pickup `90→65` pattern).

## Active outcome log (≤15 rows → rotate to archives/outcomes/)
| Date | Task | Archetype | Model | Conf→ | Outcome | Note |
|------|------|-----------|-------|-------|---------|------|
| 2026-06-02 | QR scan circular fixes — conf scoring + Sonnet trace | qr-routing | Composer→Sonnet | 88→45→88 | partial→ok | appear≠tap; dossier § QR confidence |
| 2026-06-02 | agent-lessons + Playwright gate in rules | docs-update | Composer 2.5 | — | ok | § agent-lessons; mandatory verify before "fixed" |
| 2026-06-02 | Public pickup E2E + loadPickupReadyDeliveriesPublic | service-logic | Composer 2.5 | 93→**96** | ok | Playwright verify:pickup PASS local; prod after deploy |
| 2026-06-02 | Public pickup "Failed to record" (rules+batch) | backend-write-critical + service-logic | Composer 2.5 | 72→93 | ok | rules deployed stageverify-db |
| 2026-06-02 | Public pickup auth-only read fix (ddfa475) | service-logic | Composer 2.5 | 90→65 | partial | Code correct; rules not deployed — error persisted |
| 2026-06-02 | Pickup Done highlight + completion UX | ui-component | Composer 2.5 | 88→90 | ok | |
| 2026-06-02 | Shop Stock Pick List MVP | multi-file-feature | Composer 2.5 | 88→92 | ok | Sonnet gate fixes applied |
