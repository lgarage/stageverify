# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> **Memory router:** `PROJECT_STATUS/MEMORY.md` — concern → file → when to read.
> **Product authority (on demand):** `PROJECT_STATUS/svscope_simple.md` — scope wins on conflict; load only for scope disputes.

## Snapshot
- **Standing harness:** every session honors **D-47** — conf ≥ 97% before any file edit (`confidence-gate.mdc`, alwaysApply).
- **MVP: 100.00% — done** — SSOT reconciled 2026-07-16 (`MVP_PATH.md`). §14 E2E prod re-verify **PASS** away-130 (2026-07-17).
- Last shipped: **v0.0.189** — Email Vendor modal prefills vendor + email from delivery
- Prior: **v0.0.188** — Will-Call drawer: BO-only Order Summary, BACKORDERED badge, View PDF
- Prior: **v0.0.187** — Drawer banner Email Vendor opens Vendor Communications modal (no mailto)
- Prior: **v0.0.186** — Drawer attention banner: Why lists missing/partial items only
- Prior: **harness** — Grok → `cursor-grok-4.5-high-fast`; D-38 medium-thinking first
- Prior: **v0.0.185** — CREDIT/return parse fix; **CF deployed** 2026-08-01
- Prior: **v0.0.181–184** — Invoice CREDIT/return manual-reject, memo parse, auto-skip repair
- Prior: **v0.0.176–179** — Invoice AI shadow, training notes, Complete filter badge
- Prior: **v0.0.170–175** — Staging map/labels, Johnstone PDF split, Complete filter
- Prior: **v0.0.161–169** — List/drawer blocking-only issues, Awaiting Delivery, vendor-comms hidden
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
