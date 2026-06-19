# Memory router (StageVerify)

> **≤60 lines — Indexer + Retriever seed.** Concern → file → when to read.  
> **Product authority:** `PROJECT_STATUS/svscope_simple.md` wins on conflict.  
> **Dev orchestration:** Composer + `.cursor/rules/` — not the Librarian plane.

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
| Ship one item | `npm run away:ship -- --id … --note "…"` | After verify passes |
| Consistency check | `npm run away:validate` | Before commit; after memory edits |

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

## History (read-only)

| Concern | File | When |
| ------- | ---- | ---- |
| Memory audit (superseded) | `PROJECT_STATUS/archives/MEMORY_ARCHITECTURE_ASSESSMENT.md` | Historical context only |
