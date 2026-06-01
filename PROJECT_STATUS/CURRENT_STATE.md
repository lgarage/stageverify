# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier ? hard cap ~30 lines.
> Overflow ? migrate into PROJECT_STATUS/archives/. Read protocol: agent-ops skill S1.

## Snapshot
- Active Phase: Backend wired ? Firebase Firestore live + Cloud Functions active
- Last shipped: (1) Deleted legacy src/mockData.ts, src/types.ts, src/dispatcher/mockData.ts, src/dispatcher/mockService.ts ? all imports rerouted to Firestore. (2) Pickup Portal confirm screen now has a "Your name" input; recordPickupEvent() receives real tech name instead of hardcoded "Tech".
- Stack: React 19 + TS (strict, ES2023), Vite 8, React Router 7, Tailwind 4, html5-qrcode 2.3.8, firebase 11.x, firebase-functions v2. Deploy: GitHub Pages ? https://lgarage.github.io/stageverify
- Data: Firebase Firestore (project: stageverify-db, Blaze plan). appSettings/config holds vendorRevertWindowMinutes + autoSubmitMinutes. All legacy mock files deleted ? canonical models in src/dispatcher/models.ts only.

## Active Blocker
None.

## Immediate Next Step
Priority 1 ? Consider code-splitting to reduce 610 kB chunk (build warning, not error).
Priority 2 ? Monitor Firestore usage and optimize queries if needed.

## Last Session (2026-05-31)
- Audited and cleaned up routing in `src/main.tsx` and `src/App.tsx`.
- Removed legacy `mockDispatcherDataService` alias in `src/DispatcherDashboardPage.tsx`.
- Reordered routes in `src/main.tsx` to prevent conflicts (specific routes before `/`).
- Verified `CheckInPage.tsx` is correctly wired to Firestore.
- npm run build passes clean. GitHub Pages deploy: Published.
- Audited CreateDeliveryModal ? already fully wired to Firestore, no mock data, no hardcoded IDs.

## Agent-ops reference
- Away-list tasks: PROJECT_STATUS/away-list.json (run status: away-status.json)
- Phase 2 explanation: PROJECT_STATUS/AGENT_OPS_PHASE2.md (cold ? read only when asked)
- Brain repo / learning status: C:\Projects\cursor-agent-brain\STATS.md

## Update Protocol
- Touch Snapshot / Active Blocker / Immediate Next Step at end of every session.
- "Immediate Next Step" describes what the NEXT session should do.
- Hard size cap: if total lines = 55, collapse oldest snapshot entries into archives/.
