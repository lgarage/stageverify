# Memory router (StageVerify)

> **Warm-tier index + retriever seed** (hard cap ≤70 lines — `away:validate` FAILs above; compress, never raise the cap). Concern → file → when to read. **Dev orchestration:** Composer + `.cursor/rules/` — not the full ACES Librarian plane.

## Session start (hot tier — STOP)

1. `PROJECT_STATUS/CURRENT_STATE.md` — always first: phase, blockers, last shipped.
2. `PROJECT_STATUS/MEMORY.md` — this router + narrow "what's next".

**On demand (not session start):** `svscope_simple.md` (scope disputes) · **`PROJECT_STATUS/MVP_PATH.md`** (MVP %, fastest path, planning/priority) · **`npm run away:next -- --packet`** (coding sessions — queue brief + dossier slices first) · `npm run dossier:slice -- --tag <tag>` (MODEL_DOSSIER § — not full file).

## "What's next to build?" (narrow — mandatory)

**Planning sync:** before ranked/planning answers ("what else can mobile do", roadmap, away planning), `git fetch origin main && git pull origin main` — see `parallel-agent-strategy.mdc` § Planning question protocol.

Answer **only** from `npm run away:next` (JSON brief) or `PROJECT_STATUS/CURRENT_STATE.md` immediate next + that item's scope in `away-list.json`.

- **MVP / progress / fastest path questions:** read `PROJECT_STATUS/MVP_PATH.md` first — analyze full gap landscape (not queue alone); return fastest clear path to MVP exit criteria (D-24).
- Do **not** infer the next build item from `docs/roadmap.md` LATER/NEXT narrative (`npm run away:preflight` for sizing). Queue empty/blocked → `MVP_PATH.md` fastest-path table, then `docs/location-first-transition-spec.md` § Phase Tracker. **Full program status** (Phase 3/4+, LATER) → `roadmap.md` + `project_state.md`.

## Away / sleep workflow (mandatory — 4 phases)

**Plan → Approve → Queue → Execute** (away = sleep = overnight batch). Never skip to execute on Dan's first away/sleep question; never auto-queue on plan. **Plan:** `npm run away:plan` — suggest only, no `away-list.json` writes. **Approve:** Dan says `go build it` (or similar) — confirm scope, only then queue approved drafts. **Queue:** add approved items to `away-list.json`. **Execute:** `npm run away:batch` — verify → `away:ship` → `away:validate` per item; halt on fail.

## Authority chain (phase truth)

| Concern | File | When |
| ------- | ---- | ---- |
| Product vision | `PROJECT_STATUS/svscope_simple.md` | Scope disputes only — not session start |
| Phase / deployment | `docs/project_state.md` | Phase gates, what's built |
| Priorities / gates | `docs/roadmap.md` | NOW/NEXT/LATER, scope § mapping |
| Hot snapshot | `PROJECT_STATUS/CURRENT_STATE.md` | Blockers, immediate next (~30 lines) |
| MVP % + fastest path | `PROJECT_STATUS/MVP_PATH.md` (SSOT `## Current percent`) + `mvp-completion-report.mdc` (D-25 work-reply `MVP completion:` line) | Progress, planning, priority ranking; mandatory % line when shipping MVP-scoped work |
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
| Next item packet | `npm run away:next` / root `NEXT.md`; `-- --packet [--tags …]` merges queue brief + blockers + § slices | Before coding queued work |
| Context packet (tags) | `npm run context:packet -- --tags <tags>` | Hot tier + dossier § slices; `--queue` for queue head |
| Task gotcha map | `npm run context:gotcha -- --task "<…>"` | Steps 6–8 reads; prepends lessons § when trigger hits |
| Ship one item | `npm run away:ship -- --id … --note "…"` | After verify; `--note` = summary; timing → `estimate-log.md` |
| Consistency check | `npm run away:validate` · `npm run away:sync` (`--write`) | Auto-syncs CURRENT_STATE + Phase Tracker + roadmap from `verify:location-phaseN` prod PASS |

## Blockers & on-demand routes

| Concern | File / command | When |
| ------- | -------------- | ---- |
| **Security gate (CF/auth/rules)** | `security-review-gate.mdc` | Before push T2+/backend-write-critical; see rule for invocation + evidence requirements. |
| Parallel builds (disjoint) | `parallel-agent-strategy.mdc` § Dan standing preference | Multi-domain; parallel Composer 2.5 when paths disjoint |
| Location-first transition (QR/PIN/pickup rework) | `docs/location-first-transition-spec.md` § Phase Tracker | Read tracker first. **Vendor PIN = job-scoped by default (D14)** — § Job-scoped vendor PIN before PIN/scan work; vendor/company-scoped visibility REJECTED unless dispatcher enables `companyWideSessionEnabled` (D-09 amended 2026-07-20) |
| ESL / Minew | `ESL_INTEGRATION_PLAN.md` | **Not in MVP scope (D-26)** — post-MVP only |
| Nav rejections | `USER_SCOPE_REJECTIONS.md` | Dispatcher nav / Settings IA |
| Delivery display / dossier § | `deliveryDisplayHelpers.ts`, `dossier-index.json`, `npm run dossier:slice -- --tag <tag>` | List/drawer readiness; dossier by tag only |
