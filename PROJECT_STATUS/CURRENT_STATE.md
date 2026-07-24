# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> **Memory router:** `PROJECT_STATUS/MEMORY.md` — concern → file → when to read.
> **Product authority (on demand):** `PROJECT_STATUS/svscope_simple.md` — scope wins on conflict; load only for scope disputes.

## Snapshot
- **MVP: 100.00% — done** — SSOT reconciled 2026-07-16 (`MVP_PATH.md`). §14 E2E prod re-verify **PASS** away-130 (2026-07-17, post–vendor hub v0.0.44).
- Last shipped: **v0.0.127** — Staging Map catch-all: Edit Catch-all side panel (click overlay); designation sync for dashboard **Catch-all delivery** button; delete clears intake; edit-session overlay policy unchanged.
- Active Phase: **Location-first Phase 6 Slice C (C1 shipped)** — Slice B audit walk next.
- **Verify:** `verify:catch-all-map` / `:prod`; `verify:catch-all-delivery-notify` / `:prod`; `verify:management-catch-all` / `:prod`.
- Stack: React 19 + TS, Vite 8, Firebase 11.x — https://lgarage.github.io/stageverify · Firestore `stageverify-db`

## Active Blockers
1. **Shelving decision** — layout IDs provisional (default shop layout locked for v1 map).
2. **GCP Pub/Sub push path** — optional; poll/Refresh Now proven.

## Immediate Next Step
- **Phase 6 Slice B:** management audit walk + flag-only resolution per `docs/location-first-transition-spec.md` § Phase 6 Slice B.

## Queued product (deferred)
- **Phase 5 Slice B:** pickup verification v2 polish (per-location confirms, exception flags).
- **D-44 G5:** phone chips / persist office receiver UX (deferred).

## Canonical references
- **Decisions:** `PROJECT_STATUS/DECISIONS.md` (+ `DECISIONS_ARCHIVE.md` when superseded)
- Handoff: `PROJECT_STATUS/archives/MINI_LIBRARIAN_HANDOFF.md` | Queue: `away-list.json` + `NEXT.md` | Validate: `npm run away:validate`

## Update Protocol
- Ship: `npm run away:ship` → `estimate-log.md` → `npm run away:validate` (auto-syncs CURRENT_STATE + Phase Tracker + roadmap from verify PASS) → commit.
