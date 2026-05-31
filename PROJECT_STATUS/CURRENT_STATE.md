# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> Overflow — migrate into PROJECT_STATUS/archives/. Read protocol: agent-ops skill S1.

## Snapshot
- Active Phase: Backend wired — Firebase Firestore live
- Last shipped: Vendor + dispatcher revert workflow. Vendor can undo submission within configurable window (default 60 min). Gavin can revert any non-terminal status anytime. Window configurable in Settings. Cloud Function (30-min auto-submit) still pending.
- Stack: React 19 + TS (strict, ES2023), Vite 8, React Router 7, Tailwind 4, html5-qrcode 2.3.8, firebase 11.x. Deploy: GitHub Pages — https://lgarage.github.io/stageverify
- Data: Firebase Firestore (project: stageverify-db). appSettings/config holds vendorRevertWindowMinutes. src/mockData.ts + src/types.ts = legacy (CheckInPage only), targeted for deletion.
- Models: src/dispatcher/models.ts (canonical). src/dispatcher/firestoreService.ts = live data layer.

## Active Blocker
None.

## Immediate Next Step
Priority 1 — Firebase Cloud Function: 30-min auto-submit timer (starts from last item checkmark / submittedAt). Requires Firebase Functions setup if not already initialized.
Priority 2 — Pickup Portal (separate lightweight route for repair tech QR scan, one-tap "picked up from G2").
Priority 3 (away-list) — Delete legacy src/mockData.ts + src/types.ts.

## Last Session (2026-05-31)
- Added "New Delivery" button + form to Dispatcher Dashboard — full delivery creation workflow live
- Designed full delivery lifecycle: revert rules, 30-min auto-submit, pickup portal spec
- Shipped vendor + dispatcher revert: revertDeliveryStatus, VENDOR/DISPATCHER_REVERT_TARGETS, submittedAt on DeliveryOrder, configurable window in Settings
- Added hard source-file edit gate to agent-ops skill (Sonnet must not edit source files directly)

## Agent-ops reference
- Away-list tasks: PROJECT_STATUS/away-list.json (run status: away-status.json)
- Phase 2 explanation: PROJECT_STATUS/AGENT_OPS_PHASE2.md (cold — read only when asked)
- Brain repo / learning status: C:\Projects\cursor-agent-brain\STATS.md

## Update Protocol
- Touch Snapshot / Active Blocker / Immediate Next Step at end of every session.
- "Immediate Next Step" describes what the NEXT session should do.
- Hard size cap: if total lines = 55, collapse oldest snapshot entries into archives/.
