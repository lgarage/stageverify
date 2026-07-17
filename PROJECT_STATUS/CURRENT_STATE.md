# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> **Memory router:** `PROJECT_STATUS/MEMORY.md` — concern → file → when to read.
> **Product authority (on demand):** `PROJECT_STATUS/svscope_simple.md` — scope wins on conflict; load only for scope disputes.

## Snapshot
- **MVP: 97.89%** — SSOT: `MVP_PATH.md`. E-tags/ESL **not in MVP scope** (D-26). §14 E2E local + prod PASS (2026-07-12); **residual band 1.71%** pending post–vendor-hub re-verify.
- Last shipped: **vendor hub fixed chrome** — top/bottom pinned, middle scrolls, svh above Safari URL bar (`v0.0.44`, `1b808e3`).
- **Harness:** D-28–D-36 **on main** (`10eb4d5`) — gate-check CI, verifier-log, solution deliberation; stale “PR pending” lines removed 2026-07-16.
- Active Phase: **Location-first Phase 4 complete** — MVP email band closed (away-128/129); **2.11%** to done.
- **Verify (2026-07-12):** mvp-core-regression, phase14-e2e, inbound-email — **re-run needed** after v0.0.44 vendor hub.
- Stack: React 19 + TS, Vite 8, Firebase 11.x — https://lgarage.github.io/stageverify · Firestore `stageverify-db` · **main `10eb4d5`**

## Active Blockers
1. **Shelving decision (Jake Korb)** — shop map / location IDs.
2. **Physical shop map** — not created (blocks sign printing only).
3. **GCP Pub/Sub push path** — optional; poll/Refresh Now proven; see `project_state.md` for push-primary.

## Immediate Next Step
- **away-130** — §14 E2E residual prod verify bundle after vendor hub v0.0.44 (`verify:mvp-core-regression:prod` + vendor-delivered + phase14-e2e).

## Canonical references
- **Decisions:** `PROJECT_STATUS/DECISIONS.md` (+ `DECISIONS_ARCHIVE.md` when superseded)
- Handoff: `PROJECT_STATUS/archives/MINI_LIBRARIAN_HANDOFF.md` | Queue: `away-list.json` + `NEXT.md` | Validate: `npm run away:validate`

## Update Protocol
- Ship: `npm run away:ship` → `estimate-log.md` → `npm run away:validate` (auto-syncs CURRENT_STATE + Phase Tracker + roadmap from verify PASS) → commit.
