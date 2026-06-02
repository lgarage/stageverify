# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier ? hard cap ~30 lines.
> Overflow ? migrate into PROJECT_STATUS/archives/. Read protocol: agent-ops skill S1.

## Snapshot
- Active Phase: MVP complete ? full delivery lifecycle live (Ordered?Shipped?Received?Staged?Picked Up?Installed)
- Last shipped: public pickup batch write + Firestore rules deployed (shipped/installed statuses).
- Stack: React 19 + TS (strict, ES2023), Vite 8, React Router 7, Tailwind 4, html5-qrcode 2.3.8, firebase 11.x, firebase-functions v2, qrcode.react. Deploy: GitHub Pages - https://lgarage.github.io/stageverify
- Data: Firebase Firestore (project: stageverify-db, Blaze plan). appSettings/config holds vendorRevertWindowMinutes + autoSubmitMinutes + entrywayEslTagId. Canonical models in src/dispatcher/models.ts.

## Active Blockers
1. **Minew ESL creds** ? waiting on vendor login for demo kit (ESL Cloud Function blocked). See ESL_INTEGRATION_PLAN.md.
2. **Shelving decision** ? waiting on Jake Korb. Blocks: shop map, location ID assignment, tag count, tag order.
3. **Physical shop map** ? not yet created. Blocks full location ID assignment and Minew tag deployment.
See PROJECT_STATUS/PHYSICAL_DEPLOYMENT.md for full dependency chain.

## Immediate Next Step
1. **ESL Cloud Function** (backend-write-critical) ??? BLOCKED on MinewTag API creds (waiting on vendor login for demo kit).
2. **MVP complete.** All roadmap items shipped. Next: security audit (away-007) when ready, or ESL integration once Minew creds arrive.
## Last Session (2026-06-02, this session)
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
- feat: staging zone occupancy guard ? block two active deliveries on same spot (service + UI).
- fix: vendor portal loads Ordered deliveries (vendor actorType + public job/PO read); verify:vendor-demo PASS.
- feat: PortalNavBar ? Pickup Portal + Vendor Portal side-by-side on hub, pickup/receive pages, dispatcher, App scanner footer.
## Prev Session (2026-06-02, this session)
- feat: Vendor check-in UI restyled like pickup portal; Adjust button + partial order badges; verify:receive Playwright script.
## Prev Session (2026-06-02, this session)
- fix: pickup portal recordPickupEvent single batch; firestore.rules shipped/installed + deployed to stageverify-db; clearer permission errors.
## Prev Session (2026-06-02)
- fix: recordPickupEvent uses public delivery read only; technician status update skips auth-only reload (pickup portal Done error).
## Prev Session (2026-06-02)
- feat: Pickup portal Done button glows when staged + shop stock checked; Done records pickup; success screen "All Items Picked Up!".
## Prev Session (2026-06-02)
- fix: Pickup portal ? uncheck staged/shop-stock lines; order/vendor/PO/staging visible on job load (removed collapse).
## Prev Session (2026-06-02)
- feat: Shop Stock Pick List ? `shopStockPickListItems` + location note on delivery; dispatcher drawer editor; pickup portal "Additional Shop Stock" checkboxes + completion gate (incl. auto-submit); Sonnet review fixes.
## Prev Session (2026-06-02, earlier)
- feat: Status-aware zone QR routing ? `getDeliveryDetailsByStagingCode`, `buildZoneEslQrUrl` pickup URLs, receive/pickup redirects; Sonnet review fixes (camera pickup scan, secondary zones, dossier gotcha).
## Prev Session (2026-06-01, this session)
- feat: Need More Space? tiered flow ? Tier 1 shows closest shelf + ground cards (vendor picks); Tier 2 offers closest 4?10 oversized spot; widthFt/depthFt on StagingLocation; Zone form gains dimension inputs (1b3f8e3, bad8f07, 2a3d82c).
- feat: Shipped/Installed delivery statuses; DELIVERY_STATUS_LABEL map; Mark Shipped + Mark Installed buttons; locationId? on Item (22e5415). Roadmap #6 complete.
- feat: LocationStatus enum replaces active boolean; ZoneManagementPage badges + toggle (4df28e5). Roadmap #5 complete.
- refactor: check-in flow consolidation; driver name + qtyDamaged inputs (03699ec, 880ba2f, 1ef1a67).
## Prev Session (2026-06-01)
- feat: Zone Management Page ? /zones route, ZoneManagementPage.tsx, zone CRUD, grouped cards, QR preview, Print All Active Labels, StagingLocation schema (eslTagId/notes/sortOrder), sidebar link activated (f769942)
- feat: URL-aware QR scan handlers ? App.tsx + ReceivingPage.tsx accept full URLs with ?id= or ?zone= params (away-010)
- feat: Print Label QR button in dispatcher delivery detail drawer, qrcode.react installed (away-011)
- feat: Hub redirect ? logged-in users at / redirected to /hub (away-009)
- fix: maxLength={64} on ReceivingPage manual ID input (away-008)
- docs: security audit report written to PROJECT_STATUS/security-report-2026-06-01.md (no HIGH real risks)
- chore: Opus->Sonnet swap for trial grader and security gate verifier (cost reduction)
- plan: ESL integration design finalized ? full spec in PROJECT_STATUS/ESL_INTEGRATION_PLAN.md
- trial: Composer 2.5 at 3/5 consecutive clean passes

## Prev Session (2026-06-01, earlier)
- feat: firestore.rules ? Composer 2.5 Trial #3, graded clean. Committed; deploy blocked. (02dbc52)
- feat: ReceivingPage at /#/receive, MobileHubPage at /#/hub, ?next= redirect. (c049b76, 3d97fb1)

## Agent-ops reference
- Away-list: PROJECT_STATUS/away-list.json | ESL plan: PROJECT_STATUS/ESL_INTEGRATION_PLAN.md
- Phase 2 explanation: PROJECT_STATUS/AGENT_OPS_PHASE2.md (cold)
- Brain repo: C:\Projects\cursor-agent-brain\STATS.md

## Update Protocol
- Touch Snapshot / Active Blocker / Immediate Next Step at end of every session.
- **Also update `roadmap.md`** when any roadmap item ships: mark Done in the table + add a "What's Built" bullet. Do this in the same commit as CURRENT_STATE.md ? never leave them out of sync.
- Hard size cap: if total lines = 55, collapse oldest entries into archives/.

