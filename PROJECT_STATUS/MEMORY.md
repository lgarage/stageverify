# Memory router (StageVerify)

> **≤60 lines — Indexer + Retriever seed.** Concern → file → when to read.  
> **Product authority:** `PROJECT_STATUS/svscope_simple.md` wins on conflict.  
> **Dev orchestration:** Composer + `.cursor/rules/` — not the Librarian plane.

## “What’s next to build?” (narrow — mandatory)

Answer **only** from `npm run away:next` (JSON brief) or `PROJECT_STATUS/CURRENT_STATE.md` immediate next + that item’s scope in `away-list.json`.

- Do **not** infer the next build item from `docs/roadmap.md` LATER/NEXT narrative sections.
- Optional work sizing: `npm run away:preflight` (runs queued item `verifyBeforeNext`).
- **Full program status** (Phase 3/4 gaps, LATER phases): separate question — then read `roadmap.md` + `project_state.md`.

## Away / sleep workflow (mandatory — 4 phases)

**Plan → Approve → Queue → Execute.** Never skip to execute on Dan's first away/sleep question; never auto-queue on plan.

| Phase | Trigger | Agent action |
| ----- | ------- | -------------- |
| **Plan** | `what should I build while I'm away/sleep/overnight` | `npm run away:plan` — suggest work; **do not** write `away-list.json` |
| **Approve** | Dan says `go build it` (or similar) | Confirm scope; only then queue approved drafts |
| **Queue** | After approval | Add approved items to `away-list.json` |
| **Execute** | Queue ready | `npm run away:batch` — all queued items; verify → `away:ship` → `away:validate` per item; halt on fail |

Plan/approve/queue can run any time of day; execute-batch triggers include sleep/overnight. **Long batch** (≥3 items) is Dan's default. If `away:plan` shows `batchSize` < 3, use `suggestedAdditions` as draft templates only — not queued until approved. No unqueued roadmap work.

## Session start (every coding session)

| Order | File | When |
| ----- | ---- | ---- |
| 1 | `PROJECT_STATUS/CURRENT_STATE.md` | Always first — phase, blockers, last shipped |
| 2 | `PROJECT_STATUS/svscope_simple.md` | Product/feature scope; align all work to scope § |
| 3 | `NEXT.md` or `npm run away:next` | Next queued away item (if any) |
| 4 | `PROJECT_STATUS/MODEL_DOSSIER.md` § agent-lessons | Before pickup, receive, vendor, public routes |

## Authority chain (phase truth)

| Concern | File | When |
| ------- | ---- | ---- |
| Product vision | `PROJECT_STATUS/svscope_simple.md` | Features, flows, scope disputes |
| Phase / deployment | `docs/project_state.md` | Phase gates, what's built |
| Priorities / gates | `docs/roadmap.md` | NOW/NEXT/LATER, scope § mapping |
| Hot snapshot | `PROJECT_STATUS/CURRENT_STATE.md` | Blockers, immediate next (~30 lines) |

## Away queue (work spec + ship log)

| Concern | File | When |
| ------- | ---- | ---- |
| Active queue | `PROJECT_STATUS/away-list.json` | Queued/blocked items only — done items archived |
| Execution log | `PROJECT_STATUS/away-status.json` | Append-only built/blocked/deferred |
| Archive batch 1–3 | `PROJECT_STATUS/archives/away-batch-3.json` | Historical away-001…041 specs |
| Build protocol | `PROJECT_STATUS/AWAY_BUILD_PROTOCOL.md` | Running away batches |
| Batch sequence | `npm run away:batch` | Execute phase — all queued items |
| Plan (suggest only) | `npm run away:plan` | Away/sleep first question — no queue writes |
| Ship one item | `npm run away:ship -- --id … --note "…"` | After verify passes |
| Consistency check | `npm run away:validate` | Before commit; after memory edits |
| Preflight queued item | `npm run away:preflight` | Before coding session (opt-in) |
| Sync NEXT pointer | `npm run away:sync-next` | After editing away-list without ship |

## ACES / builder (meta — SV product wins)

| Concern | File | When |
| ------- | ---- | ---- |
| ACES prototype | `aecs/README.md` | Control-plane meta-work only when Dan asks |
| Full Librarian vision (deferred) | `docs/aecs/librarian-plan.md` | Target ACES knowledge hierarchy — not built; mini seed is this file + `away:validate` |
| Bindings example | `aecs/examples/adapters/stageverify.bindings.json` | Portable memory paths reference |

## Blockers & hardware

| Concern | File | When |
| ------- | ---- | ---- |
| ESL / Minew | `PROJECT_STATUS/ESL_INTEGRATION_PLAN.md` | Phase 7; placeholders only in repo |
| Nav / scope rejections | `PROJECT_STATUS/USER_SCOPE_REJECTIONS.md` | Dispatcher nav / Settings IA |
