# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier ? hard cap ~30 lines.
> Overflow ? migrate into PROJECT_STATUS/archives/. Read protocol: agent-ops skill S1.

## Snapshot
- Active Phase: Backend wired ? Firebase Firestore live + Cloud Functions active
- Last shipped: `ready_for_pickup` status replaces `complete` in active flow; pickup portal filter updated; fuzzy zone matching (`s2a`→`S2-A`). Commits: a0f0f9f, 66d1909.
- Stack: React 19 + TS (strict, ES2023), Vite 8, React Router 7, Tailwind 4, html5-qrcode 2.3.8, firebase 11.x, firebase-functions v2. Deploy: GitHub Pages - https://lgarage.github.io/stageverify
- Data: Firebase Firestore (project: stageverify-db, Blaze plan). appSettings/config holds vendorRevertWindowMinutes + autoSubmitMinutes. All legacy mock files deleted - canonical models in src/dispatcher/models.ts only.

## Active Blocker
None.

## Immediate Next Step
Phase 2 built — playbooks + trial ladder live in cursor-agent-brain. Test the 3 feature changes on device (ready_for_pickup, pickup portal filter, fuzzy zone match).

## Last Session (2026-06-01)
- feat: added `ready_for_pickup` status — replaces `complete` in active delivery flow; all transitions, write paths, labels, and Cloud Functions updated. Backward compat kept for existing `complete` records (a0f0f9f).
- fix: EntryDisplayPage replaceAll so `ready_for_pickup` → "READY FOR PICKUP"; CheckInPage gate blocks re-check-in on both `complete` and `ready_for_pickup` (66d1909).
- feat: pickup portal `PICKUP_READY` filter now includes `ready_for_pickup` — orders visible in pickup app after new status flow.
- feat: fuzzy zone code matching — `normalizeZoneCode` strips dashes/spaces and uppercases; `s2a` now resolves to `S2-A` in walk-up.
- Both GitHub Pages + Firebase Functions deployed.
- chore: Phase 2a playbooks scaffolding + Phase 2b trial ladder built in cursor-agent-brain (83da650). MODEL_DOSSIER backend-write-critical marked ACTIVE (1abdd9c).

## Prev Session (2026-05-31)
- Pickup portal: job-scoped checklist, per-tap writes, QR highlight, copy link, auto-submit, zone accordions, zones in URL. Commits: 6959c28, a8971e7, 1f44702, 5099198.

## Agent-ops reference
- Away-list tasks: PROJECT_STATUS/away-list.json (run status: away-status.json)
- Phase 2 explanation: PROJECT_STATUS/AGENT_OPS_PHASE2.md (cold - read only when asked)
- Brain repo / learning status: C:\Projects\cursor-agent-brain\STATS.md

## Update Protocol
- Touch Snapshot / Active Blocker / Immediate Next Step at end of every session.
- "Immediate Next Step" describes what the NEXT session should do.
- Hard size cap: if total lines = 55, collapse oldest snapshot entries into archives/.
