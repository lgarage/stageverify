# stageverify Model Dossier (local)

> **Hot tier — read index first.** Match your task to a tag; open § detail only if needed.
> Universal model wisdom: agent-ops skill §2. Outcome write-back: skill §8.
> Cold detail: `PROJECT_STATUS/archives/dossier-notes.md`

## Index

| Tag | Open when task touches… | One-line rule |
|-----|-------------------------|---------------|
| `qr-routing` | QR, scan, deep links, ESL tags | **Only** `scanRouting.ts` + `receiveQrUrls.ts` — never duplicate logic in Receive/Pickup; vendor UI is **only** `ReceivingPage` (`/#/receive`) |
| `zone-lookup` | staging code → delivery | `getDeliveryDetailsByStagingCode`; match zones via `getAllStagingLocationIds` |
| `receive-deep-link` | `/receive` URL params or camera | `deepLinkPending` before camera; failed lookup → show error (no silent empty screen) |
| `encode-qr` | building QR URLs | `buildEslTagQrUrl` + `EslQrCode` — dispatcher print = zone e-tag; `forPrint` → prod base; zone assigned → `#/r?z=` not long id |
| `html5-qr-type` | camera scanner | `Html5QrcodeInstance` from `qrScannerTypes.ts` — no `any` |
| `delivery-status` | new `DeliveryStatus` | update `RECEIVE_BLOCKED` and `ZONE_CLEARED` in same change |
| `backend-critical` | rules, CF writes, schema | archetype `backend-write-critical`; Sonnet gate before deploy |
| `billing` | model / tier pick | Composer 2.5 default; Sonnet 4.6 for gate/review only |
| `agent-lessons` | repeating mistakes, QR/hash races, "say fixed" too early | Read **§ agent-lessons** (+ Diagnose before tweak) before public routes / scan fixes |
| `scope-rejections` | portal nav, Settings vs Vendors, duplicate sidebar | **≤8 rows** in `USER_SCOPE_REJECTIONS.md` only when editing that nav |
| `composer-trace` | 2nd fix failed, “still broken”, QR/scan/async | **§ Composer without Sonnet** — self-trace before more code or Sonnet |

## § qr-routing
- Entry points: URL deep link, camera callback, manual input — all call `handleScannedQr(raw, "receive-page")`.
- **Single vendor UI:** `ReceivingPage` at `/#/receive`. Legacy `/#/`, `/#/checkin/:id`, compact `#/r?` rewrite to receive. Demo QR: `/#/demo/vendor-scan`.
- `appSettings.vendorDeliveryMode`: `exception_only` (Delivered hub) \| `full_checkin` (line-item flow, same page).
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
8. **Scope:** do not add portal pickers, cross-links, or hub buttons unless Dan asked. Check `USER_SCOPE_REJECTIONS.md` before `PortalNavBar` / `MobileHubPage` edits.
9. **Second fix failed → § Composer without Sonnet** (symptom block in reply); Sonnet is not a substitute for grep + appear/tap table on QR/async flows.
10. **Separate “shipped code” from “fixed for Dan”** — deploy + Playwright + (for public writes) rules deploy.
11. **Public vendor flows must use public-safe hydration paths.** Do not call authenticated dispatcher/admin detail readers (`getDeliveryDetails`, `fetchAll<vendors>`) after unauthenticated vendor writes. Use `getDeliveryDetailsPublic`, denormalized `delivery.vendorName` for occupancy, and `hydrateAfterVendorWrite` patterns.

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

### Session confidence — full thread (2026-06-02)

Dan should not have needed Sonnet for QR routing/perf; Composer can own those **if** it runs the self-trace protocol below instead of another tweak pass.

| Topic | What happened | Composer start | Honest conf after | Composer solo target |
|-------|----------------|----------------|-------------------|----------------------|
| Portal sidebar dead links | `#` + `preventDefault` | 90 | **92** after wire + `verify:dispatcher-nav` | **95** — good pattern |
| Deliveries sidebar duplicate | Same page as dashboard | 85 | **90** after remove (scope rejection logged) | **95** if read `USER_SCOPE_REJECTIONS` first |
| Vendors on Settings `?focus=` | Wrong IA | 80 | **88** after `/vendors` route | **90** — ask once if label = own page |
| Settings Workflow vs Staging cards | UI split | 88 | **90** | **92** T0 |
| Settings staging **edit** | View/add only → user asked edit | 85 | **TBD** until verify ships | **88** with `updateZone` + verify |
| Scope: hub Pickup/Vendor portal picker | Built without ask; user angry | 70 | **50** (trust hit) | **85** only when requested; grep `PortalNavBar` / `MobileHubPage` |
| QR iOS in-app decode | Native Camera worked, SV didn’t | 85 | **75** | **80** — symptom (a) only |
| QR yellow pill UX | iOS-style preview | 82 | **85** appearance; routing separate | **88** |
| QR pill tap / wrong route | Hash on prefetch | 82 | **45** mid-loop | **88** with appear-vs-tap **before** code |
| QR slow open | Full lookup + serial reads | 80 | **85** after audit-driven fix | **88** if Composer runs network/Firestore trace first |
| QR compact + print = e-tag | Density + unified builder | 88 | **85** encode; **not** scan fix | **90** |
| Deploy vs Firestore rules | gh-pages only | 90 | **65** when user still sees permission error | **93** when rules in same session |
| “Fixed” without device/Playwright | Repeated in QR arc | 85 | **40** when Dan says still broken | **90** only after verify or explicit symptom column |

**Billing takeaway:** Sonnet cost on this thread was mostly **diagnosis** (appear vs tap, Firestore waterfall), not implementation. Composer should do that diagnosis in-chat **before** Sonnet is invoked.

## § Composer without Sonnet (make Composer “best”)

**Goal:** Sonnet only for (1) security gate / `backend-write-critical`, (2) Composer posted a trace and is still stuck after one targeted fix.

### Before any code (session start on scan/nav/async)

1. Read `§ agent-lessons` + symptom table if task touches QR, pickup, receive, or portal.
2. State **one sentence**: what Dan asked vs what you will not add.

### On second failed fix OR “still broken” (mandatory — no exceptions)

Composer stops coding and posts this block **in the reply** (not only in docs):

```
Symptom: (a) decode | (b) slow after decode | (c) wrong route after tap
Appear: [hooks that run on decode/preview — hash? prefetch?]
Tap: [hooks on confirm — hash? navigate?]
Grep: applyHashFromScannedQr, location.hash, *DeepLink*, confirmingRef
Hypothesis: one sentence
Next change: one file/behavior only
```

Only after that: one fix + one verify script run. **Do not** call Sonnet until this block exists unless rules require security gate.

### What Dan can do (high leverage)

| You say | Composer must |
|---------|----------------|
| “Column (a)” / “won’t scan” | Camera/config only — no hash/prefetch |
| “Column (b)” / “slow loading” | Firestore trace — no pill/camera |
| “Column (c)” / “tap broken” | appear-vs-tap grep — no fps/URL density |
| “Log scope rejection: …” | Row in `USER_SCOPE_REJECTIONS.md` + remove UI same commit |
| “Still not fixed” | `confAfter` ≤ 50 in brain log; no “done” |

### Confidence logging (agent-ops)

- **confStart** = tier table default.
- **confAfter** = after verify + Dan signal; downgrade ≥15 if “still broken” without new hypothesis.
- Tag `composer-trace` when avoiding Sonnet via self-trace; `outcome: escalate` only if Sonnet ran for diagnosis.

### Rule file alignment

`composer-orchestrator.mdc`: Sonnet for QR **diagnosis** is a **failure mode** — Composer should have run § Composer without Sonnet first. Sonnet stays mandatory for rules/auth gate, not for “third camera tweak.”

## Active outcome log (≤15 rows → rotate to archives/outcomes/)
| Date | Task | Archetype | Model | Conf→ | Outcome | Note |
|------|------|-----------|-------|-------|---------|------|
| 2026-06-02 | Full thread conf + Composer-without-Sonnet protocol | composer-trace | Composer 2.5 | — | ok | § session confidence; self-trace gate |
| 2026-06-02 | QR scan circular fixes — conf scoring + Sonnet trace | qr-routing | Composer→Sonnet | 88→45→88 | partial→ok | appear≠tap; dossier § QR confidence |
| 2026-06-02 | agent-lessons + Playwright gate in rules | docs-update | Composer 2.5 | — | ok | § agent-lessons; mandatory verify before "fixed" |
| 2026-06-02 | Public pickup E2E + loadPickupReadyDeliveriesPublic | service-logic | Composer 2.5 | 93→**96** | ok | Playwright verify:pickup PASS local; prod after deploy |
| 2026-06-02 | Public pickup "Failed to record" (rules+batch) | backend-write-critical + service-logic | Composer 2.5 | 72→93 | ok | rules deployed stageverify-db |
| 2026-06-02 | Public pickup auth-only read fix (ddfa475) | service-logic | Composer 2.5 | 90→65 | partial | Code correct; rules not deployed — error persisted |
| 2026-06-02 | Pickup Done highlight + completion UX | ui-component | Composer 2.5 | 88→90 | ok | |
| 2026-06-02 | Shop Stock Pick List MVP | multi-file-feature | Composer 2.5 | 88→92 | ok | Sonnet gate fixes applied |
