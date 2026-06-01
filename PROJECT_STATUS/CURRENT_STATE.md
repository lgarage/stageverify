# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> Overflow — migrate into PROJECT_STATUS/archives/. Read protocol: agent-ops skill S1.

## Snapshot
- Active Phase: Backend wired — Firebase Firestore live + Cloud Functions active
- Last shipped: 30-min auto-submit Cloud Function (autoSubmitDeliveries, us-central1). Real-time item qty writes on vendor toggle. lastCheckmarkAt tracked per delivery. autoSubmitMinutes configurable in appSettings/config (default 30).
- Stack: React 19 + TS (strict, ES2023), Vite 8, React Router 7, Tailwind 4, html5-qrcode 2.3.8, firebase 11.x, firebase-functions v2. Deploy: GitHub Pages — https://lgarage.github.io/stageverify
- Data: Firebase Firestore (project: stageverify-db, Blaze plan). appSettings/config holds vendorRevertWindowMinutes + autoSubmitMinutes. src/mockData.ts + src/types.ts = legacy (CheckInPage only), targeted for deletion.
- Models: src/dispatcher/models.ts (canonical). src/dispatcher/firestoreService.ts = live data layer. functions/src/index.ts = Cloud Function.

## Active Blocker
None.

## Immediate Next Step
Priority 1 — Pickup Portal (separate lightweight route for repair tech QR scan, one-tap "picked up from G2").
Priority 2 (away-list) — Delete legacy src/mockData.ts + src/types.ts.

## Last Session (2026-05-31)
- Shipped vendor + dispatcher revert workflow, configurable revert window in Settings
- Shipped real-time item qty writes on vendor toggle (lastCheckmarkAt on DeliveryOrder)
- Shipped Firebase Cloud Function: autoSubmitDeliveries — scheduled every 5 min, auto-submits arrived deliveries after inactivity timeout
- Added hard source-file edit gate + status-file delegate rule to agent-ops skill

## Agent-ops reference
- Away-list tasks: PROJECT_STATUS/away-list.json (run status: away-status.json)
- Phase 2 explanation: PROJECT_STATUS/AGENT_OPS_PHASE2.md (cold — read only when asked)
- Brain repo / learning status: C:\Projects\cursor-agent-brain\STATS.md

## Update Protocol
- Touch Snapshot / Active Blocker / Immediate Next Step at end of every session.
- "Immediate Next Step" describes what the NEXT session should do.
- Hard size cap: if total lines = 55, collapse oldest snapshot entries into archives/.
