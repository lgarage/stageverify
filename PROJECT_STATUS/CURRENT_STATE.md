# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> Overflow ? migrate into PROJECT_STATUS/archives/. Read protocol: agent-ops skill S1.

## Snapshot
- Active Phase: Backend wired — Firebase Firestore live + Cloud Functions active
- Last shipped: (1) Deleted legacy src/mockData.ts, src/types.ts, src/dispatcher/mockData.ts, src/dispatcher/mockService.ts — all imports rerouted to Firestore. (2) Pickup Portal confirm screen now has a "Your name" input; recordPickupEvent() receives real tech name instead of hardcoded "Tech".
- Stack: React 19 + TS (strict, ES2023), Vite 8, React Router 7, Tailwind 4, html5-qrcode 2.3.8, firebase 11.x, firebase-functions v2. Deploy: GitHub Pages ? https://lgarage.github.io/stageverify
- Data: Firebase Firestore (project: stageverify-db, Blaze plan). appSettings/config holds vendorRevertWindowMinutes + autoSubmitMinutes. All legacy mock files deleted — canonical models in src/dispatcher/models.ts only.

## Active Blocker
None.

## Immediate Next Step
Priority 1 — Connect Create Delivery to Firestore: CreateDeliveryModal still references seeded/static data in some paths; verify createDelivery() is fully wired and dispatchers can create real records end-to-end.
Priority 2 — Consolidate Vendor Check-In Flow: CheckInPage.tsx updated to use Firestore (done in cleanup pass) — verify routing in App.tsx/main.tsx is consistent and legacy routes are gone.

## Last Session (2026-05-31)
- Deleted src/mockData.ts, src/types.ts, src/dispatcher/mockData.ts, src/dispatcher/mockService.ts (commits 706f00b, 1f69fd4).
- CheckInPage, SettingsPage, CreateDeliveryModal rerouted to firestoreService.
- Added "Your name" input to Pickup Portal confirm screen; confirm button disabled when empty.
- Both commits pushed to main; GitHub Pages deploy confirmed Published.

## Agent-ops reference
- Away-list tasks: PROJECT_STATUS/away-list.json (run status: away-status.json)
- Phase 2 explanation: PROJECT_STATUS/AGENT_OPS_PHASE2.md (cold — read only when asked)
- Brain repo / learning status: C:\Projects\cursor-agent-brain\STATS.md

## Update Protocol
- Touch Snapshot / Active Blocker / Immediate Next Step at end of every session.
- "Immediate Next Step" describes what the NEXT session should do.
- Hard size cap: if total lines = 55, collapse oldest snapshot entries into archives/.
