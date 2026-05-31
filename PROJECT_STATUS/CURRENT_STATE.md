# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> Overflow ? migrate into PROJECT_STATUS/archives/. Read protocol: agent-ops skill §1.

## Snapshot
- Active Phase: Vendor Check-In Integration (Priority 2)
- Last shipped: Vendor check-in + Entry Display Board wired to dispatcher mock data
  - App.tsx: QR scan ? driver name ? item verify ? submit now updates dispatcher arrays
  - submitCheckin() added to DispatcherDataService interface + MockDispatcherDataService
  - EntryDisplayPage now reads from dispatcher/mockData (DeliveryStatus colors, 30s poll)
- Stack: React 19 + TS (strict, ES2023), Vite 8, React Router 7, Tailwind 4 (CSS-first, no config), html5-qrcode 2.3.8. Deploy: GitHub Pages (gh-pages) ? https://lgarage.github.io/stageverify
- Data: in-memory mocks (src/dispatcher/mockData.ts canonical). src/mockData.ts = legacy (still used by CheckInPage.tsx). Backend: NONE yet.
- Models: src/dispatcher/models.ts (canonical). src/types.ts = legacy, targeted for deletion.

## Active Blocker
None.

## Immediate Next Step
Priority 2 frontend wiring complete. Next: Priority 1 — Create Delivery Workflow (New Delivery button + form on dispatcher dashboard). This unblocks the full lifecycle.

## Agent-ops reference
- Away-list tasks: `PROJECT_STATUS/away-list.json` (run status: `away-status.json`)
- Phase 2 explanation: `PROJECT_STATUS/AGENT_OPS_PHASE2.md` (cold — read only when asked)
- Brain repo / learning status: `C:\Projects\cursor-agent-brain\STATS.md`

## Update Protocol
- Touch Snapshot / Active Blocker / Immediate Next Step at end of every session.
- "Immediate Next Step" describes what the NEXT session should do.
- Hard size cap: if total lines = 55, collapse oldest snapshot entries into archives/.
