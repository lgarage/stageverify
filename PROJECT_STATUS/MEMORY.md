# Memory router (StageVerify)

> **Warm-tier index + retriever seed** (≤70 lines). Concern → file → when to read. **Dev orchestration:** Composer + `.cursor/rules/` — not the full ACES Librarian plane.

## Session start (hot tier — STOP)

| Order | File | When |
| ----- | ---- | ---- |
| 1 | `PROJECT_STATUS/CURRENT_STATE.md` | Always first — phase, blockers, last shipped |
| 2 | `PROJECT_STATUS/MEMORY.md` | Router + narrow "what's next" (this file) |

**On demand (not session start):** `svscope_simple.md` (scope disputes) · **`PROJECT_STATUS/MVP_PATH.md`** (MVP %, fastest path, planning/priority) · **`npm run away:next -- --packet`** (coding sessions — queue brief + dossier slices first) · `npm run dossier:slice -- --tag <tag>` (MODEL_DOSSIER § — not full file).

## “What’s next to build?” (narrow — mandatory)

Answer **only** from `npm run away:next` (JSON brief) or `PROJECT_STATUS/CURRENT_STATE.md` immediate next + that item’s scope in `away-list.json`.

- **MVP / progress / fastest path questions:** read `PROJECT_STATUS/MVP_PATH.md` first — analyze full gap landscape (not queue alone); return fastest clear path to MVP exit criteria (D-24).
- Do **not** infer the next build item from `docs/roadmap.md` LATER/NEXT narrative (`npm run away:preflight` for sizing). Queue empty/blocked → `MVP_PATH.md` fastest-path table, then `docs/location-first-transition-spec.md` § Phase Tracker. **Full program status** (Phase 3/4+, LATER) → `roadmap.md` + `project_state.md`.

## Away / sleep workflow (mandatory — 4 phases)

**Plan → Approve → Queue → Execute.** Never skip to execute on Dan's first away/sleep question; never auto-queue on plan.

| Phase | Trigger | Agent action |
| ----- | ------- | -------------- |
| **Plan** | away/sleep/overnight first question | `npm run away:plan` — suggest work; **do not** write `away-list.json` |
| **Approve** | Dan says `go build it` (or similar) | Confirm scope; only then queue approved drafts |
| **Queue** | After approval | Add approved items to `away-list.json` |
| **Execute** | Queue ready | `npm run away:batch` — verify → `away:ship` → `away:validate` per item; halt on fail |

## Authority chain (phase truth)

| Concern | File | When |
| ------- | ---- | ---- |
| Product vision | `PROJECT_STATUS/svscope_simple.md` | Scope disputes only — not session start |
| Phase / deployment | `docs/project_state.md` | Phase gates, what's built |
| Priorities / gates | `docs/roadmap.md` | NOW/NEXT/LATER, scope § mapping |
| Hot snapshot | `PROJECT_STATUS/CURRENT_STATE.md` | Blockers, immediate next (~30 lines) |
| MVP % + fastest path | `PROJECT_STATUS/MVP_PATH.md` | Progress, planning, away planning, priority ranking to MVP done; SSOT `## Current percent` |
| MVP % in work replies | `.cursor/rules/mvp-completion-report.mdc` | Mandatory `MVP completion: XX.XX%` line when shipping MVP-scoped work (D-25) |
| Why was X decided / decision history | `PROJECT_STATUS/DECISIONS.md` | Harness + product decisions; superseded → `DECISIONS_ARCHIVE.md` |

## Away queue (work spec + ship log)

| Concern | File / command | When |
| ------- | -------------- | ---- |
| Active queue | `PROJECT_STATUS/away-list.json` | Queued/blocked items only |
| Execution log | `PROJECT_STATUS/away-status.json` | Append-only built/blocked/deferred (summary notes — no timing audit) |
| **Timing audit (SSOT)** | `PROJECT_STATUS/estimate-log.md` | Worker `task-start`/`task-finish`; librarian records; timestamp-derived actual only |
| **Estimate calibration audit** | `npm run estimate:audit` + `estimate-audit.json` | Every 15 log rows; `--apply` writes subtype budgets |
| **Lessons learned (SSOT)** | `PROJECT_STATUS/LIBRARIAN_LESSONS.md` | Rolling agent lessons; gotcha-map supplements on task match |
| **Lessons § indexer** | `librarian-lessons-index.json` + `npm run context:lessons -- --type <type>/<subtype>` | After archetype/subtype gate — slice one §, not full file |
| Build protocol | `PROJECT_STATUS/AWAY_BUILD_PROTOCOL.md` | Running away batches |
| Next item packet | `npm run away:next` / root `NEXT.md` | Before coding queued work |
| Context packet (tags) | `npm run context:packet -- --tags <tags>` | Hot tier + dossier § slices; `--queue` for queue head |
| Task gotcha map | `npm run context:gotcha -- --task "<…>"` | Steps 6–8 reads; prepends lessons § when trigger hits |
| Merged next + packet | `npm run away:next -- --packet [--tags …]` | Queue brief + blockers + optional § slices |
| Plan (suggest only) | `npm run away:plan` | Away/sleep first question — no queue writes |
| Ship one item | `npm run away:ship -- --id … --note "…"` | After verify; `--note` = summary; timing → `estimate-log.md` |
| Consistency check | `npm run away:validate` · `npm run away:sync` (`--write`) | Auto-syncs CURRENT_STATE + Phase Tracker + roadmap from `verify:location-phaseN` prod PASS |

## Blockers & on-demand routes

| Concern | File / command | When |
| ------- | -------------- | ---- |
| **Security gate (CF/auth/rules)** | `security-review-gate.mdc` | Before push T2+/backend-write-critical; see rule for invocation + evidence requirements. |
| Parallel builds (disjoint) | `parallel-agent-strategy.mdc` § Dan standing preference | Multi-domain; parallel Composer 2.5 when paths disjoint |
| Location-first transition (QR/PIN/pickup rework) | `docs/location-first-transition-spec.md` § Phase Tracker | Read tracker first. **Vendor PIN = job-scoped (D14, Dan 2026-07-08)** — § Job-scoped vendor PIN before any PIN/scan visibility work; vendor/company-scoped visibility REJECTED |
| ESL / Minew | `ESL_INTEGRATION_PLAN.md` | Phase 7; placeholders only |
| Nav rejections | `USER_SCOPE_REJECTIONS.md` | Dispatcher nav / Settings IA |
| Delivery display / dossier § | `deliveryDisplayHelpers.ts`, `dossier-index.json`, `npm run dossier:slice -- --tag <tag>` | List/drawer readiness; dossier by tag only |
