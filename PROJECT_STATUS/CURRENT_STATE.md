# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier â€” hard cap ~30 lines.
> **Memory router:** `PROJECT_STATUS/MEMORY.md` â€” concern â†’ file â†’ when to read.
> **Product authority (on demand):** `PROJECT_STATUS/svscope_simple.md` â€” scope wins on conflict; load only for scope disputes.

## Snapshot
- Active Phase: **Phase 5â€“6 â€” Vendor Email + Inbound Invoice Ingestion**
- Last shipped: **Invoice Review inspect modal + Johnstone line parser** — inspect modal simplified (summary + header + readable lines table with UOM/extension); invoice message block → `orderNotes`; 5 product lines from S/O 4046362 PDF (L97-525…P34-544) with multi-line descriptions
- Also shipped: **Invoice Review match loop fix** — issue imports skip `matchInvoiceToRecords` CF; stable inline "Match unavailable" copy; no retry loop or console 400 spam
- Also shipped: **away-100** — mini-librarian indexer hygiene; context-index drift fix, MEMORY trim, packet dedup (top-2 cap), product-domain indexer entries idx-004/005
- Also shipped: **away-099** — intelligent indexer ingest + deterministic packet retrieval (`indexer:ingest`, `indexer-memory.json`, `away:next --packet`)
- Also shipped: **Johnstone PDF U+XX00 extraction fix** — pdf.js primary extract + U+XX00 normalizer + layout adapter; Refresh Now re-fetches bad-encoded imports; `test:pdf-text-normalize` + `test:pdf-extract-4046362`
- Also shipped (standalone): **Invoice Review row-card + inspect expected fields** (bd4d08f) — one row per import; Inspect/Approve/Reject on row; expected-vs-actual Johnstone fields in inspect modal
- Also shipped: **away-099** — intelligent indexer ingest + deterministic packet retrieval (`indexer:ingest`, `indexer-memory.json`, `away:next --packet`)
- Also shipped (standalone): **Option A issue-import queue** (b43ec6e) â€” S/O / missing Invoice # parses now create `vendorInvoiceImports` review rows; Approve blocked server+UI; Refresh Now backfills legacy 0-queue parsed emails
- Also shipped (standalone): **inbound backfill + Firestore write fix** â€” Refresh Now scans Firestore for 0-queue parsed/error docs; cached-text reparse; `firestoreSafeValue` strips undefined before review writes; sync banner shows error detail
- Also shipped (standalone): **shared dispatcher Refresh Now sync** (c125d86) â€” `DispatcherPortalProvider` caches invoice queue, vendors, zones; Refresh Now on any portal tab updates all tabs
- Also shipped (standalone): **retryOnError atomic overwrite** â€” error retry no longer delete+set; emulator test `test:retry-on-error-inbound` (6476b2a MEDIUM-2 fix)
- Also shipped (standalone): **Gmail sync clarity + shared dispatcher header** (6476b2a) â€” sync banner distinguishes scanned vs queued invoices; manual Refresh Now retries error-status messages; `DispatcherPortalTopBar` on Dashboard, Staging Map, Vendors, Invoice Review, Settings
- Also shipped (standalone): **Invoice Review inspect + header fields** â€” alias-aware P/O, buyer, and header grid; Confidence column removed; **View parsed** / **Inspect parsed data** modal on queue rows and detail pane
- Also shipped (standalone): **Johnstone S/O header parser hardening** â€” tabular PDF headers, optional-colon labels, stacked pairs; S/O 4046362 fixture; issue status when Invoice # missing; reparse from cached text
- Also shipped: **Refresh Now Gmail sync** â€” dispatcher Refresh Now triggers `triggerInboundGmailSyncCallable` (same path as scheduled `syncInboundGmail`) then refreshes delivery list
- Also shipped (standalone): **security protocol** (68c6bd7) â€” enforce real Sonnet security-review Task gate before push
- Also shipped (standalone): **demo order cleanup** â€” prod ORD-001..006 removed; `npm run cleanup:demo-data` (`scripts/cleanup-demo-firestore.mjs`)
- Also shipped (standalone): stranded-processing TOCTOU â€” transaction guard + emulator tests (`test:recover-stranded-processing`, b0a2448)
- Stack: React 19 + TS, Vite 8, Firebase 11.x, CF v2. Deploy: https://lgarage.github.io/stageverify
- Data: Firestore `stageverify-db`.

## Active Blockers
1. **Minew ESL creds** â€” live ESL demo only (Phase 7).
2. **Shelving decision (Jake Korb)** â€” shop map / location IDs.
3. **Physical shop map** â€” not created.
4. **Inbound Gmail CF + rules deploy** â€” `triggerInboundGmailSyncCallable` shipped; Dan still configures `GMAIL_PUBSUB_TOPIC` + GCP topic IAM (`gmail-inbox-notifications`), then `firebase deploy --only functions,firestore:rules`. gcloud auth expired in agent session â€” manual GCP console steps in `docs/project_state.md` Gmail checklist.

## Immediate Next Step
- **Post-queue:** see `docs/project_state.md` immediate next steps.

## Canonical references
- **Session handoff:** `PROJECT_STATUS/MINI_LIBRARIAN_HANDOFF.md` â€” mini-librarian / ACES continuity for new chats
- **Mini-librarian indexer live:** `dossier-index.json`, `gotcha-map.json`, `indexer-memory.json` + `npm run indexer:ingest` / `context:gotcha` / `away:next --packet`
- Router: `PROJECT_STATUS/MEMORY.md` | Product: `svscope_simple.md` (on demand) | Queue: `away-list.json` + `NEXT.md`
- Orchestration: Dan standing preference â€” parallel Composer 2.5 domain executors when paths are disjoint (`parallel-agent-strategy.mdc` Â§ Dan standing preference)
- Phase: `docs/project_state.md` | Roadmap: `docs/roadmap.md` | Warm: `MODEL_DOSSIER.md`
- Validate memory: `npm run away:validate` | Archive: `archives/away-batch-3.json`

## Update Protocol
- Ship away item: `npm run away:ship` â†’ append timing row in `estimate-log.md` only; `--note` = short summary â†’ `npm run away:validate` â†’ commit. Phase ships: sync `project_state.md` + `roadmap.md`.
- **Reconnect Gmail after deploy** â€” away-068 adds `gmail.send` scope; existing OAuth tokens need reconnect to send.
