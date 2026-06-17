# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> Overflow → migrate into PROJECT_STATUS/archives/. Read protocol: agent-ops skill §1.

## Snapshot
- Active Phase: **Phase 3 — Technician Pickup Workflow** (Phase 2 gate passed 2026-06-08; **Slices 1–2 shipped**; full Phase 3 gate not passed)
- Last shipped: **Trusted readiness + transactional pickup** (`b7b817f` CF/rules/frontend prod); prior: Firestore status rules `0556ae4`.
- Stack: React 19 + TS, Vite 8, Firebase 11.x, CF v2 (`createMaterialIssue` + `autoSubmitDeliveries`). Deploy: https://lgarage.github.io/stageverify
- Data: Firestore `stageverify-db`. Slice 1: `materialIssues` auth-read-only collection; public callable `createMaterialIssue` (no Firebase Auth); denormalized issue counts on deliveries.

## Active Blockers
1. **Minew ESL creds** — live ESL demo only; does not block Phase 3 Slice 1.
2. **Shelving decision (Jake Korb)** — shop map / location IDs.
3. **Physical shop map** — not created.

## Immediate Next Step
1. **Phase 3 Slices 3–6** — dispatcher scheduling/copy-pickup, vendor hardening, pickup tokens, staging release (see `roadmap.md` traceability + `svscope_simple.md`).
2. **Phase 3 remainder** — shop-stock pickup UI, expected-materials, blocking-issue alignment.
3. **Phase 4** — issue resolution UI (not started).

## Canonical references
- Product scope: `PROJECT_STATUS/svscope_simple.md` | Phase: `docs/project_state.md` | Roadmap: `docs/roadmap.md` | Warm: `MODEL_DOSSIER.md` | Away: `away-list.json`

## Update Protocol
- Phase/feature ships: update `docs/project_state.md` + `docs/roadmap.md` in same commit; sync this snapshot. Cap ~30 lines here.
