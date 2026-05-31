# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier ? hard cap ~30 lines.
> Overflow ? migrate into PROJECT_STATUS/archives/. Read protocol: agent-ops skill §1.

## Snapshot
- Active Phase: Backend wired ? Firebase Firestore live
- Last shipped: Full Firestore integration (firestoreService.ts), auto-seed on first load, cross-device sync confirmed working. Vendor check-in on phone updates dispatcher dashboard on PC.
- Stack: React 19 + TS (strict, ES2023), Vite 8, React Router 7, Tailwind 4, html5-qrcode 2.3.8, firebase 11.x. Deploy: GitHub Pages ? https://lgarage.github.io/stageverify
- Data: Firebase Firestore (project: stageverify-db). src/dispatcher/mockData.ts = seed source only. src/mockData.ts + src/types.ts = legacy (CheckInPage only), targeted for deletion.
- Models: src/dispatcher/models.ts (canonical). src/dispatcher/firestoreService.ts = live data layer.

## Active Blocker
None.

## Immediate Next Step
Priority 1 ? Create Delivery Workflow: add "New Delivery" button + form on dispatcher dashboard so Gavin can create a delivery before a vendor arrives. This unblocks the full lifecycle.

## Last Session (2026-05-31)
- Fixed Report Issue textarea: white-on-white text (body color cascading), added color:#111 + bg:#fff
- Added Edit Issue inline editor in drawer (Issue Summary section with Edit button)
- Added `updateIssueSummary` service method to bypass `issue?issue` transition guard
- Fixed fetchAllData missing from handleUpdateIssueSummary (main table now updates instantly)
- agent-ops skill: Playwright pre/post capture loop, stuck-subagent detection, npx-only rule

## Agent-ops reference
- Away-list tasks: `PROJECT_STATUS/away-list.json` (run status: `away-status.json`)
- Phase 2 explanation: `PROJECT_STATUS/AGENT_OPS_PHASE2.md` (cold ? read only when asked)
- Brain repo / learning status: `C:\Projects\cursor-agent-brain\STATS.md`

## Update Protocol
- Touch Snapshot / Active Blocker / Immediate Next Step at end of every session.
- "Immediate Next Step" describes what the NEXT session should do.
- Hard size cap: if total lines = 55, collapse oldest snapshot entries into archives/.
