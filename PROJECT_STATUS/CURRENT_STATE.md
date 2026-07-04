# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> **Memory router:** `PROJECT_STATUS/MEMORY.md` — concern → file → when to read.
> **Product authority (on demand):** `PROJECT_STATUS/svscope_simple.md` — scope wins on conflict; load only for scope disputes.

## Snapshot
- Active Phase: **Phase 5–6 — Vendor Email + Inbound Invoice Ingestion**
- Last shipped: **away-098** — mini-librarian indexer + gotcha hygiene; lessons index dedupe
- Also shipped (standalone): **Option A issue-import queue** (b43ec6e) — S/O / missing Invoice # parses now create `vendorInvoiceImports` review rows; Approve blocked server+UI; Refresh Now backfills legacy 0-queue parsed emails
- Also shipped (standalone): **inbound backfill + Firestore write fix** — Refresh Now scans Firestore for 0-queue parsed/error docs; cached-text reparse; `firestoreSafeValue` strips undefined before review writes; sync banner shows error detail
- Also shipped (standalone): **shared dispatcher Refresh Now sync** (c125d86) — `DispatcherPortalProvider` caches invoice queue, vendors, zones; Refresh Now on any portal tab updates all tabs
- Also shipped (standalone): **retryOnError atomic overwrite** — error retry no longer delete+set; emulator test `test:retry-on-error-inbound` (6476b2a MEDIUM-2 fix)
- Also shipped (standalone): **Gmail sync clarity + shared dispatcher header** (6476b2a) — sync banner distinguishes scanned vs queued invoices; manual Refresh Now retries error-status messages; `DispatcherPortalTopBar` on Dashboard, Staging Map, Vendors, Invoice Review, Settings
- Also shipped: **Refresh Now Gmail sync** — dispatcher Refresh Now triggers `triggerInboundGmailSyncCallable` (same path as scheduled `syncInboundGmail`) then refreshes delivery list
- Also shipped (standalone): **security protocol** (68c6bd7) — enforce real Sonnet security-review Task gate before push
- Also shipped (standalone): **demo order cleanup** — prod ORD-001..006 removed; `npm run cleanup:demo-data` (`scripts/cleanup-demo-firestore.mjs`)
- Also shipped (standalone): stranded-processing TOCTOU — transaction guard + emulator tests (`test:recover-stranded-processing`, b0a2448)
- Stack: React 19 + TS, Vite 8, Firebase 11.x, CF v2. Deploy: https://lgarage.github.io/stageverify
- Data: Firestore `stageverify-db`.

## Active Blockers
1. **Minew ESL creds** — live ESL demo only (Phase 7).
2. **Shelving decision (Jake Korb)** — shop map / location IDs.
3. **Physical shop map** — not created.
4. **Inbound Gmail CF + rules deploy** — `triggerInboundGmailSyncCallable` shipped; Dan still configures `GMAIL_PUBSUB_TOPIC` + GCP topic IAM (`gmail-inbox-notifications`), then `firebase deploy --only functions,firestore:rules`. gcloud auth expired in agent session — manual GCP console steps in `docs/project_state.md` Gmail checklist.

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
