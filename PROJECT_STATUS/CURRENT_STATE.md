# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> **Memory router:** `PROJECT_STATUS/MEMORY.md` — concern → file → when to read.
> **Product authority (on demand):** `PROJECT_STATUS/svscope_simple.md` — scope wins on conflict; load only for scope disputes.

## Snapshot
- Active Phase: **Phase 5 — Vendor Email Parsing Prototype** (Phase 4 gate closed 2026-06-20)
- Last shipped: **Settings Gmail mailbox UI** — connected Gmail shows unified mailbox section; monitoring inbox locked to connected account; toggle saves processing flag only
- Stack: React 19 + TS, Vite 8, Firebase 11.x, CF v2. Deploy: https://lgarage.github.io/stageverify
- Data: Firestore `stageverify-db`.

## Active Blockers
1. **Minew ESL creds** — live ESL demo only (Phase 7).
2. **Shelving decision (Jake Korb)** — shop map / location IDs.
3. **Physical shop map** — not created.

## Immediate Next Step
- **Post-queue:** see `docs/project_state.md` immediate next steps.

## Canonical references
- **Session handoff:** `PROJECT_STATUS/MINI_LIBRARIAN_HANDOFF.md` — mini-librarian / ACES continuity for new chats
- **Mini-librarian indexer live:** `dossier-index.json`, `gotcha-map.json` + `npm run context:gotcha -- --task "<…>"` (steps 6–8)
- Router: `PROJECT_STATUS/MEMORY.md` | Product: `svscope_simple.md` (on demand) | Queue: `away-list.json` + `NEXT.md`
- Orchestration: Dan standing preference — parallel Composer 2.5 domain executors when paths are disjoint (`parallel-agent-strategy.mdc` § Dan standing preference)
- Phase: `docs/project_state.md` | Roadmap: `docs/roadmap.md` | Warm: `MODEL_DOSSIER.md`
- Validate memory: `npm run away:validate` | Archive: `archives/away-batch-3.json`

## Update Protocol
- Ship away item: `npm run away:ship` → append timing row in `estimate-log.md` only; `--note` = short summary → `npm run away:validate` → commit. Phase ships: sync `project_state.md` + `roadmap.md`.
- **Reconnect Gmail after deploy** — away-068 adds `gmail.send` scope; existing OAuth tokens need reconnect to send.
