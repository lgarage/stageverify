# Memory router (StageVerify)

> **Warm-tier index + retriever seed** (≤70 lines). Concern → file → when to read. **Dev orchestration:** Composer + `.cursor/rules/` — not the full ACES Librarian plane.

## Session start (hot tier — STOP)

| Order | File | When |
| ----- | ---- | ---- |
| 1 | `PROJECT_STATUS/CURRENT_STATE.md` | Always first — phase, blockers, last shipped |
| 2 | `PROJECT_STATUS/MEMORY.md` | Router + narrow "what's next" (this file) |

**On demand (not session start):** `svscope_simple.md` (scope disputes) · `npm run away:next` · `MODEL_DOSSIER.md` § agent-lessons (pickup/receive/vendor).

## “What’s next to build?” (narrow — mandatory)

Answer **only** from `npm run away:next` (JSON brief) or `PROJECT_STATUS/CURRENT_STATE.md` immediate next + that item’s scope in `away-list.json`.

- Do **not** infer the next build item from `docs/roadmap.md` LATER/NEXT narrative sections.
- Optional work sizing: `npm run away:preflight` (runs queued item `verifyBeforeNext`).
- **Full program status** (Phase 3/4 gaps, LATER phases): separate question — then read `roadmap.md` + `project_state.md`.

## Away / sleep workflow (mandatory — 4 phases)

**Plan → Approve → Queue → Execute.** Never skip to execute on Dan's first away/sleep question; never auto-queue on plan.

| Phase | Trigger | Agent action |
| ----- | ------- | -------------- |
| **Plan** | away/sleep/overnight first question | `npm run away:plan` — suggest work; **do not** write `away-list.json` |
| **Approve** | Dan says `go build it` (or similar) | Confirm scope; only then queue approved drafts |
| **Queue** | After approval | Add approved items to `away-list.json` |
| **Execute** | Queue ready | `npm run away:batch` — verify → `away:ship` → `away:validate` per item; halt on fail |

Long batch (≥3 items) is Dan's default. If `batchSize` < 3 at plan time, use `suggestedAdditions` as drafts only.

## Authority chain (phase truth)

| Concern | File | When |
| ------- | ---- | ---- |
| Product vision | `PROJECT_STATUS/svscope_simple.md` | Scope disputes only — not session start |
| Phase / deployment | `docs/project_state.md` | Phase gates, what's built |
| Priorities / gates | `docs/roadmap.md` | NOW/NEXT/LATER, scope § mapping |
| Hot snapshot | `PROJECT_STATUS/CURRENT_STATE.md` | Blockers, immediate next (~30 lines) |

## Away queue (work spec + ship log)

| Concern | File / command | When |
| ------- | -------------- | ---- |
| Active queue | `PROJECT_STATUS/away-list.json` | Queued/blocked items only |
| Execution log | `PROJECT_STATUS/away-status.json` | Append-only built/blocked/deferred |
| Build protocol | `PROJECT_STATUS/AWAY_BUILD_PROTOCOL.md` | Running away batches |
| Next item packet | `npm run away:next` / root `NEXT.md` | Before coding queued work |
| Plan (suggest only) | `npm run away:plan` | Away/sleep first question — no queue writes |
| Ship one item | `npm run away:ship -- --id … --note "…"` | After verify passes |
| Consistency check | `npm run away:validate` | Before commit; after memory edits |
| Archive batch 1–3 | `PROJECT_STATUS/archives/away-batch-3.json` | Historical away-001…041 specs |

## ACES / meta (deferred)

| Concern | File | When |
| ------- | ---- | ---- |
| Full Librarian vision | `docs/aecs/librarian-plan.md` | Target ACES hierarchy — not built; mini = this file + `away:validate` |
| ACES prototype | `aecs/README.md` | Control-plane meta-work only when Dan asks |

## Blockers & hardware

| Concern | File | When |
| ------- | ---- | ---- |
| ESL / Minew | `PROJECT_STATUS/ESL_INTEGRATION_PLAN.md` | Phase 7; placeholders only in repo |
| Nav / scope rejections | `PROJECT_STATUS/USER_SCOPE_REJECTIONS.md` | Dispatcher nav / Settings IA |
