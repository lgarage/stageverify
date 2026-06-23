# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> **Memory router:** `PROJECT_STATUS/MEMORY.md` — concern → file → when to read.
> **Product authority (on demand):** `PROJECT_STATUS/svscope_simple.md` — scope wins on conflict; load only for scope disputes.

## Snapshot
- Active Phase: **Phase 5 — Vendor Email Parsing Prototype** (Phase 4 gate closed 2026-06-20)
- Last shipped: **away-068** — Phase 6 slice 2: Outbound sendVendorEmail + enable Email Vendor
- Stack: React 19 + TS, Vite 8, Firebase 11.x, CF v2. Deploy: https://lgarage.github.io/stageverify
- Data: Firestore `stageverify-db`.

## Active Blockers
1. **Minew ESL creds** — live ESL demo only (Phase 7).
2. **Shelving decision (Jake Korb)** — shop map / location IDs.
3. **Physical shop map** — not created.

## Immediate Next Step
- **Post-queue:** see `docs/project_state.md` immediate next steps (away-069 Gmail reply sync next).

## Canonical references
- **Librarian mini:** MEMORY.md router + `away:next` packet + `away:validate`
- Router: `PROJECT_STATUS/MEMORY.md` | Product: `svscope_simple.md` (on demand) | Queue: `away-list.json` + `NEXT.md`
- Phase: `docs/project_state.md` | Roadmap: `docs/roadmap.md` | Warm: `MODEL_DOSSIER.md`
- Validate memory: `npm run away:validate` | Archive: `archives/away-batch-3.json`

## Update Protocol
- Ship away item: `npm run away:ship` → `npm run away:validate` → commit. Phase ships: sync `project_state.md` + `roadmap.md`.
- **Reconnect Gmail after deploy** — away-068 adds `gmail.send` scope; existing OAuth tokens need reconnect to send.
