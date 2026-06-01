# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier ? hard cap ~30 lines.
> Overflow ? migrate into PROJECT_STATUS/archives/. Read protocol: agent-ops skill S1.

## Snapshot
- Active Phase: Backend wired ? Firebase Firestore live + Cloud Functions active
- Last shipped: Zone Management Page (/zones) ? CRUD, QR preview, Print All Active Labels, sidebar link activated (f769942). Composer 2.5 at 3/5 clean passes.
- Stack: React 19 + TS (strict, ES2023), Vite 8, React Router 7, Tailwind 4, html5-qrcode 2.3.8, firebase 11.x, firebase-functions v2, qrcode.react. Deploy: GitHub Pages - https://lgarage.github.io/stageverify
- Data: Firebase Firestore (project: stageverify-db, Blaze plan). appSettings/config holds vendorRevertWindowMinutes + autoSubmitMinutes + entrywayEslTagId. Canonical models in src/dispatcher/models.ts.

## Active Blockers
1. **Minew ESL creds** ? waiting on vendor login for demo kit (ESL Cloud Function blocked). See ESL_INTEGRATION_PLAN.md.
2. **Shelving decision** ? waiting on Jake Korb. Blocks: shop map, location ID assignment, tag count, tag order.
3. **Physical shop map** ? not yet created. Blocks full location ID assignment and Minew tag deployment.
See PROJECT_STATUS/PHYSICAL_DEPLOYMENT.md for full dependency chain.

## Immediate Next Step
1. **ESL Cloud Function** (backend-write-critical) ? BLOCKED on MinewTag API creds (waiting on vendor login for demo kit).
2. **Next roadmap item** ? roadmap #6 (Item Status Flow): extend delivery/item status to Ordered?Shipped?Received?Staged?Picked Up?Installed with location field.

## Last Session (2026-06-01, this session)
- feat: LocationStatus enum (Planned/Installed/Tagged/Active) replaces active boolean on StagingLocation; backward-compat parseStagingLocation helper added (4df28e5).
- ZoneManagementPage gains status dropdown in form, colored status badge on cards, and Set Active/Set Planned quick-toggle.
- firestoreService createZone now defaults to status: Planned; deactivateZone sets status: Planned.
- refactor: check-in flow consolidation ? delivery-ID QR scans in App.tsx now navigate to CheckInPage; CheckInPage gains pending?arrived transition on load (03699ec).
- fix: driver name input added to CheckInPage.tsx; qtyDamaged numeric input added to both flows (880ba2f, 1ef1a67).

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
- Hard size cap: if total lines = 55, collapse oldest entries into archives/.
