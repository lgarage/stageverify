# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> Overflow → migrate into PROJECT_STATUS/archives/. Read protocol: agent-ops skill §1.

## Snapshot
- Active Phase: Create Delivery Workflow
- Last shipped: Create Delivery modal with line items in dispatcher dashboard (commit 3925b48)
- Stack: React 19 + TS (strict, ES2023), Vite 8, React Router 7, Tailwind 4 (CSS-first, no config), html5-qrcode 2.3.8. Deploy: GitHub Pages (gh-pages) → https://lgarage.github.io/stageverify
- Data: in-memory mocks (src/mockData.ts, src/dispatcher/mockData.ts). Backend: NONE yet (Firebase/Supabase under consideration).
- Models: src/dispatcher/models.ts (canonical). src/types.ts = legacy, targeted for deletion.

## Active Blocker
None.

## Immediate Next Step
Fix PO Number persistence in CreateDeliveryModal — form collects it but doesn't push a PurchaseOrder record, so PO # column is blank for new deliveries. Or move to Priority 2: Vendor Check-In Integration.

## Agent-ops reference
- Away-list tasks: `PROJECT_STATUS/away-list.json` (run status: `away-status.json`)
- Phase 2 explanation: `PROJECT_STATUS/AGENT_OPS_PHASE2.md` (cold — read only when asked)
- Brain repo / learning status: `C:\Projects\cursor-agent-brain\STATS.md`

## Update Protocol
- Touch Snapshot / Active Blocker / Immediate Next Step at end of every session.
- "Immediate Next Step" describes what the NEXT session should do.
- Hard size cap: if total lines ≥ 55, collapse oldest snapshot entries into archives/.
