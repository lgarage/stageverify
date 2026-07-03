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
