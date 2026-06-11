# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> Overflow → migrate into PROJECT_STATUS/archives/. Read protocol: agent-ops skill §1.

## Snapshot
- Active Phase: **Phase 3 — Technician Pickup Workflow** (Phase 2 gate passed 2026-06-08; **Slices 1–2 shipped**; full Phase 3 gate not passed)
- Last shipped: Restyled vendor receive portal (match pickup portal style) (Jun 11). M1 vendor revert hydration — `revertDeliveryStatus` uses `hydrateAfterVendorWrite` (Jun 8). Vendor public-path fix (Jun 8). Vendor PIN gate (Jun 8).
- Stack: React 19 + TS, Vite 8, Firebase 11.x, CF v2 (`createMaterialIssue` + `autoSubmitDeliveries`). Deploy: https://lgarage.github.io/stageverify
- Data: Firestore `stageverify-db`. Slice 1: `materialIssues` auth-read-only collection; public callable `createMaterialIssue` (no Firebase Auth); denormalized issue counts on deliveries.

## Active Blockers
1. **Minew ESL creds** — live ESL demo only; does not block Phase 3 Slice 1.
2. **Shelving decision (Jake Korb)** — shop map / location IDs.
3. **Physical shop map** — not created.

## Immediate Next Step
1. **Phase 3 remaining** — ready-only queue, shop-stock pull states, expected-materials UI (see `docs/roadmap.md`).
2. **Vendor E2E** — `/#/demo/vendor-scan` (PIN `1234`); **Pickup demo** — `/#/demo/pickup-scan` (ORD-004 / job-3).
3. **Phase 4** — issue resolution UI (not started).

## Canonical references
- Phase: `docs/project_state.md` | Roadmap: `docs/roadmap.md` | Warm: `MODEL_DOSSIER.md` | Away: `away-list.json`

## Update Protocol
- Phase/feature ships: update `docs/project_state.md` + `docs/roadmap.md` in same commit; sync this snapshot. Cap ~30 lines here.
