# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> Overflow → migrate into PROJECT_STATUS/archives/. Read protocol: agent-ops skill §1.
> **Product authority:** `PROJECT_STATUS/svscope_simple.md` — everything hinges on it; align all work to scope §; scope wins on conflict.

## Snapshot
- Active Phase: **Phase 3 — Technician Pickup Workflow** (Phase 2 gate passed 2026-06-08; **Slices 1–6 partial + Phase 4 entry shipped** via away-021…041; full Phase 3 gate not passed)
- Last shipped: **away-041** — batch 3 close (away-034…040: Running Low, shop stock groups, combination staging, pickup summary, issue resolve).
- Stack: React 19 + TS, Vite 8, Firebase 11.x, CF v2. Deploy: https://lgarage.github.io/stageverify
- Data: Firestore `stageverify-db`.

## Active Blockers
1. **Minew ESL creds** — live ESL demo only.
2. **Shelving decision (Jake Korb)** — shop map / location IDs.
3. **Physical shop map** — not created.

## Immediate Next Step
0. **Post-batch:** Phase 5 email readiness (svscope §5) — not in away queue yet. Blockers: Minew ESL creds; Jake Korb shelving / shop map.

## Canonical references
- **Product authority:** `PROJECT_STATUS/svscope_simple.md` (wins on conflict)
- **ACES builder (prototype, SV-first):** `aecs/README.md` — product work wins; do not let ACES refactors block SV shipping
- Phase: `docs/project_state.md` | Roadmap: `docs/roadmap.md` | Warm: `MODEL_DOSSIER.md` | Queue: `away-list.json`

## Update Protocol
- Phase/feature ships: update `docs/project_state.md` + `docs/roadmap.md` in same commit; sync this snapshot. Cap ~30 lines here.
