# StageVerify ? Project State - C:\Projects\stageverify\docs\project_state.md

> **Canonical phase truth** ? single source for current phase, features, deployment status, and known issues.
> Hot-tier agents: read `PROJECT_STATUS/CURRENT_STATE.md` first; load this file for phase/roadmap decisions.
> **Product vision authority:** `PROJECT_STATUS/svscope_simple.md` ? end-to-end product design; all features and agent work must align with scope � there. Roadmap and phase status trace to it; when this file and scope disagree, **scope wins**.
> **Maintained by:** Composer 2.5 (update after major milestones)
> **Last reviewed:** 2026-06-23

---

## Current Vision

**StageVerify V2 ? Material Readiness Platform**

Ensure technicians leave the shop with everything needed to successfully complete a job.
StageVerify is not a WMS, ERP, or inventory system. It is a material readiness and
accountability layer that sits between purchasing, vendors, the staging shop, and
field technicians.

V2 tracks both assigned staging location and current physical location of materials, enabling technicians to find materials regardless of whether they've been formally staged.

**BuildOps boundary:** BuildOps owns inventory, procurement, purchasing, reorder logic, and warehouse stock management. StageVerify owns material readiness, assigned and current location, pickup accountability, material issues, and vendor-delivery accountability ? not stock-on-hand balances, min/max levels, or purchasing.

### Material state dimensions (distinct questions)

| Concept | Answers | Notes |
| ------- | ------- | ----- |
| **Assigned location** | Where material *should* be staged | `stagingLocationId` (V1); unchanged in V2 |
| **Current location** | Where material was *last known* to physically be | Recommended V2 field: `currentLocationNote` ? distinct from assigned location |
| **Availability** | Physical receipt state | Recommended V2 field: `availabilityStatus` ? `expected` / `received` / `picked_up`. Physical location is a separate attribute via `currentLocationNote` ? material can simultaneously be received + located somewhere + not-staged + not-ready. |
| **Business workflow** | Ordering, staging, pickup progression | V1 `DeliveryStatus`; V2 `ReadinessStatus` ? not the same as physical location or availability |

`materialSource` belongs at the individual `Item` or material-line level primarily. A single delivery may contain mixed sources (`vendor_delivery` | `shop_stock` | `direct_shipment` | `unknown`). This is pickup-accountability data, NOT inventory tracking.

---

## Current Phase

**Phase 1 ? Stabilize Current Platform** ? COMPLETE (gate passed)

The Phase 1 MVP lifecycle is fully operational:

Ordered ? Shipped ? Received ? Staged ? Picked Up ? Installed

Note:

StageVerify V2 is transitioning toward a Material Readiness model:

Ordering ? Not Ready ? Ready For Pickup ? Picked Up

The existing MVP workflow remains operational and serves as the foundation for V2.

The platform is deployed and functional on GitHub Pages.

**Phase 2 ? Material Readiness Data Model** ? COMPLETE (gate passed 2026-06-08)

V2 optional fields and forward-compatible stub types live in `src/dispatcher/models.ts`. V1 workflows unchanged. No new Firestore collections or rules in Phase 2.

**Active phase:** Phase 5 ? Vendor Email Parsing Prototype ?? (Phase 3 gate closed 2026-06-20; Phase 4 gate closed 2026-06-20)

**Phase 5 design (docs):** Johnstone branch invoice PDF import spec ? `docs/vendor-import/johnstone-invoice-import-spec.md` (expected vendor orders; Will-Call / Pickup. labels; not shop receipt).

**Johnstone invoice import Slice 1 (shipped 2026-07-03):** Offline prototype ? `src/dispatcher/invoice/` parses text-extracted invoice pages (fixtures mimic Sioux Falls PDF batch); fulfillment method from explicit PO/Ship Via/header language only (never from backorder lines); backorders drive completeness (`partial` + human review) without assuming future pickup/delivery; fully fulfilled will-call ? `pickup_at_vendor` / **Will-Call / Pickup.**; excludes core/return lines; `npm run test:invoice-parser` ?95% gate (13 fixtures). No upload UI, PDF upload UI, or Firestore writes in this slice.

**Johnstone invoice import Slice 2 (shipped 2026-07-03):** Offline batch pipeline ? `pdfTextAdapter.ts` (page boundaries, multi-page merge, fixture/extraction adapt) + `processInvoiceBatch` / `processInvoiceBatchFromExtracted` (one `importBatchId` per batch, page-level **processed** / **needs_review** / **failed**, spec �11 failure isolation); feeds Slice 1 parser; `npm run test:invoice-batch` ?95% gate. No PDF binary upload UI, Firestore writes, or Cloud Functions.

**Slice 1 (shipped 2026-06-08):** Report Issue from pickup portal (public `createMaterialIssue` CF), warning-only blocking banner, dispatcher open-issue badge + read-only Material Issues panel. Does **not** change `delivery.status` to `issue`; queue rules unchanged.

**Slice 2 (shipped 2026-06-08):** Clear pickup location labels on public pickup (`Pickup at`, `Also check`, `Find it at`, `Shop stock`); hides internal PARTIAL/COMPLETE chips. Display-only ? queue, QR, rules, CF unchanged.

**Vendor portal restyling (shipped 2026-06-11):** Restyled vendor receive portal (`/#/receive`) and PIN gate to visually match the polished `PickupPortalPage` (dark theme, rounded-2xl cards, centered job header, bg-bg-secondary/40 metadata blocks, green check icons, sticky footer). No logic changes.

**Vendor native Camera check-in (shipped 2026-06-11):** Removed in-browser QR scanner from vendor receive (`/#/receive`). Vendors scan package/zone QRs with the phone Camera app; deep links open the portal automatically. Manual delivery ID entry remains on `/#/receive`.

**Single vendor UI (shipped 2026-06-11):** One vendor check-in experience ? `ReceivingPage` at `/#/receive`. Legacy `/#/` and `/#/checkin/:id` redirect to receive. `appSettings.vendorDeliveryMode`: `exception_only` (Scan ? PIN ? Delivered hub) or `full_checkin` (line-item flow) on the same page. Removed `App.tsx` and `CheckInPage.tsx`.

**Exception-only vendor flow (shipped 2026-06-11):** Delivered hub with Need More Space, Issue reporting, and `markVendorDelivered` (status `arrived`, not `ready_for_pickup`). E2E: `npm run verify:vendor-delivered`.

**Evidence model alignment (shipped 2026-06-20):** `markVendorDelivered` records `vendorPhysicalDropoffConfirmed` + invokes `recalculateDeliveryReadiness`; exception-only physical gate without vendor qty; `full_checkin` qty path unchanged. Tests: `npm run test:evidence-alignment`.

**Vendor DELIVERED security (shipped 2026-06-20):** F1/F2 closed ? `markVendorDelivered` CF validates vendor session and writes physical evidence via Admin SDK; Firestore rules deny unauth positive evidence; `recalculateDeliveryReadiness` requires Firebase auth or delivery-scoped vendor session. Tests: `npm run test:mark-vendor-delivered`, `test:firestore-rules`.

**Vendor PIN gate (shipped 2026-06-08):** 4-digit PIN keypad after QR scan on `/#/receive`. `verifyVendorPin` CF validates PIN against order?s vendor; `vendors` collection auth-only read; 15-minute session timeout; audit log in `pinVerificationEvents`. Demo: `vendor-1` PIN `1234` on `delivery-demo-vendor-1`.

**Vendor public-path fix (shipped 2026-06-08):** Unauthenticated vendor receive no longer reads `vendors` for occupancy; `submitCheckin` / `updateStagingLocation` return `getDeliveryDetailsPublic` after write. E2E: `npm run verify:vendor-e2e`. Rules: `additionalStagingLocationIds` allowed on unauth delivery update (deploy rules separately).

**M1 vendor revert hydration (shipped 2026-06-08):** `revertDeliveryStatus` vendor paths (early return + post-commit) route through `hydrateAfterVendorWrite` ? unauthenticated revert no longer calls auth-only `getDeliveryDetails`. Focused security review: PASS. Local verify: vendor-e2e 10/10, pickup PASS.

Phase 2 gate passed 2026-06-08. **Phase 4 gate closed 2026-06-20** ? pickup issue resolution readback + `verify:phase4-integration`. **Phase 3 gate closed 2026-06-19?20** (integration verify + permanent shop-stock mapping). **Batch 3 shipped 2026-06-17?18:** vendor session (Slice 4), pickup tokens (Slice 5), �10?�11 pickup UI, combination staging stub, Phase 4 issue resolve (`away-021`?`041`; see `archives/away-batch-3.json`). **Away batch 047?053 (2026-06-19):** pickup submit label, Phase 5 email panel polish, public network-error UX, resolution-type picker, Phase 4 integration verify, **Phase 5 inbox settings UI** (`away-053`). **Away-054..058 (2026-06-21):** fingerprint dedup, `verify:phase5-email`, correction-to-earlier-email fixture, expanded proposal review detail, drawer READINESS EVIDENCE (read-only). **Away-059 (2026-06-21):** `processInboundVendorEmail` CF ? high-confidence `vendor_order_complete` auto-applies Condition 1 server-side only (`vendorOrderComplete` + confidence + `vendorEmailEvents` audit); conflicts ? review; drawer shows ? Complete / Review Required; tests: `test:process-inbound-vendor-email`, Sonnet security PASS. **Away-060 (2026-06-21):** retired Proposed Email Updates dashboard table; slim Needs Review strip (unmatched/ambiguous only) + collapsed drawer Email Evidence with View Original Email; Deliveries table unchanged. Future email parent-match strategy (Job rollup vs PO rollup) deferred to Phase 6+ Settings ? not implemented in Phase 5.

Phase details and gates: `docs/roadmap.md` (NEXT), `docs/stageverify_v2_architecture.md`, and this file.

---

## Deployment Status

| Environment               | URL                                   | Status                               |
| ------------------------- | ------------------------------------- | ------------------------------------ |
| Production (GitHub Pages) | https://lgarage.github.io/stageverify | ? Live                              |
| Firebase project          | stageverify-db (Blaze)                | ? Active                            |
| Cloud Functions           | us-central1                           | ? Deployed (`autoSubmitDeliveries`, **`createMaterialIssue`** ? Slice 1) |
| Firestore rules           | stageverify-db                        | ? Deployed (includes **`materialIssues` auth-read-only**) |
| ESL / Minew integration   | Planned ? no ESL Cloud Function currently implemented | ?? Live ESL updates blocked on Minew credentials; does not block Phase 2 |

---

## Verified Working Features

| Feature                | Route                       | Actor               | Notes                                        |
| ---------------------- | --------------------------- | ------------------- | -------------------------------------------- |
| Vendor Check-In        | `/#/receive` (canonical)    | Vendor driver       | Scan QR ? PIN ? Delivered hub or full check-in (`vendorDeliveryMode`) |
| Dispatcher Dashboard   | `/#/dispatcher`             | Dispatcher (auth)   | Full delivery list, status, search           |
| Delivery Detail Drawer | (inside dispatcher)         | Dispatcher          | Status changes, staging, shop stock, PO      |
| Staging Assignment     | Settings ? Zones            | Dispatcher          | CRUD zones, occupancy guard                  |
| QR Routing             | Scan any tag                | Any actor           | Zone code ? correct portal based on status   |
| Pickup Portal          | `/#/pickup`                 | Technician (public) | Verify items + shop stock ? Done; Report Issue + **open/resolved issue readback** (resolution type + note) |
| Material Issues (Slice 1) | pickup + dispatcher drawer | Technician + dispatcher | Public callable `createMaterialIssue` (no Firebase Auth); dispatcher **Issues (n)** badge + read-only panel |
| E-Tag / Zone Labels    | `/#/zones` (Print)          | Dispatcher          | Minew ESL QR + print label                   |
| Vendor Management      | `/#/vendors`                | Dispatcher (auth)   | CRUD vendors                                 |
| Zone Management        | `/#/zones`                  | Dispatcher (auth)   | CRUD staging locations                       |
| App Settings           | `/#/settings`               | Dispatcher (auth)   | Revert window, auto-submit timer, ESL tag ID |
| Auto-Submit            | Cloud Function              | System              | Submits after inactivity timeout             |
| Status History         | (inside drawer)             | All                 | Audit trail per delivery                     |
| Need More Space        | Vendor Delivered hub + done | Vendor              | Tiered overflow staging (shelf / ground / oversized) |

---

## Known Issues

| #   | Description                                                                                                                                                          | Severity | Blocked by                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------- |
| 1   | ESL Minew tag updates not live                                                                                                                                       | High     | Waiting on Minew vendor credentials          |
| 2   | No shop physical map ? location IDs unassigned                                                                                                                       | Medium   | Waiting on Jake Korb shelving decision       |
| 3   | `listDeliveries` loads full collections in memory (no Firestore pagination)                                                                                          | Medium   | Technical debt ? acceptable at current scale |
| 4   | `autoSubmitDeliveries` CF misses `shipped` status (only handles `arrived`)                                                                                           | Low      | Minor scope gap                              |
| 5   | Received-but-unstaged material can be physically present in the shop with no last-known location recorded ? technicians and office staff struggle to find it (e.g. Amazon/UPS drops on the office counter). | Medium   | Phase 2 optional field recommendation (`currentLocationNote`); capture UI is Phase 3+ |

---

## Open Risks

| Risk                                                                | Impact               | Likelihood          |
| ------------------------------------------------------------------- | -------------------- | ------------------- |
| Minew API credential delay blocks ESL demo                          | High (demo blockers) | High (waiting)      |
| No vendor email processing ? V2 AI workflow depends on it           | High (V2 roadmap)    | Low (future phases) |
| Data model migration (V2 fields) may break existing Firestore reads | Medium               | Medium              |
| Feature creep pulling toward ERP/inventory                          | High                 | Medium              |

---

## Technical Debt

| Item                                                          | File                     | Notes                                                                    |
| ------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------ |
| Full-collection reads on `listDeliveries`                     | `firestoreService.ts`    | No server-side filter/sort. Scales to ~500 items today.                  |
| `autoSubmitDeliveries` CF has duplicate `DeliveryStatus` type | `functions/src/index.ts` | Should import from shared types in V2                                    |
| Vendor check-in consolidated to `ReceivingPage`               | `src/ReceivingPage.tsx`  | Legacy `App.tsx` / `CheckInPage` removed; single UI at `/#/receive`      |
| No error boundary on public portals                           | All portal pages         | Silent failures on network errors                                        |
| `shopStockPickListItems` is a free-text array                 | `models.ts`              | Phase 3+: structured shop-stock pickup UI; not inventory balances        |
| `shopStockPickListItems` has no location structure            | `models.ts`              | Phase 2 may add optional per-`Item` `materialSource` / location fields on models only |

---

## Reusable Components for V2

| Component                                      | Current Role                    | V2 Role                                                                                             |
| ---------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `DeliveryOrder` model                          | Core tracking entity            | **Phase 2:** optional `materialOwner`, `readinessStatus`, `currentLocationNote`, `availabilityStatus`. No breaking changes. |
| `Item` model                                   | Line-item tracking              | **Phase 2:** optional `materialSource` (primary placement), `currentLocationNote`, `availabilityStatus`. **Phase 5+:** `partClassification`, `vendorEmailEventId` (conceptual until email phase). |
| `StatusHistoryEvent`                           | Audit trail                     | **Reuse as-is** ? operational transitions and concise timeline summaries; `actorType: "system"` for automated events. Detailed `AICorrection` records are separate (conceptual; persistence Phase 8). |
| `PickupEvent`                                  | Technician pickup record        | **Phase 3+:** `issueIds[]` linkage. Phase 2: type stub only if gate requires.                       |
| `firestoreService.ts`                          | Data access layer               | **Phase-gated:** new root-level collections and helpers only when the active phase gate requires them; extend existing flat layout (same as V1), do not restructure. Not all V2 collections in Phase 2. |
| `DispatcherDashboardPage`                      | Delivery list + management      | **Phase 3+:** Material Issues and Readiness columns/views. Phase 2: no UI changes.                  |
| `PickupPortalPage`                             | Technician pickup               | **Phase 3:** Report Issue flow. Phase 2: unchanged behavior.                                        |
| `QR routing`                                   | Status-aware scan routing       | **Reuse as-is** in Phase 2 ? preserve compact hashes, public portals, legacy parsing. Readiness-aware routing is Phase 4+; a `not_ready` route target is possible but not a confirmed design. |
| `StatusHistory`                                | Status audit trail              | **Reuse** for transitions; may reference or summarize AI actions. Does not replace dedicated correction records (Phase 8). |
| `Vendor` model                                 | Vendor entity                   | **Phase 6+:** `emailDomain` (live email monitoring ? not a Phase 5 Vendor UI concern). Phase 5 = offline prototype with controlled sample emails only; a conceptual optional field may be introduced earlier only if the Phase 2 gate explicitly requires it. **Phase 8+:** `knowledgeBaseRef` (conceptual). Not Phase 2. |
| `PortalSidebar`                                | Dispatcher nav                  | Potential future enhancement (Phase 4+). Not required for Phase 2.                                  |
| `shopStockPickListItems` (DeliveryOrder field) | Free-text shop stock pull list  | **Phase 3+:** extended structured pickup UI. Shop stock = what to pull, where to find it, whether picked up ? not stock-on-hand or reorder. |
| `stagingLocationId` (Assigned Location)        | Target staging zone on delivery | **Keep** as Assigned Location. **Phase 2 (optional):** `currentLocationNote` recommendation for Current Location ? distinct field, distinct question. |

---

## Immediate Next Steps

1. **away-127** — Invoice Slice 3: PDF upload + client parse preview.
2. **Deploy inbound Gmail ingestion** ? `firebase deploy --only functions,firestore:rules` after Pub/Sub setup.
3. **Post-deploy:** reconnect Gmail if needed; watch registers on OAuth connect. Fallback poll: `syncInboundGmail` every 30 min.
4. **ESL integration** ? Phase 7; blocked on Minew credentials.
5. **Shop map / Jake Korb shelving** ? blocks real combination location IDs in production.

### Gmail push ingest ? Dan GCP checklist

| Step | Action |
|------|--------|
| 1 | Create Pub/Sub topic **`gmail-inbox-notifications`** in project **`stageverify-db`**. |
| 2 | Grant **`roles/pubsub.publisher`** on that topic to **`gmail-api-push@system.gserviceaccount.com`**. |
| 3 | Set Firebase secret: `firebase functions:secrets:set GMAIL_PUBSUB_TOPIC` ? `projects/stageverify-db/topics/gmail-inbox-notifications` |
| 4 | Deploy: `firebase deploy --only functions,firestore:rules --project stageverify-db` |
| 5 | Reconnect Gmail in Settings (registers `users.watch` + initial sync). Callable **`registerGmailWatchCallable`** available for manual re-register. |
| 6 | **`renewGmailWatch`** runs daily (~7-day watch expiry). **`gmailInboxPushIngest`** is primary ingest; **`syncInboundGmail`** polls every 30 min as fallback. |

No manual push subscription to Cloud Functions ? Firebase Eventarc subscribes to the topic when **`gmailInboxPushIngest`** deploys.

**Canonical ingest inbox:** `svbotmail@gmail.com` (CC vendor order emails; OAuth mailbox should match or forward to it).

---

## Recently shipped (away)

**Vendor Communications hub (2026-07-06, v0.0.16)** — Dispatcher Dashboard top bar **Vendor Communications** button opens compose modal (to/subject/body, optional vendor + delivery association). Calls `sendVendorEmail` with optional `deliveryOrderId`/`vendorId` (general path allows any recipient for dispatcher testing). Stage 1 tracking preserved ([SV-*] tag, Reply-To, outbound `vendorEmailEvents`). Resolve Issue flow unchanged. Verify: `verify:dispatcher-nav`, `test:send-vendor-email`.

**Stage 1 tracked vendor email layer (2026-07-06, v0.0.15)** — Outbound `sendVendorEmail`: UUID `[SV-*]` subject tag, plus-address Reply-To, RFC Message-ID capture, `requireDispatcherAuth`. Inbound: extended header parse, flag-gated reply router in `no_pdf` branch (`appSettings.emailReplyIngestEnabled`, default off), deterministic matching ladder, `vendorEmailEvents` inbound docs (review-only, no delivery mutation). Needs Review strip reads live pending inbound events. **Dark-shipped** until Dan enables flag + completes Pub/Sub checklist. Verify: `test:email-thread-matching`, `test:vendor-email-reply-router`, `verify:inbound-email-ingest`.

**Pre-ingest reply matching hardening (2026-07-06, v0.0.22)** — Canonical footer Ref extraction only (after `\n\n---\n`); quoted/forged body refs cannot override thread/header/plus/subject matches; conflicts → `humanReviewRequired` with explicit reasons; `bodyToken` always weak fallback; SPF/DKIM fail + forged ref flagged. Ingest flag still off. CF deploy: `syncInboundGmail`, `gmailInboxPushIngest`, `triggerInboundGmailSyncCallable`.

**Firestore doc id merge + prod demo row hide (2026-07-05, v0.0.14)** ? `fetchAll`/`fetchWhere` merge Firestore doc id into returned objects (fixes dispatcher drawer when body omits `id`); seed demo deliveries ORD-001..006 hidden from `listDeliveries` on prod gh-pages only (`import.meta.env.PROD`). Invoice shells (4046362 etc.) unchanged. Verify: `npm run build`, `verify:delivery-consistency`, `verify:dispatcher-nav` prod.

**Remove Installed overview filter; Picked Up ? Complete (2026-07-05, v0.0.12)** ? Delivery Overview no longer shows Installed summary tile or filter chip; picked_up (and legacy installed) rows count in Complete tile and match Complete filter; Delivered filter unchanged. Verify: `test:invoice-shell-display`, `verify:dispatcher-nav` local+prod.

**Deliver-to-site UI cascade (2026-07-05, v0.0.4)** ? Mark delivered to site now receipts all line items in Firestore (`qtyReceived = qtyOrdered`) and display helpers treat confirmed site delivery as full receipt: Delivery Status **Delivered**, Items Recv. **43/43**, Issue Summary **Delivered to {site}** (overrides Pickup Scheduled), drawer item rows received, status badge green Delivered. Clear confirmation resets item receipt. Verify: `test:invoice-shell-display`, `verify:dispatcher-nav` local+prod.

**Deliver-to-site confirmation (2026-07-04, v0.0.3)** ? Dispatcher drawer Issue Summary: read-only deliver-to label, Mark delivered to site / Not yet delivered; persists `invoiceDeliverToSiteConfirmed` + timestamp/actor; list Issue Summary + Complete column wait on confirmation. Verify: `test:invoice-shell-display`, `verify:dispatcher-nav`.

**Dispatcher dashboard fixes (2026-07-04)** ? Removed View Invoice PDF from drawer/modal; PO # fallback via `resolveDeliveryPoNumber` (`customerPoOrReference`); Complete column counts complete deliveries (not staged). Verify: `npm run test:invoice-shell-display`, `verify:dispatcher-nav`.
**Gmail push ingest + svbotmail (2026-07-04)** ? Primary ingest: `gmailInboxPushIngest` (Pub/Sub from `users.watch`), watch on OAuth connect + daily `renewGmailWatch`. Fallback poll `syncInboundGmail` every 30 min. Canonical bot inbox **`svbotmail@gmail.com`**. Verify: `npm run verify:inbound-email-ingest`. Deploy after Dan configures `GMAIL_PUBSUB_TOPIC` + topic IAM.

**Inbound Gmail invoice ingest foundation (2026-07-04)** ? M1+M2 code: PDF text extract (`pdf-parse`), `inboundEmailProcessing` + `vendorInvoiceImports` review queue, Johnstone parser wired review-only (no delivery writes). Callable inspect: `listInboundEmailProcessing`, `getInboundEmailProcessing`, `listVendorInvoiceImports`.

**Option A ? issue-import queue (2026-07-04)** ? Parses with `importStatus: issue` (e.g. S/O confirmation missing Invoice #) now write `vendorInvoiceImports` review rows with parsed lines + issue reason; Approve blocked server-side + UI; Reject allowed. Refresh Now (`retryOnError`) backfills legacy parsed emails with 0 queued invoices. Verify: `verify:inbound-email-ingest`, `test:retry-on-error-inbound`, `verify:invoice-review`.

**away-084 (2026-07-03)** ? Mini-librarian phase 3: `PROJECT_STATUS/gotcha-map.json` maps task triggers to composer-orchestrator steps 6?8 (MODEL_DOSSIER index, � agent-lessons, USER_SCOPE_REJECTIONS). New `npm run context:gotcha -- --task "<?>"` CLI (JSON/markdown); validated in `away:validate`. Corrects prior mislabel ? drawer UI work was never librarian scope. Verify: `away:validate`, `build`.

**away-086 (2026-07-03)** ? Mini-librarian phase 3: rotated QR confidence, session confidence, and outcome log tables from `MODEL_DOSSIER.md` to `archives/dossier-notes.md`; trimmed warm dossier to 134 lines; updated `dossier-index.json` line ranges. Verify: `dossier:slice --tag agent-lessons`, `away:validate`, `build`.

**away-085 (2026-07-03)** ? Mini-librarian phase 3: `npm run context:packet -- --tags <tags>` (hot tier + dossier � slices + optional `--queue`); `npm run away:next -- --packet` merges queue brief + blocker one-liner + tag slices. Shared lib `context-packet-lib.mjs`. Verify: `away:validate`, `build`.

**away-083 (2026-07-03)** ? Mini-librarian phase 3: `away:ship` + `away:validate` auto-sync `docs/project_state.md` Immediate Next Steps #1 with queue head (same rule as CURRENT_STATE + NEXT.md). Helpers in `away-memory-lib.mjs`. Verify: `away:validate`, `build`.

**away-087 (2026-07-03)** ? Verified Action 1: `buildNextBrief()` readFirst omits `svscope_simple.md` unless `scopeDispute`; `itemScopeDispute()` adds svscope on flag or scope string. Verify: `away:validate`, `build`.

**Short pickup clipboard (2026-07-03)** ? Copy Pickup Information clipboard is a short handoff: StageVerify Pickup heading, job/vendor/PO/order identifiers, staging location (or Not assigned), and secure pickup checklist link only ? no status, item list, or received qty lines (checklist link is source of truth). Verify: `verify:delivery-consistency` asserts short format on demo ORD-001..006 (393 checks).

**Settings Gmail mailbox UI (2026-07-03)** ? When Gmail OAuth is connected, Settings Email Monitoring shows one **Gmail Mailbox** section: connected account (read-only), status, monitoring enabled/disabled, Disconnect, and a processing toggle (does not change mailbox address). `monitoringInboxEmail` auto-syncs from `connectedAccountEmail` on connect/load. Disconnected state keeps editable inbox + Connect Gmail. Verify: `verify:email-oauth-connect`, `verify:settings-staging`.

**Drawer email review CTA (2026-07-03)** ? When vendor email proposal needs dispatcher review (e.g. ORD-006), **What Needs Attention** shows primary **Review Vendor Email** button; scrolls to Readiness Evidence and expands matched email proposal cards (not Vendor Communications). Verify: `verify:delivery-consistency` ORD-006 assertions + `verify:phase5-email`.

**Dispatcher staging-action rows (2026-07-03, tightened)** ? Display-only: any delivery with missing staging (regardless of received qty or status; `installed` exempt) gets dark-orange `dispatcher-action-required` table row + Issue Summary **Assign staging location** first. Drawer readiness unchanged. Verify: offline gate + live Staging Loc. column in `verify:delivery-consistency`.

**Fast UI pass (2026-06-24)** ? Delivery label modal closes on outside click / Escape; primary action renamed **Push to E-Tag** (copy only). Activity History: collapse repeated entity/status events in compact view; **Show Full History** shows raw audit list. List **Issue Summary** column prioritizes **Pickup Scheduled** when delivery is ready and job is scheduled (display-only). Verify: `verify:delivery-consistency` (361 checks).

**Demo drawer uniformity (2026-06-24)** ? All seed/demo orders (ORD-001..006) use the same dispatcher drawer structure as ORD-005: Delivery Basics (no top notes) ? pickup pills + 2�2 action grid ? staging banner when unassigned ? status banner ? Issue Summary ? Readiness Evidence ? Assign Staging Location ? Advanced Manual Controls (collapsed) ? Experimental Stock Tools (collapsed) ? Items ? Activity History. Vendor Communications, Recently Resolved, Need More Space, workflow status pill, and PO editor hidden globally (`DRAWER_HIDE_*`). Verify: `verify:delivery-consistency` loops all demo orders.

**Drawer lower-section UI (mislabeled away-084, 2026-06-24)** ? Items show neutral "Not received yet" at qty 0 (not green pickup-ready); Pickup Summary hidden when 0 received; Status History renamed **Activity History** (collapsed default, max 3 friendly events, Show Full History audit expand); Delivery Notes compact above history. Display-only via `deliveryDisplayHelpers.ts`. Verify: `verify:delivery-consistency`.

**Drawer top cleanup (2026-06-24)** ? Delivery Basics shows Job #, Job Name, Order #, Vendor, PO #, Staging only (notes moved to Activity History audit read-only); pickup scheduled + active link expiry combined in compact pill inside action grid (no floating line below buttons); 2�2 button grid unchanged. Verify: `verify:delivery-consistency`, `verify:dispatcher-nav`, `test:readiness` �3.

**away-075 (2026-06-23)** ? Mini-librarian planning path dedup (Action 2): Scout A runs `away:next --minimal` first; skip scouts when queue head answers; index-only MODEL_DOSSIER in scout table; suggestion-verify reuse clause. Verify: `away:validate`.

**away-074 (2026-06-23)** ? Copy Pickup Information token validity: validate sessionStorage token via `validatePickupTokenClient` before reuse; generate fresh token when stale/revoked; drawer hint when active link exists without local plaintext; `verify:dispatcher-nav` ORD-005 copy/revoke/regen flow.

**Drawer clarity pass (2026-06-23)** ? Dispatcher drawer top answers delivery/next-step questions: Issue Summary **Open Issues** accordion with dispatcher-readable explanations; **What Needs Attention** banner (headline + Why + Next Step bullets); Resolve Issue disabled with reason when no blocking material issue; Call/Email Vendor + Review Issues buttons. Display-only via `deliveryDisplayHelpers.ts` ? no readiness/Firestore changes. Verify: `verify:delivery-consistency`, `test:readiness`, `test:demo-matrix`, `away:validate`.

**away-073 (2026-06-23)** ? Readiness model alignment: partial only when anyReceived>0 (client + CF `deliveryReadiness`); list filter/count uses computed readiness via `computeDeliveryDisplayState` (`5ba4e0f` wiring audit); unit-based display counts + Pending Delivery label (`4cf65a8`); demo matrix regression script. Verify: `test:readiness-two-source`, `test:demo-matrix`, `verify:delivery-consistency`. CF deployed.

**away-072 (2026-06-23)** ? Delivery drawer exception-management UX: new **Issue Summary** panel (status lines, color-coded issue table, collapsible Received Items); **Action Required** deduped (high-level blockers + Recommended Actions, no item-level missing list); section order Issue Summary ? Action Required ? Delivery Basics ? Readiness Evidence ? Material Issues ? Vendor Communications. Reuses `deliveryDisplayHelpers.ts` shared truth. Verify: `verify:delivery-consistency`, `verify:dispatcher-nav`.

**away-068 (2026-06-22)** ? Phase 6 slice 2: Outbound `sendVendorEmail` CF (Gmail API send via OAuth refresh token); Email Vendor enabled in Resolve Issue when `emailProviderConnected`; `vendorEmailEvents` outbound audit (`need_more_information`); Vendor Communications drawer lists outbound messages for delivery. Added `gmail.send` OAuth scope ? **reconnect Gmail in Settings** after deploy. Sonnet security PASS (LOW; CRLF header hardening). Verify: `verify:email-oauth-connect`, `verify:phase5-email`, `verify:dispatcher-nav`. **Not built:** reply sync, push/watch, inbound auto-ingest (away-069).

**away-067 (2026-06-22)** ? Phase 6 slice 1: Gmail OAuth connection state. CFs `initiateGmailOAuth`, `completeGmailOAuth`, `disconnectGmailOAuth`; `emailProviderConnections/gmail` metadata + admin-only `emailProviderSecrets`; Settings Connect/Disconnect + status badge; `emailProviderConnected` true only when `status === connected`; Vendor Communications empty copy by connection; connect/disconnect audit only. **Final verification (2026-06-22):** prod disconnect PASS; Connect initiates Google OAuth redirect (manual Gmail consent required for full connect/refresh/re-login cycle); CF debug logging removed; `trimSecret()` safeguard kept on secret reads. Verify: `verify:email-oauth-connect`, `verify:phase5-email`, `verify:settings-staging`. Secrets: `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_REDIRECT_URI`.

**away-066 (2026-06-21)** ? Phase 6 foundation: `VendorEmailEvent` direction/purpose/outbound audit types; read-only **Vendor Communications** drawer placeholder (empty until provider connected). Email Vendor stays disabled until real OAuth. Verify: `verify:dispatcher-nav`, `verify:phase5-email`.

---

## Archived draft (shipped as away-068)

**away-068 ? Phase 6 slice 2: Outbound `sendVendorEmail` + enable Email Vendor** ? shipped 2026-06-22.

---

## Archived draft (shipped as away-067)

**away-067 ? Phase 6 slice 1: Gmail OAuth connection state (no send, no watch)** ? shipped 2026-06-22.
