# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> Overflow → migrate into PROJECT_STATUS/archives/. Read protocol: agent-ops skill §1.

## Snapshot
- Active Phase: **Phase 3 — Technician Pickup Workflow** (Phase 2 gate passed 2026-06-08; **Slices 1–3 shipped**; full Phase 3 gate not passed)
- Last shipped: **Slice 3 complete** — job/PO/delivery readiness breakdown, Pickup Scheduled, Copy Pickup Information, ready-only queue (`faaed82`); CF blocking-issue pickup (`away-009`).
- Stack: React 19 + TS, Vite 8, Firebase 11.x, CF v2. Deploy: https://lgarage.github.io/stageverify
- Data: Firestore `stageverify-db`.

## Active Blockers
1. **Minew ESL creds** — live ESL demo only.
2. **Shelving decision (Jake Korb)** — shop map / location IDs.
3. **Physical shop map** — not created.

## Immediate Next Step
0. **Overnight queue:** Run `away-015`…`020` — see `PROJECT_STATUS/OVERNIGHT_PROMPT.md` (verify-before-next, halt on fail).
1. **Phase 3 Slices 4–5** — vendor sessions, pickup tokens (after remainder batch).
2. **Phase 4** — material issue resolution UI (not started).

## Canonical references
- Product scope: `PROJECT_STATUS/svscope_simple.md` | Phase: `docs/project_state.md` | Roadmap: `docs/roadmap.md` | Warm: `MODEL_DOSSIER.md` | Away: `away-list.json`

## Update Protocol
- Phase/feature ships: update `docs/project_state.md` + `docs/roadmap.md` in same commit; sync this snapshot. Cap ~30 lines here.
