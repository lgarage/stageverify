# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> **Memory router:** `PROJECT_STATUS/MEMORY.md` — concern → file → when to read.
> **Product authority (on demand):** `PROJECT_STATUS/svscope_simple.md` — scope wins on conflict; load only for scope disputes.

## Snapshot
- **MVP: 100.00% — done** — SSOT reconciled 2026-07-16 (`MVP_PATH.md`). §14 E2E prod re-verify **PASS** away-130 (2026-07-17, post–vendor hub v0.0.44).
- Last shipped: **v0.0.167** — Compact list staging chips; Will-Call **N/A** in Staging Loc. + **Will-Call Pickup** Issue Summary (calm NAVY); drawer chips full size.
- Prior: **v0.0.166** — Deliveries list: map-matching staging chips + color legend; red staging pill; no full-row orange action rows.
- Prior: **v0.0.165** — Staging Map ready-for-pickup spots **purple** `#7c3aed` (SpotMapColor `purple`; dashboard STATUS_BADGE unchanged).
- Prior: **v0.0.163** — 2×4 print labels: gutter, QR clearance (144px), typography, asymmetric padding for code centering.
- Prior: **v0.0.162** — Batch `#/zones/print-labels`: Full page vs 2×4 toggle, print-only DOM, `LocationSignLabel2x4Sheet`.
- Prior: **v0.0.161** — Print location labels picker lists only visible Staging Map slots (D-52/D-53 SSOT); orphan Firestore zones excluded.
- Active Phase: **Location-first Phase 6 Slice C (C1 shipped)** — Slice B audit walk next.
- **Verify:** `verify:settings-office-receivers` / `:prod`; `verify:management-catch-all` / `:prod`; `verify:settings-management-pins`; `verify:pickup` / `:prod`.
- Stack: React 19 + TS, Vite 8, Firebase 11.x — https://lgarage.github.io/stageverify · Firestore `stageverify-db`

## Active Blockers
1. **Shelving decision** — layout IDs provisional (default shop layout locked for v1 map).
2. **GCP Pub/Sub push path** — optional; poll/Refresh Now proven.

## Immediate Next Step
- **Post-queue:** see `docs/project_state.md` immediate next steps.

## Queued product (deferred)
- **Phase 5 Slice B:** pickup verification v2 polish (per-location confirms, exception flags).

## Canonical references
- **Decisions:** `PROJECT_STATUS/DECISIONS.md` (+ `DECISIONS_ARCHIVE.md` when superseded)
- Handoff: `PROJECT_STATUS/archives/MINI_LIBRARIAN_HANDOFF.md` | Queue: `away-list.json` + `NEXT.md` | Validate: `npm run away:validate`

## Update Protocol
- Ship: `npm run away:ship` → `estimate-log.md` → `npm run away:validate` (auto-syncs CURRENT_STATE + Phase Tracker + roadmap from verify PASS) → commit.
