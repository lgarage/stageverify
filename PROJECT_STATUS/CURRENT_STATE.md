# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> Overflow → migrate into PROJECT_STATUS/archives/. Read protocol: agent-ops skill §1.
> **Product authority:** `PROJECT_STATUS/svscope_simple.md` — everything hinges on it; align all work to scope §; scope wins on conflict.

## Snapshot
- Active Phase: **Phase 3 — Technician Pickup Workflow** (Phase 2 gate passed 2026-06-08; **Slices 1–3 + remainder batch shipped**; full Phase 3 gate not passed)
- Last shipped: **away-035** — shop stock location group header; away-034 Running Low prior.
- Stack: React 19 + TS, Vite 8, Firebase 11.x, CF v2. Deploy: https://lgarage.github.io/stageverify
- Data: Firestore `stageverify-db`.

## Active Blockers
1. **Minew ESL creds** — live ESL demo only.
2. **Shelving decision (Jake Korb)** — shop map / location IDs.
3. **Physical shop map** — not created.

## Immediate Next Step
0. **Away queue:** Run `away-036`…`041` — away-035 shipped; away-028 deferred (geofence); protocol: `PROJECT_STATUS/AWAY_BUILD_PROTOCOL.md`.
1. **Blockers:** Minew ESL creds; Jake Korb shelving / shop map (combination stock §11, Slice 6 groups).
2. **Post-batch:** Phase 5 email readiness (svscope §5) — not in away queue yet.

## Canonical references
- **Product authority:** `PROJECT_STATUS/svscope_simple.md` (wins on conflict)
- Build protocol: `PROJECT_STATUS/AWAY_BUILD_PROTOCOL.md` | Away prompt: `OVERNIGHT_PROMPT.md`
- Phase: `docs/project_state.md` | Roadmap: `docs/roadmap.md` | Warm: `MODEL_DOSSIER.md` | Queue: `away-list.json`

## Update Protocol
- Phase/feature ships: update `docs/project_state.md` + `docs/roadmap.md` in same commit; sync this snapshot. Cap ~30 lines here.
