# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> Overflow — migrate into PROJECT_STATUS/archives/. Read protocol: agent-ops skill S1.

## Snapshot
- Active Phase: Backend wired — Firebase Firestore live + Cloud Functions active
- Last shipped: Pickup portal fully finished — (1) recordPickupEvent added to DispatcherDataService interface. (2) updateDeliveryStatus now accepts optional actorType; portal pickups log as "technician", dispatcher as "dispatcher". (3) Dispatcher "Mark Picked Up" shows inline name input and calls recordPickupEvent (creates real PickupEvent, not just status change). (4) "Pickup Portal" nav link in dispatcher top bar; "Tech Pickup" in vendor app footer. (5) Optional Notes textarea on portal confirm step. Commit: 6959c28.
- Stack: React 19 + TS (strict, ES2023), Vite 8, React Router 7, Tailwind 4, html5-qrcode 2.3.8, firebase 11.x, firebase-functions v2. Deploy: GitHub Pages - https://lgarage.github.io/stageverify
- Data: Firebase Firestore (project: stageverify-db, Blaze plan). appSettings/config holds vendorRevertWindowMinutes + autoSubmitMinutes. All legacy mock files deleted - canonical models in src/dispatcher/models.ts only.

## Active Blocker
None.

## Immediate Next Step
Priority 1 - Clear stagingLocationId on pickup (staging zone not freed after picked_up).
Priority 2 - Consider code-splitting to reduce 610 kB chunk (build warning, not error).

## Last Session (2026-05-31)
- Finished and wired pickup portal: interface sig, actorType fix, dispatcher pickup flow, nav links, notes field.
- npm run build passes clean. GitHub Pages deploy: Published (commit 6959c28).

## Agent-ops reference
- Away-list tasks: PROJECT_STATUS/away-list.json (run status: away-status.json)
- Phase 2 explanation: PROJECT_STATUS/AGENT_OPS_PHASE2.md (cold - read only when asked)
- Brain repo / learning status: C:\Projects\cursor-agent-brain\STATS.md

## Update Protocol
- Touch Snapshot / Active Blocker / Immediate Next Step at end of every session.
- "Immediate Next Step" describes what the NEXT session should do.
- Hard size cap: if total lines = 55, collapse oldest snapshot entries into archives/.
