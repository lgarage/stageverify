# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> **Memory router:** `PROJECT_STATUS/MEMORY.md` — concern → file → when to read.
> **Product authority (on demand):** `PROJECT_STATUS/svscope_simple.md` — scope wins on conflict; load only for scope disputes.

## Snapshot
- **Standing harness:** every session honors **D-47** — conf ≥ 97% before any file edit (`confidence-gate.mdc`, alwaysApply).
- **MVP: 100.00% — done** — SSOT reconciled 2026-07-16 (`MVP_PATH.md`). §14 E2E prod re-verify **PASS** away-130 (2026-07-17).
- **Merged, not deployed:** D-59 **P1–P7** on `main` via PR #34 merge `49924c8b` (v0.0.204). Code + Sonnet/Fable gates done on branch. **Live still P1 only** until Firebase rules/functions + gh-pages + console TTL on `trainingNoteAudit.expireAt`.
- Last shipped: **v0.0.198** — D-59 P1 **LIVE** (server-echo propose/confirm + echoToken; never-unknown; credit dismiss fix; §19 training-note wording). Feature `74414db`; evidence `9002143` (D-51/CURRENT_STATE), `9d35678` (verify harness). **Prod verify:** `verify:invoice-review:prod` PASS.
- Prior: **v0.0.197** — Dispatcher Unassign (drawer + table ×); will-call shells on default Deliveries board.
- **D-59 P1 deploy:** gh-pages **built** @ `74414db` · https://lgarage.github.io/stageverify · **CF** (`proposeVendorIgnoreRule` + updated functions on `stageverify-db`) **deployed**.
- Active Phase: Location-first Phase 6 Slice C (C1 shipped) — Slice B audit walk next.
- Stack: React 19 + TS, Vite 8, Firebase 11.x — https://lgarage.github.io/stageverify · `stageverify-db`

## Active Blockers
1. **Shelving decision** — layout IDs provisional (default shop layout locked for v1 map).
2. **GCP Pub/Sub push path** — optional; poll/Refresh Now proven.

## Immediate Next Step
- **D-59 deploy (Dan approval):** `firebase deploy --only firestore:rules,functions --project stageverify-db` → enable Firestore TTL on `trainingNoteAudit.expireAt` → `npm run deploy` → manager grant / P5 migration if needed → `verify:invoice-review:prod` + `verify:invoice-training-settings:prod`. Then **away-137** unblocked for planning.

## Queued product (deferred)
- **After D-59 phases P1–P7 deploy:** **away-137** — tighten `firestore.rules` so `deliveries`/`items` are not writable by any authenticated client; high-risk; blocked until training-note hardening phases complete (`docs/training-note-ignore-spec.md` §29 #9).
- **Phase 5 Slice B:** pickup verification v2 polish (per-location confirms, exception flags).

## Canonical references
- **Decisions:** `PROJECT_STATUS/DECISIONS.md` (+ `DECISIONS_ARCHIVE.md` when superseded)
- Handoff: `PROJECT_STATUS/archives/MINI_LIBRARIAN_HANDOFF.md` | Queue: `away-list.json` + `NEXT.md` | Validate: `npm run away:validate`

## Update Protocol
- Ship: `npm run away:ship` → `estimate-log.md` → `npm run away:validate` (auto-syncs CURRENT_STATE + Phase Tracker + roadmap from verify PASS) → commit.
