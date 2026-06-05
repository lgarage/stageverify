# Session log archive — June 2026

> Migrated from `PROJECT_STATUS/CURRENT_STATE.md` during Phase 1 memory cleanup (2026-06-04).
> Hot-tier session log lives in CURRENT_STATE only for the current session; older entries land here.

## Last Session (2026-06-02, this session)
- fix: Settings staging spots inline edit (same Edit/Save/Cancel as Vendors table).
## Prev Session (2026-06-02, this session)
- fix: Settings — Vendor auto-save label; staging spots Edit column (deployed gh-pages).
## Prev Session (2026-06-02, this session)
- fix: dispatcher Print Label uses same `buildEslTagQrUrl` as zone e-tags (zone spot → short `#/r?z=` / status routing); shared `EslQrCode` component; print always prod URL.
## Prev Session (2026-06-02, this session)
- feat: compact zone/label QR URLs (#/r?i=, #/r?z=, #/p?j=&d=); legacy long URLs + SV:z: tokens still scan; QR render level M + quiet margin.
## Prev Session (2026-06-02, this session)
- perf: faster QR open job — parallel Firestore hydrate, zone path skips re-read delivery doc, 60s scan lookup cache (Sonnet audit).
## Prev Session (2026-06-02, this session)
- docs: QR scan diagnose playbook in MODEL_DOSSIER § agent-lessons (appear/tap table, hash grep, prefetch rule).
- fix: QR/status-only portals — no pickup↔vendor tabs or cross-redirects; zone tag URL follows job status; removed iPhone scan auto-zoom (preview pill kept).
## Prev Session (2026-06-02, this session)
- fix: iPhone in-app QR scan — BarcodeDetector, larger scan region, full-bleed video.
## Prev Session (2026-06-02, this session)
- feat: iOS-style QR URL preview pill on mobile scanners (pickup/receive/vendor check-in); loose staging zone code match (s1a/S1-A).
## Prev Session (2026-06-02, this session)
- feat: separate `/vendors` page from Settings; shared PortalSidebar; verify:dispatcher-nav PASS.
## Prev Session (2026-06-02, this session)
- fix: remove redundant Deliveries sidebar tab (same view as Dispatcher Dashboard).
## Prev Session (2026-06-02, this session)
- chore: ship-loop.mdc — mandatory commit/push/deploy after substantive changes; aligns cleanup + model-audit rules.
## Prev Session (2026-06-02, this session)
- fix: dispatcher portal sidebar — Deliveries/Vendors/Staging Map navigate (shared nav + focus scroll); verify:dispatcher-nav PASS.
## Prev Session (2026-06-02, this session)
- fix: portal shell — sidebar + top bar fixed; only main content scrolls (dispatcher/settings/zones); verify:portal-layout.
- chore: post-change model audit rule; Settings staging spots show full already-listed summary.
## Prev Session (2026-06-02, this session)
- feat: staging zone occupancy guard — block two active deliveries on same spot (service + UI).
- fix: vendor portal loads Ordered deliveries (vendor actorType + public job/PO read); verify:vendor-demo PASS.
- feat: PortalNavBar — Pickup Portal + Vendor Portal side-by-side on hub, pickup/receive pages, dispatcher, App scanner footer.
## Prev Session (2026-06-02, this session)
- feat: Vendor check-in UI restyled like pickup portal; Adjust button + partial order badges; verify:receive Playwright script.
## Prev Session (2026-06-02, this session)
- fix: pickup portal recordPickupEvent single batch; firestore.rules shipped/installed + deployed to stageverify-db; clearer permission errors.
## Prev Session (2026-06-02)
- fix: recordPickupEvent uses public delivery read only; technician status update skips auth-only reload (pickup portal Done error).
## Prev Session (2026-06-02)
- feat: Pickup portal Done button glows when staged + shop stock checked; Done records pickup; success screen "All Items Picked Up!".
## Prev Session (2026-06-02)
- fix: Pickup portal — uncheck staged/shop-stock lines; order/vendor/PO/staging visible on job load (removed collapse).
## Prev Session (2026-06-02)
- feat: Shop Stock Pick List — `shopStockPickListItems` + location note on delivery; dispatcher drawer editor; pickup portal "Additional Shop Stock" checkboxes + completion gate (incl. auto-submit); Sonnet review fixes.
## Prev Session (2026-06-02, earlier)
- feat: Status-aware zone QR routing — `getDeliveryDetailsByStagingCode`, `buildZoneEslQrUrl` pickup URLs, receive/pickup redirects; Sonnet review fixes (camera pickup scan, secondary zones, dossier gotcha).
## Prev Session (2026-06-01, this session)
- feat: Need More Space? tiered flow — Tier 1 shows closest shelf + ground cards (vendor picks); Tier 2 offers closest 4–10 oversized spot; widthFt/depthFt on StagingLocation; Zone form gains dimension inputs (1b3f8e3, bad8f07, 2a3d82c).
- feat: Shipped/Installed delivery statuses; DELIVERY_STATUS_LABEL map; Mark Shipped + Mark Installed buttons; locationId? on Item (22e5415). Roadmap #6 complete.
- feat: LocationStatus enum replaces active boolean; ZoneManagementPage badges + toggle (4df28e5). Roadmap #5 complete.
- refactor: check-in flow consolidation; driver name + qtyDamaged inputs (03699ec, 880ba2f, 1ef1a67).
## Prev Session (2026-06-01)
- feat: Zone Management Page — /zones route, ZoneManagementPage.tsx, zone CRUD, grouped cards, QR preview, Print All Active Labels, StagingLocation schema (eslTagId/notes/sortOrder), sidebar link activated (f769942)
- feat: URL-aware QR scan handlers — App.tsx + ReceivingPage.tsx accept full URLs with ?id= or ?zone= params (away-010)
- feat: Print Label QR button in dispatcher delivery detail drawer, qrcode.react installed (away-011)
- feat: Hub redirect — logged-in users at / redirected to /hub (away-009)
- fix: maxLength={64} on ReceivingPage manual ID input (away-008)
- docs: security audit report written to PROJECT_STATUS/security-report-2026-06-01.md (no HIGH real risks)
- chore: Opus→Sonnet swap for trial grader and security gate verifier (cost reduction)
- plan: ESL integration design finalized — full spec in PROJECT_STATUS/ESL_INTEGRATION_PLAN.md
- trial: Composer 2.5 at 3/5 consecutive clean passes

## Prev Session (2026-06-01, earlier)
- feat: firestore.rules — Composer 2.5 Trial #3, graded clean. Committed; deploy blocked. (02dbc52)
- feat: ReceivingPage at /#/receive, MobileHubPage at /#/hub, ?next= redirect. (c049b76, 3d97fb1)
