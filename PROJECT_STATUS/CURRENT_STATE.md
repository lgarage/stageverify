# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> **Memory router:** `PROJECT_STATUS/MEMORY.md` — concern → file → when to read.
> **Product authority (on demand):** `PROJECT_STATUS/svscope_simple.md` — scope wins on conflict; load only for scope disputes.

## Snapshot
- Active Phase: **Phase 5–6 — Vendor Email + Inbound Invoice Ingestion**
- Last shipped: **View original PDF in parsed inspect modal (v0.0.8)** ? modal header button opens Gmail attachment via `getVendorInvoicePdf` CF in new tab; works on Invoice Review and drawer "Review parsed invoice data" (no separate drawer PDF button)
- Also shipped: **Parsed inspect modal site-confirmed (v0.0.7)** ? drawer "Review parsed invoice data" hides Review required panel and shows Approval eligible N/A when `invoiceDeliverToSiteConfirmed`
- Also shipped: **Dispatcher delivered UX + demo review cleanup (v0.0.5)** ? confirmed deliver-to-site: empty Issue Summary (no warning note), subtle undo link in drawer, banner "Delivered to site" not Ready for Pickup; production Needs Review strip no longer shows offline email fixtures (`emailFixtures.ts`)
- Also shipped: **Deliver-to-site UI cascade (v0.0.4)** ? Mark delivered to site receipts all line items + updates Delivery Status "Delivered", Items Recv. 43/43, drawer item rows; display helpers treat confirmed site delivery as full receipt
- Also shipped: **Deliver-to-site confirmation (v0.0.3)** ? dispatcher drawer marks/clears site delivery; Issue Summary confirm/delivered lines; Complete counts wait on `invoiceDeliverToSiteConfirmed`
- Also shipped: **Dispatcher dashboard fixes (v0.0.2)** � removed View Invoice PDF from drawer/modal; PO # via `resolveDeliveryPoNumber` (`customerPoOrReference` fallback); Complete column counts `complete` deliveries not staged
- Also shipped: **Sidebar build version** � persistent `v{package.json}` label above Settings (from Vite define); `verify:dispatcher-nav` asserts `portal-sidebar-version`
- Also shipped: **Invoice shell drawer + staging guard** — deliver-to-site/will-call shells skip shop staging only when `createdFromInvoiceImport` or canonical `delivery-vii-*` id; invoice PDF callables; drawer View PDF + shell display helpers; `create_shell` patch gated to invoice shells only
- Also shipped: **Invoice approve → dashboard visibility + no silent shell failure** — review-only Approve auto-creates job from P/O when unmatched; CF returns `shellCreated`/`jobCreated`; backfill errors surface in Invoice Review + Refresh Now; success banner + portal refresh on approve
- Also shipped: **Invoice shell auto-backfill + job PO matching** — removed manual "Create dashboard record" button; approved-unlinked imports auto-create dashboard shells on approve, Invoice Review load, and Refresh Now; PO hints like `blackduck hartfo` match job names (P411190 / S/O 4046362)
- Also shipped: **Approved unlinked invoices → dispatcher dashboard** — approve without deliveryId auto-creates shell delivery + expected items; Will-Call / Pickup display label; `create_shell` idempotent backfill
- Also shipped: **away-108** — Inbound reparse stale issue-import backfill
- Also shipped: **Invoice Review approved archive** — read-only list with invoice/S-O/PO/buyer/approved date + linked badge
- Also shipped: **Invoice Review approve CF deploy fix** — rebuilt `functions/lib/approveVendorInvoiceImport.js` (TS fix from 8ff639b was never compiled/deployed); review-only approve now live in production
- Also shipped: **gh-pages stuck-build learning (13d9110)** — gotcha-map gh-pages-deploy-freshness extended (branch/live mismatch, Pages build stuck); deploy classifier + demo regressions
- Also shipped: **Deploy-failure auto-learning** — deploy-gh-pages.mjs captures timeout/stale-bundle/build-errored to learning-pending; gotcha-map gh-pages-deploy-freshness; packet injects pending deploy warnings for frontend tasks only
- Also shipped: **Verify-failure auto-learning (audit)** — gh-pages classification scoped to frontend :prod; backend integration excluded; 3 more :prod wrappers; pending validation tightened
- Also shipped: **Automatic indexer learning on away:ship** — `--learned`/`--failure`+`--fix` inline capture; demo-packet regression in away:validate; gateWarnings auto-inject in packet
- Also shipped: **Indexer learning loop — stale gh-pages prod-verify** — gotcha-map gateCandidate warning + injectBefore; idx-006 timing; demo packet positive/negative asserts
- Also shipped: **Invoice Review manual approve** — Approve without auto-match; delivery picker in inspect modal (candidates + manual ID + recent deliveries); row match section removed
- Also shipped: **Invoice Review approve unblock + COD terms** — match CF optional vendor/ship-to addresses; Approve/Reject inline row buttons; COD chip from `parsedHeader.paymentTermsRaw` / `codOnly`
- Also shipped: **Indexer-memory packet injection drift verifier** — away:validate fails on indexer-memory.json slice/anchor drift; fixed idx-001/004/005 slices + lesson bullets 19–20
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
