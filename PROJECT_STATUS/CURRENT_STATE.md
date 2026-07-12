# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier ? hard cap ~30 lines.
> **Memory router:** `PROJECT_STATUS/MEMORY.md` ? concern ? file ? when to read.
> **Product authority (on demand):** `PROJECT_STATUS/svscope_simple.md` ? scope wins on conflict; load only for scope disputes.

## Snapshot
- **MVP: 97.89%** ? SSOT: `MVP_PATH.md`. E-tags/ESL **not in MVP scope** (D-26). �14 E2E **local + prod PASS**; **live email ingest prod proof** away-129 (**2** inbound in Needs Review; Gmail connected).
- Last shipped: **vendor delivered hub UX** — stay on hub with ✓ Delivered; no Deliver Another (`v0.0.41`)
- Active Phase: **Location-first Phase 4 complete** ? MVP email band closed; **2.11%** remaining (�14 E2E residual **1.71%**).
- **Verify:** `verify:mvp-core-regression:prod` PASS 2026-07-12; `audit:needs-review-ui:prod` PASS; `verify:email-oauth-connect:prod` PASS; `verify:inbound-email-ingest` PASS.
- Stack: React 19 + TS, Vite 8, Firebase 11.x ? https://lgarage.github.io/stageverify � Firestore `stageverify-db`

## Active Blockers
1. **Shelving decision (Jake Korb)** ? shop map / location IDs.
2. **Physical shop map** ? not created (blocks sign printing only).
3. **GCP Pub/Sub push path** ? optional for automated push; poll/Refresh Now path proven; configure Pub/Sub per `project_state.md` for push-primary ingest.

## Immediate Next Step
- **Post-queue:** see `docs/project_state.md` immediate next steps.

## Canonical references
- **Decisions:** `PROJECT_STATUS/DECISIONS.md` (+ `DECISIONS_ARCHIVE.md` when superseded)
- Handoff: `PROJECT_STATUS/archives/MINI_LIBRARIAN_HANDOFF.md` | Queue: `away-list.json` + `NEXT.md` | Validate: `npm run away:validate`

## Update Protocol
- Ship: `npm run away:ship` ? `estimate-log.md` ? `npm run away:validate` (auto-syncs CURRENT_STATE + Phase Tracker + roadmap from verify PASS) ? commit.

