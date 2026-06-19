# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> **Memory router:** `PROJECT_STATUS/MEMORY.md` — concern → file → when to read.
> **Product authority:** `PROJECT_STATUS/svscope_simple.md` — scope wins on conflict.

## Snapshot
- Active Phase: **Phase 3 — Technician Pickup Workflow** (Slices 1–6 partial + Phase 4 entry shipped; full Phase 3 gate not passed)
- Last shipped: **away-046** — Phase 3: integration verify script (chained pickup smoke)
- Stack: React 19 + TS, Vite 8, Firebase 11.x, CF v2. Deploy: https://lgarage.github.io/stageverify
- Data: Firestore `stageverify-db`.

## Active Blockers
1. **Minew ESL creds** — live ESL demo only (Phase 7).
2. **Shelving decision (Jake Korb)** — shop map / location IDs.
3. **Physical shop map** — not created.

## Immediate Next Step
- **Post-queue:** see `docs/project_state.md` immediate next steps.

## Canonical references
- Router: `PROJECT_STATUS/MEMORY.md` | Product: `svscope_simple.md` | Queue: `away-list.json` + `NEXT.md`
- Phase: `docs/project_state.md` | Roadmap: `docs/roadmap.md` | Warm: `MODEL_DOSSIER.md`
- Validate memory: `npm run away:validate` | Archive: `archives/away-batch-3.json`

## Update Protocol
- Ship away item: `npm run away:ship` → `npm run away:validate` → commit. Phase ships: sync `project_state.md` + `roadmap.md`.
