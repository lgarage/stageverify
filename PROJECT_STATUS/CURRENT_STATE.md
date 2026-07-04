# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> **Memory router:** `PROJECT_STATUS/MEMORY.md` — concern → file → when to read.
> **Product authority (on demand):** `PROJECT_STATUS/svscope_simple.md` — scope wins on conflict; load only for scope disputes.

## Snapshot
- Active Phase: **Phase 5–6 — Vendor Email + Inbound Invoice Ingestion**
- Last shipped: **Invoice Review row-click inspect + approve shipDate fix** — row opens inspect modal; match CF no longer requires shipDate; Sonnet-only security gate rules strengthened
- Also shipped: **Refresh Now reparse for stale issue imports** — manual sync re-parses cached text when `vendorInvoiceImports` has `pending_review`+`issue`; fixes S/O 4046362 P411190 after parser 5d1d224
- Also shipped: **Johnstone alphanumeric Invoice # parser (P411190 / S/O 4046362)** — tabular pdf.js header extracts `P411190`; wide-row Ship Via → Fond du Lac
- Also shipped: **orchestrator rules dedup** — mini-librarian/session-start SSOT in composer-orchestrator; security gate template SSOT in model-audit-gate; cross-refs elsewhere
- Also shipped: **orchestrator/indexer hygiene** (standalone chore) — away:validate green; dossier anchors; queue archive 092–094
- Also shipped: **Invoice Review inspect modal + Johnstone line parser** — inspect modal simplified; orderNotes; 5 product lines from S/O 4046362
- Also shipped: **away-100** — mini-librarian indexer hygiene; context-index drift, MEMORY trim, packet dedup
- Also shipped: **away-099** — intelligent indexer ingest + deterministic packet retrieval
- Stack: React 19 + TS, Vite 8, Firebase 11.x, CF v2. Deploy: https://lgarage.github.io/stageverify
- Data: Firestore `stageverify-db`.

## Active Blockers
1. **Minew ESL creds** — live ESL demo only (Phase 7).
2. **Shelving decision (Jake Korb)** — shop map / location IDs.
3. **Physical shop map** — not created.
4. **Inbound Gmail CF + rules deploy** — `triggerInboundGmailSyncCallable` shipped; Dan still configures `GMAIL_PUBSUB_TOPIC` + GCP topic IAM.

## Immediate Next Step
- **Post-queue:** see `docs/project_state.md` immediate next steps.

## Canonical references
- Handoff: `MINI_LIBRARIAN_HANDOFF.md` | Indexer: `dossier-index.json`, `indexer-memory.json`, `npm run away:next --packet`
- Router: `MEMORY.md` | Queue: `away-list.json` + `NEXT.md` | Validate: `npm run away:validate`

## Update Protocol
- Ship: `npm run away:ship` → `estimate-log.md` timing → `npm run away:validate` → commit. Phase ships: sync `project_state.md` + `roadmap.md`.
