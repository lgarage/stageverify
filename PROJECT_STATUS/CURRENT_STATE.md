# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> Overflow ? migrate into PROJECT_STATUS/archives/. Read protocol: agent-ops skill S1.

## Snapshot
- Active Phase: Backend wired — Firebase Firestore live + Cloud Functions active
- Last shipped: URL-aware QR scan handlers (away-010); Print Label QR button in dispatcher drawer (away-011); Hub redirect for logged-in users (away-009); maxLength fix (away-008). Full session: firestore.rules committed (not deployed). Composer 2.5 at 3/5 clean passes.
- Stack: React 19 + TS (strict, ES2023), Vite 8, React Router 7, Tailwind 4, html5-qrcode 2.3.8, firebase 11.x, firebase-functions v2, qrcode.react. Deploy: GitHub Pages - https://lgarage.github.io/stageverify
- Data: Firebase Firestore (project: stageverify-db, Blaze plan). appSettings/config holds vendorRevertWindowMinutes + autoSubmitMinutes. Canonical models in src/dispatcher/models.ts.

## Active Blocker
`firestore.rules` committed but NOT deployed: `getDeliveryDetails()` reads auth-gated collections from 4 unauthenticated routes. Fix: split into auth/unauth variants ? then `firebase deploy --only firestore:rules`. (multi-file-feature, Composer 2.5)

## Immediate Next Step
1. **Zone Management Page** (multi-file-feature, Composer 2.5) — activate /zones route, create ZoneManagementPage.tsx with zone CRUD + QR preview + Print All Labels. Schema: add eslTagId/notes/sortOrder to StagingLocation. Full spec in PROJECT_STATUS/ESL_INTEGRATION_PLAN.md Step 1.
2. **Fix getDeliveryDetails** (multi-file-feature, Composer 2.5) — split auth/unauth variants, deploy firestore.rules.
3. **Firebase Auth** — protect /dispatcher + /settings routes with login screen.
4. **ESL Cloud Function** (backend-write-critical) — BLOCKED on MinewTag API creds (waiting on vendor login for demo kit).
5. **Check-in consolidation + qtyDamaged** — App.tsx and CheckInPage.tsx parallel impls; qtyDamaged hardcoded to 0.

## Last Session (2026-06-01)
- feat: URL-aware QR scan handlers — App.tsx + ReceivingPage.tsx accept full URLs with ?id= or ?zone= params (away-010)
- feat: Print Label QR button in dispatcher delivery detail drawer, qrcode.react installed (away-011)
- feat: Hub redirect — logged-in users at / redirected to /hub (away-009)
- fix: maxLength={64} on ReceivingPage manual ID input (away-008)
- docs: security audit report written to PROJECT_STATUS/security-report-2026-06-01.md (no HIGH real risks)
- chore: Opus?Sonnet swap for trial grader and security gate verifier (cost reduction)
- plan: ESL integration design finalized — full spec in PROJECT_STATUS/ESL_INTEGRATION_PLAN.md
- trial: Composer 2.5 at 3/5 consecutive clean passes

## Prev Session (2026-06-01, earlier)
- feat: firestore.rules — Composer 2.5 Trial #3, Opus graded clean (8/8). Committed; deploy blocked. (02dbc52)
- feat: ReceivingPage at /#/receive, MobileHubPage at /#/hub, ?next= redirect. (c049b76, 3d97fb1)

## Agent-ops reference
- Away-list: PROJECT_STATUS/away-list.json | ESL plan: PROJECT_STATUS/ESL_INTEGRATION_PLAN.md
- Phase 2 explanation: PROJECT_STATUS/AGENT_OPS_PHASE2.md (cold)
- Brain repo: C:\Projects\cursor-agent-brain\STATS.md

## Update Protocol
- Touch Snapshot / Active Blocker / Immediate Next Step at end of every session.
- Hard size cap: if total lines = 55, collapse oldest entries into archives/.
