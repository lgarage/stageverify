# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> **Memory router:** `PROJECT_STATUS/MEMORY.md` — concern → file → when to read.
> **Product authority (on demand):** `PROJECT_STATUS/svscope_simple.md` — scope wins on conflict; load only for scope disputes.

## Snapshot
- **Standing harness:** every session honors **D-47** — conf ≥ 97% before any file edit (`confidence-gate.mdc`, alwaysApply).
- **MVP: 100.00% — done** — SSOT reconciled 2026-07-16 (`MVP_PATH.md`). §14 E2E prod re-verify **PASS** away-130 (2026-07-17).
- Last shipped: **v0.0.196** — Teach-chat ignore any document type (D-58 fingerprint) + Settings Admin; ingest auto-skip (review-queue only).
- Spec: **D-59** training-note hardening — `docs/training-note-ignore-spec.md` (P1 next when building).
- **In flight (uncommitted):** job release Unassign; Will-Call shells on Deliveries board.
- Active Phase: Location-first Phase 6 Slice C (C1 shipped) — Slice B audit walk next.
- Stack: React 19 + TS, Vite 8, Firebase 11.x — https://lgarage.github.io/stageverify · `stageverify-db`

## Active Blockers
1. **Shelving decision** — layout IDs provisional (default shop layout locked for v1 map).
2. **GCP Pub/Sub push path** — optional; poll/Refresh Now proven.

## Immediate Next Step
- **Ship in flight:** unassign + will-call board visibility — verify `verify:dispatcher-job-release`, `test:invoice-shell-display`, `build:functions`; parent bumps version + deploy.

## Queued product (deferred)
- **After D-59 phases P1–P7:** **away-137** — tighten `firestore.rules` so `deliveries`/`items` are not writable by any authenticated client (dispatcher-only and/or CF-only); high-risk; blocked until training-note hardening phases complete (`docs/training-note-ignore-spec.md` §29 #9).
- **Phase 5 Slice B:** pickup verification v2 polish (per-location confirms, exception flags).

## Canonical references
- **Decisions:** `PROJECT_STATUS/DECISIONS.md` (+ `DECISIONS_ARCHIVE.md` when superseded)
- Handoff: `PROJECT_STATUS/archives/MINI_LIBRARIAN_HANDOFF.md` | Queue: `away-list.json` + `NEXT.md` | Validate: `npm run away:validate`

## Update Protocol
- Ship: `npm run away:ship` → `estimate-log.md` → `npm run away:validate` (auto-syncs CURRENT_STATE + Phase Tracker + roadmap from verify PASS) → commit.
