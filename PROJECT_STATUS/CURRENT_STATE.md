# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> **Memory router:** `PROJECT_STATUS/MEMORY.md` — concern → file → when to read.
> **Product authority (on demand):** `PROJECT_STATUS/svscope_simple.md` — scope wins on conflict; load only for scope disputes.

## Snapshot
- **MVP: 100.00% — done** — SSOT reconciled 2026-07-16 (`MVP_PATH.md`). §14 E2E prod re-verify **PASS** away-130 (2026-07-17, post–vendor hub v0.0.44).
- Last shipped: **v0.0.110** — per-job Released To column + drawer release panel; Settings tech permissions/PIN; CF release merge/replace + permission gates.
- Active Phase: **Location-first Phase 5 Slice A shipped** — Slice B (pickup v2 polish) next.
- **Verify:** `verify:dispatcher-job-release` / `:prod`; `verify:settings-technicians` / `:prod`; `verify:technician-door` / `:prod` after CF deploy.
- Stack: React 19 + TS, Vite 8, Firebase 11.x — https://lgarage.github.io/stageverify · Firestore `stageverify-db`

## Active Blockers
1. **Shelving decision** — layout IDs provisional (default shop layout locked for v1 map).
2. **GCP Pub/Sub push path** — optional; poll/Refresh Now proven.

## Immediate Next Step
- **Phase 5 Slice B:** pickup verification v2 (per-location confirms, exception flags) per `docs/location-first-transition-spec.md` § Phase 5.

## Queued product (deferred)
- **Phase 6 Slice A — catch-all intake + parcel ID (D-41):** office marks received from packing-slip checkmark at dispatcher-assigned catch-all spot; after Phase 5 Slice A (landed `v0.0.108`) — implement when Slice B queue clears; spec § Phase 6 Slice A.

## Canonical references
- **Decisions:** `PROJECT_STATUS/DECISIONS.md` (+ `DECISIONS_ARCHIVE.md` when superseded)
- Handoff: `PROJECT_STATUS/archives/MINI_LIBRARIAN_HANDOFF.md` | Queue: `away-list.json` + `NEXT.md` | Validate: `npm run away:validate`

## Update Protocol
- Ship: `npm run away:ship` → `estimate-log.md` → `npm run away:validate` (auto-syncs CURRENT_STATE + Phase Tracker + roadmap from verify PASS) → commit.
