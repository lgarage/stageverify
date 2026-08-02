# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> **Memory router:** `PROJECT_STATUS/MEMORY.md` — concern → file → when to read.
> **Product authority (on demand):** `PROJECT_STATUS/svscope_simple.md` — scope wins on conflict; load only for scope disputes.

## Snapshot
- **Standing harness:** every session honors **D-47** — conf ≥ 97% before any file edit (`confidence-gate.mdc`, alwaysApply).
- **MVP: 100.00% — done** — SSOT reconciled 2026-07-16 (`MVP_PATH.md`). §14 E2E prod re-verify **PASS** away-130 (2026-07-17).
- Last shipped: **v0.0.189** — Email Vendor modal prefills vendor + email from delivery
- **In flight [fast-safe]:** **v0.0.190** dual theme (dark default + StageVerify light + BR toggle) on branch `theme/dual-mode-modernize` — UI-only; no `functions/**`. Agree: Critical Reviewer `bed28ac3-62ca-46ac-94b5-972d91f24207`. Local verify: `build` + `verify:dispatcher-nav` + `verify:pickup` + `verify:settings-technicians` PASS; receive D-42 PASS (script exit hang).
- Prior: **v0.0.188** — Will-Call drawer: BO-only Order Summary, BACKORDERED badge, View PDF
- Prior: **harness** — Grok → `cursor-grok-4.5-high-fast`; D-38 medium-thinking first
- Active Phase: **Location-first Phase 6 Slice C (C1 shipped)** — Slice B audit walk next.
- **Verify:** `verify:dispatcher-nav` / `:prod`; `verify:pickup` / `:prod`; `verify:settings-technicians` / `:prod`; `verify:receive`.
- Stack: React 19 + TS, Vite 8, Firebase 11.x — https://lgarage.github.io/stageverify · Firestore `stageverify-db`

## Active Blockers
1. **Shelving decision** — layout IDs provisional (default shop layout locked for v1 map).
2. **GCP Pub/Sub push path** — optional; poll/Refresh Now proven.

## Immediate Next Step
- **Close theme ship on `theme/dual-mode-modernize`:** delete `scripts/_tmp-*`; Grok UI Playwright + Build Checker; merge `main`; `npm run deploy`; prod verifies; Ship Verifier. `ui-before-after:` in-session compare (dispatcher, settings, pickup, receive, login × dark/light) — do not re-fake befores. Then see `docs/project_state.md`.

## Queued product (deferred)
- **Phase 5 Slice B:** pickup verification v2 polish (per-location confirms, exception flags).

## Canonical references
- **Decisions:** `PROJECT_STATUS/DECISIONS.md` (+ `DECISIONS_ARCHIVE.md` when superseded)
- Handoff: `PROJECT_STATUS/archives/MINI_LIBRARIAN_HANDOFF.md` | Queue: `away-list.json` + `NEXT.md` | Validate: `npm run away:validate`

## Update Protocol
- Ship: `npm run away:ship` → `estimate-log.md` → `npm run away:validate` (auto-syncs CURRENT_STATE + Phase Tracker + roadmap from verify PASS) → commit.
