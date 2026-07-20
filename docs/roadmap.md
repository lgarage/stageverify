# StageVerify Roadmap (V2) - C:\Projects\stageverify\docs\roadmap.md

> **Format:** NOW / NEXT / LATER / MAYBE — aggressive prioritization for Composer and technical leads  
> **Authority chain:** **`PROJECT_STATUS/svscope_simple.md`** = product vision (everything hinges on this; scope § wins on conflict) → `docs/project_state.md` = canonical phase truth (features, deployment, known issues, current phase) → **`docs/roadmap.md` (this file)** = V2 phase prioritization and gates for agents; maps every scope § to a phase → `PROJECT_STATUS/CURRENT_STATE.md` = hot-tier snapshot (~30 lines; pointers only); `docs/archives/stageverify_implementation_plan.md` = **historical reference only** — not active agent guidance. Memory-system audit (archived): `PROJECT_STATUS/archives/MEMORY_ARCHITECTURE_ASSESSMENT.md`.  
> **Scope:** This file summarizes priorities and gates — it is not a detailed implementation plan and must not drift into one.  
> **Last updated:** 2026-07-11 (Location-first Phase 4 gate closed — `v0.0.33` away-118..121 + away-123 + prod verify)

> **BuildOps boundary:** StageVerify does not replicate BuildOps. BuildOps owns: inventory counts, stock levels, reorder points, purchasing. StageVerify owns: material readiness, material location, pickup verification, material issues, vendor accountability.

> **Product scope authority:** `PROJECT_STATUS/svscope_simple.md` — canonical end-to-end product design. **All work must trace to scope § here.** This roadmap maps every scope section to a phase so nothing is dropped. When scope and phase tables disagree, **scope wins**; update this file.

---

## Product scope traceability (`svscope_simple.md`)

| Scope § | Topic | Phase / bucket | Status |
| ------- | ----- | -------------- | ------ |
| **§1** | Dispatcher creates job, PO, delivery, staging; per-vendor/PO/delivery separation | Phase 1–2 | ✅ Built |
| **§2** | Entry display shows assigned location for arriving vendor | Phase 1 + Phase 7 ESL | ✅ Display built; live E-tag updates Phase 7 (Minew blocked) |
| **§3** | Delivery QR + shared vendor PIN; scoped to one delivery only | Phase 1–2 + vendor flow 2026-06-11 | ✅ Built |
| **§3** | Temporary vendor session + configurable expiration + server validation | **Phase 3 Slice 4 — Vendor access hardening** | ✅ Shipped (`away-021`…`023`) |
| **§3** | Shop geofence as additional vendor control | **Phase 3 Slice 4 — Vendor access hardening** | 🔵 Shipped warn-only (`away-024`; enforce optional) |
| **§4** | Vendor actions: DELIVERED, Need More Space?, Issue (simple hub) | Vendor exception-only 2026-06-11 | ✅ Built |
| **§4** | DELIVERED ≠ Ready for Pickup; vendor does not count material | Trusted readiness CF `b7b817f` | ✅ Shipped prod |
| **§5** | Two-source readiness gate (vendor order + physical/staging) | `recalculateDeliveryReadiness` CF `b7b817f` | ✅ Shipped prod |
| **§5** | Condition 1 — configurable inbox, vendor email evidence, untrusted parsing | **Phase 5** (prototype) → **Phase 6** (live inbox) | ⬜ Deferred |
| **§5** | Email cannot directly force Ready for Pickup; server rules decide | Phase 5–6 gates + principles | ⬜ Policy defined; automation not built |
| **§5** | Per-delivery / per-PO / per-job readiness separation | Phase 2 model + CF `b7b817f` | ✅ Core logic shipped; job-level “all ready” UI Phase 3 remainder |
| **§6** | Dispatcher readiness view: ready / partial / issue / picked up / job-all-ready | **Phase 3 Slice 3 — Dispatcher readiness & scheduling** | ✅ Shipped (job/PO/delivery breakdown + Everything Ready gate) |
| **§7** | **Pickup Scheduled** state after BuildOps scheduling | **Phase 3 Slice 3 — Dispatcher readiness & scheduling** | ✅ Shipped (dispatcher toggle + badge) |
| **§8** | **Copy Pickup Information** (site, job, locations, link → clipboard) | **Phase 3 Slice 3 — Dispatcher readiness & scheduling** | ✅ Shipped |
| **§9** | Technician opens pickup link — no login | Phase 1–3 public pickup portal | ✅ Built (job/delivery hash params) |
| **§9** | Opaque, unguessable, revocable, server-validated **pickup token** | **Phase 3 Slice 5 — Pickup link security** | ✅ Shipped (`away-025`…`027`; `away-028` geofence reminder deferred) |
| **§10** | Pickup list grouped by physical location; PO / item / qty / status lines | **Phase 3 remainder — Technician pickup UI** | 🔵 Shipped (`away-029`…`032`: header, location sections, PO labels, checklist persist) |
| **§11** | Shop stock on pickup page (vendor + shop in one experience) | **Phase 3 remainder — Shop stock pickup** | 🔵 Shipped (`away-018`, `away-033`…`035`: pull states, Running Low, location group) |
| **§11** | Combination stock locations (e.g. G15–G17); running-low alert | **Phase 3 remainder** + shop map blocker | 🔵 Model + CF release stub shipped (`away-036`/`037`); real shop-map IDs blocked |
| **§12** | **Order Pickup Complete** submit; server-owned transactional pickup | `recordPickupEvent` CF `b7b817f` | ✅ Shipped (UI says “Done — All Picked Up”) |
| **§12** | Idempotent / concurrent-safe pickup | `recordPickupEvent` + `pickupOperations` `b7b817f` | ✅ Shipped prod |
| **§12** | Blocking issue vs pickup behavior (UI says can complete; CF may block) | **Phase 3 bugfix / alignment** | ✅ Aligned (`away-009`) |
| **§12** | Leave-shop geofence reminder (best-effort; not auto-complete) | **Phase 3 Slice 5 — Pickup link security** (optional) | ⬜ Not built |
| **§13** | Dispatcher sees pickup update, qty remaining, pickup events | Phase 3 Slice 1 + drawer | 🔵 Shipped (`away-038` pickup-summary-panel) |
| **§13** | Release temporary staging → Available + E-tag clear | **Phase 3 Slice 6 — Staging release** | 🔵 Partial — CF clears `stagingLocationId` + `additionalStagingLocationIds` on full pickup (`away-019`); combination groups + ESL Phase 7 |
| **§13** | Permanent shop-stock locations stay reserved; qty tracking not inventory | Phase 3 Slice 6 | ✅ Shipped 2026-06-20 |
| **§14** | End-to-end flow (27 steps) | Cross-phase integration test | ⬜ Full flow not gate-passed |
| — | **Firebase App Check** on public writes | **Cross-cutting security (LATER)** | ⬜ Explicitly deferred |
| — | **Gmail / live inbox connection** | Phase 6 only (after Phase 5 prototype) | ⬜ Deferred |

---

## Location-first transition (`docs/location-first-transition-spec.md`)

| Phase | Status | Notes |
| ----- | ------ | ----- |
| **1** Groundwork | ✅ Complete 2026-07-08 (`v0.0.25`) | ESL plan rejects occupancy-dynamic QR-flip; additive types; job-level pickup clipboard; permanent URL locked `#/s?loc={code}` |
| **2** Privacy hardening | ✅ Complete 2026-07-08 (`v0.0.26`) | Rules auth-only reads; session/token CF mediation; `verify:privacy` |
| **3** Permanent location scan v2 | ✅ Core slice 2026-07-08 (`v0.0.27`) | `#/s?loc=`, job-scoped PIN (D14), sign generator (software); sign **printing** blocked on shop map |
| **4** Vendor exceptions + dispatcher planning | ✅ Complete 2026-07-11 (`v0.0.33`) | `verify:location-phase4` 15/15 local + prod; release CF + G1 E2E |
| **5** Technician door + pickup v2 | ⬜ Not started | Fable work-verifier gate; per spec tracker |
| **6** Management audit | ⬜ Not started | Sonnet-gated; per spec tracker |

---

## NOW (Phase 5 prototype)

**Phase 5 — Vendor Email Parsing Prototype** — active per `CURRENT_STATE.md` (Phase 3 + Phase 4 gates closed 2026-06-20). Phase 2 gate passed 2026-06-08.

### Phase 2 — Material Readiness Data Model

| Item    | Deliverable                                                                                                                                                                                                                                                                                                                                     |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **2.1** | Extend `src/dispatcher/models.ts` with V2 types and optional fields. No breaking changes to existing interfaces or Firestore documents.                                                                                                                                                                                                         |
| **2.2** | Add Material Readiness concepts: `readinessStatus` (`ordering` / `not_ready` / `ready_for_pickup` / `picked_up`), `materialOwner`, `expectedMaterials`, and structured shop stock definitions (interface stubs only; structured pickup UI is Phase 3+).                                                                                                                                                  |
| **2.3** | Add V2 location concepts: **Assigned Location** (existing `stagingLocationId`) and **Current Location** (`currentLocationNote`). Assigned Location = where material should be staged. Current Location = where material actually is right now. StageVerify must answer both: "Where should this material be?" and "Where is this material now?" |
| **2.4** | Add material tracking concepts: `materialSource` (`vendor_delivery` / `shop_stock` / `direct_shipment` / `unknown`) and `availabilityStatus` (`expected` / `received` / `picked_up`). `materialSource` belongs primarily at the individual `Item` or material-line level — a single delivery may contain mixed sources. Physical location is captured separately via `currentLocationNote` (an attribute, not a lifecycle state): material can simultaneously be received + located (via note) + not-staged + not-ready. Pickup-accountability data only — not inventory tracking (see recommendations block). |
| **2.5** | Add **interface definitions only** (stub types) required for future phases: `MaterialIssue`, `IssueResolution`, `VendorEmailEvent`, and `AICorrection`. No implementations of issue workflows, email ingestion, AI parsing, or knowledge-base logic in Phase 2.                                                                                  |
| **2.6** | Plan Firestore collection names (`materialIssues`, `vendorEmailEvents`, `aiCorrections`, `vendorKnowledge`) and define interfaces only. Implement persistence helpers or create collections **only if the Phase 2 gate explicitly requires them** — not speculatively ahead of the gate.                                                          |
| **2.7** | Update mock/seed data if present. Existing workflows and routes continue working without regressions: vendor check-in, dispatcher drawer, pickup completion, zone QR routing, public portals, existing Firestore records, and legacy QR behavior.                                                                                                |
| **2.8** | Firestore rules: additive only. No changes that require migration of existing production data. If new collections are introduced, run **Sonnet 4.6 security gate** per project conventions before push.                                                                                                                                        |

**Phase 2 data model — recommendations to evaluate before implementation begins:**

StageVerify V2 tracks distinct dimensions — do not collapse them into a single lifecycle state:

| Dimension | Field / concept | Answers |
| --------- | --------------- | ------- |
| Business readiness | `readinessStatus` / `DeliveryStatus` | Is the overall package ready for pickup? |
| Physical receipt | `availabilityStatus`: `received` | Has material arrived at the facility? |
| Staging state | Assigned vs current location | Has received material reached its assigned staging zone? |
| Assigned location | `stagingLocationId` | Where material _should_ be staged |
| Current location | `currentLocationNote` (recommended) | Where material _actually is_ right now |
| Pickup confirmation | `PickupEvent` | Did the technician confirm pickup? |

**Assigned Location** = existing `stagingLocationId` (where material should be staged). **Current Location** = last known physical location (e.g. "Office Counter" when not yet staged).

**Material sources:** `materialSource` belongs primarily at the individual `Item` or material-line level (`vendor_delivery` | `shop_stock` | `direct_shipment` | `unknown`). A single delivery may contain mixed sources — vendor-delivered items, shop-stock pulls, and direct shipments in the same package. StageVerify is not an inventory system; `materialSource` is pickup-accountability data only (what to pull, where to find it, whether it was grabbed) — not stock-on-hand or reorder logic.

**`availabilityStatus`:** `expected` | `received` | `picked_up`. Physical location is captured separately via `currentLocationNote` (an attribute, not a lifecycle state) — material can simultaneously be `received` + located (via `currentLocationNote`) + not-staged + not-ready-for-pickup; these dimensions answer different questions and are **not** mutually exclusive lifecycle states.

**Shop-stock pull states (Phase 3 UI concern — not a Phase 2 gate commitment):** Not Pulled / Pulled / Staged may help the technician pickup view answer "what do I still need to grab?" Phase 2 does not commit to a final shop-stock state machine.

Recommended optional fields to evaluate:

- `currentLocationNote` on `DeliveryOrder` and/or `Item` — last known physical location (Current Location); presence/content answers "where is it?" — not an `availabilityStatus` value
- `materialSource` on `Item` (primary) — `vendor_delivery` | `shop_stock` | `direct_shipment` | `unknown`; per-line source within a mixed delivery
- `availabilityStatus` — `expected` | `received` | `picked_up`

_These fields are recommendations to evaluate at gate review — not committed schema until Phase 2 implementation begins._

**Success criteria (gate):**

- [x] `npm run build` passes
- [x] Existing workflows and routes continue working without regressions: vendor check-in, dispatcher drawer, pickup completion, zone QR routing, public portals, existing Firestore records, and legacy QR behavior
- [x] New fields optional on documents; no required migration of production data
- [x] `docs/project_state.md` updated to Phase 2 complete
- [x] Playwright: `verify:pickup`, `verify:receive`, `verify:dispatcher-nav` (or equivalent) pass

**Known blockers:**

| Blocker               | Affects       | Notes                                                              |
| --------------------- | ------------- | ------------------------------------------------------------------ |
| None for Phase 2 code | —             | Architecture docs ✅ complete (2026-06-05); ESL/Minew integration is planned; live ESL updates blocked on Minew credentials; no ESL Cloud Function currently implemented; does not block Phase 2 |

**Pre-Phase-2 documentation (NOW-adjacent):**

- [x] Principles doc exists (`docs/stage_verify_principles.md`)
- [x] V2 architecture doc (`docs/stageverify_v2_architecture.md`) — complete
- [x] Transition report (`docs/v2_transition_report.md`)
- [x] This roadmap (V2 prioritization for agents)
- [x] Archived implementation plan (`docs/archives/stageverify_implementation_plan.md`) — historical reference only

---

## NEXT

**Active phase: Phase 3 — Technician Pickup Workflow** (permanent shop-stock mapping shipped 2026-06-20; full Phase 3 gate closed)

Phase 2 gate passed 2026-06-08. **Phase 4 gate closed 2026-06-20** (pickup resolution readback + `verify:phase4-integration`). **Active away queue** may prioritize work ahead of phase gates — see `PROJECT_STATUS/CURRENT_STATE.md` + `npm run away:next`.

### Phase 3 Slice 1 — Report Issue + dispatcher visibility ✅ (shipped 2026-06-08)

| Item | Status |
| ---- | ------ |
| Report Issue (pickup portal) | ✅ Modal + `createMaterialIssue` callable CF |
| Blocking behavior | ✅ Warning banner only — **Done flow unchanged**; no `delivery.status → issue` |
| Dispatcher visibility | ✅ `Issues (n)` badge + read-only Material Issues panel |
| Firestore | ✅ `materialIssues` auth-read-only; indexes; denormalized counts on delivery |
| Verify | ✅ `verify:pickup` (Scenarios A+B), `verify:material-issue-dashboard`, fixture resets |
| Sonnet security gate | ✅ PASS WITH NOTES (counter-in-transaction, scoped `clientRequestId`) |

**Slice 1 follow-ons shipped:** expected-materials (`away-016`), shop-stock pull states (`away-018`), ready-only queue (`away-014`).

### Phase 3 Slice 2 — Clear pickup locations ✅ (shipped 2026-06-08)

| Item | Status |
| ---- | ------ |
| Pickup location labels | ✅ `Pickup at` / `Also check` / `Find it at` / `Shop stock` on public pickup cards |
| Status display | ✅ Hide internal PARTIAL/COMPLETE chips; show `Ready for pickup` only when `ready_for_pickup` |
| Scope | ✅ Display-only — no queue, rules, CF, or write-path changes |
| Verify | ✅ `verify:pickup` full/minimal location display + Scenarios A+B |

### Vendor — single UI + exception-only flow ✅ (shipped 2026-06-11)

| Item | Status |
| ---- | ------ |
| Canonical route | ✅ `ReceivingPage` at `/#/receive` only |
| Legacy redirects | ✅ `/#/`, `/#/checkin/:id`, `#/r?` → receive |
| Exception-only hub | ✅ `appSettings.vendorDeliveryMode`; Delivered / Need More Space / Issue |
| Legacy full check-in | ✅ Same page when `vendorDeliveryMode = full_checkin` |
| Verify | ✅ `verify:vendor-delivered` + `verify:vendor-e2e` |

### Trusted readiness + transactional pickup ✅ (shipped 2026-06-17, `b7b817f`)

| Item | Status |
| ---- | ------ |
| `recalculateDeliveryReadiness` CF | ✅ Prod `stageverify-db` |
| `recordPickupEvent` CF (idempotent, transactional) | ✅ Prod `stageverify-db` |
| Unauth direct `picked_up` / `ready_for_pickup` writes blocked | ✅ Firestore rules prod |
| Vendor physical submit → trusted readiness recalc | ✅ Prod path verified |
| **Known gap:** blocking issue UI vs CF pickup eligibility | ✅ Aligned (`away-009` — pickup allowed with warning) |

### Phase 3 Slice 3 — Dispatcher readiness & scheduling (complete)

| Deliverable | Detail (`svscope` §6–8) | Status |
| ----------- | ------------------------ | ------ |
| Job / PO / delivery readiness breakdown | Which deliveries ready, incomplete, issue, picked up; job must not show “Everything Ready” until all required material ready | ✅ Shipped |
| **Pickup Scheduled** | Dispatcher marks job after BuildOps scheduling — distinct from vendor delivery schedule | ✅ Shipped |
| **Copy Pickup Information** | One-click clipboard: site, job name, job number, pickup locations, pickup link; validates stored token before reuse, fresh gen when stale | ✅ Shipped (`away-074` token validity) |
| Ready-only pickup queue | Job appears in technician queue only when business readiness = `ready_for_pickup` | ✅ Shipped |

### Phase 3 Slice 4 — Vendor access hardening (shipped)

| Deliverable | Detail (`svscope` §3) | Status |
| ----------- | ---------------------- | ------ |
| Temporary delivery-specific vendor session | Server-validated; configurable expiration | ✅ Shipped (`away-021`…`023`) |
| Shop geofence | Additional control near shop; warn-only default | 🔵 Shipped (`away-024`) |
| App Check evaluation | Optional hardening for public write surfaces — deferred until explicit approval | ⬜ Deferred |

### Phase 3 Slice 5 — Pickup link security (shipped; reminder deferred)

| Deliverable | Detail (`svscope` §9, §12) | Status |
| ----------- | --------------------------- | ------ |
| Opaque pickup token | Unguessable, revocable, server-validated; replaces predictable job-only links | ✅ Shipped (`away-025`…`027`) |
| Token scope | Job pickup page only — no Firestore or dispatcher access | ✅ Shipped |
| Leave-shop reminder (optional) | Best-effort geofence prompt if technician leaves radius without completing; never auto-mark unchecked lines | ⬜ Deferred (`away-028` per Dan) |

### Phase 3 Slice 6 — Staging release & location lifecycle (partial)

| Deliverable | Detail (`svscope` §13) | Status |
| ----------- | ----------------------- | ------ |
| Per-location release after pickup | Temporary staging → Available when all assigned material picked up | 🔵 CF clears primary + additional staging IDs on full pickup (`away-019`) |
| Combination staging groups | Release G20–G22 as a unit; concurrency-safe | 🔵 Shipped stub + CF (`away-036`/`037`; real Jake Korb location IDs blocked) |
| E-tag sync on release | Phase 7 ESL automation; manual/clear path in Phase 3 if ESL blocked | ⬜ Phase 7 |
| Permanent shop-stock mapping | Locations stay reserved; qty accountability not inventory (BuildOps boundary) | ✅ Shipped 2026-06-20 |

### Phase 3 — Technician Pickup Workflow (full gate)

| Deliverable            | Detail                                                                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pickup UI              | Customer, address, job #, PO #, location, **Expected Materials**, shop stock | 🔵 Expected Materials + shop stock labels shipped (`away-016`/`018`) |
| Queue eligibility      | Job appears in pickup queue when the overall package is **`ready_for_pickup`** (business readiness) — distinct from detail visibility | ✅ Ready-only queue (`away-014`) |
| Detail visibility      | Once open, **all** material states are visible: staged, received-but-unstaged, shop-stock, missing, backordered, substituted, waived, exceptions — the _"What do I still need to grab?"_ goal applies to this detail view, not queue eligibility | 🔵 Unstaged partial/arrived rows visible de-emphasized (`away-017`); problem qty hidden on public pickup |
| Material location      | Pickup screen shows **current location** (where material actually is), not only assigned staging zone | ✅ Slice 2 |
| Shop + vendor mix        | Shop stock items appear alongside vendor-delivered items in pickup verification | 🔵 Pick list + pull-state labels (`away-018`) |
| Shop-stock pull states | Not Pulled / Pulled / Staged UI for pickup accountability (what to pull, where to find it) — not inventory tracking; not a committed Phase 2 state machine | 🔵 Shipped (`away-018`, `away-033` Staged) |
| Unstaged deliveries    | **Display only:** show already-known received-but-unstaged material in the pickup detail view (no new office workflow in Phase 3) | 🔵 Shipped (`away-017`) |
| Pickup framing         | Goal: _"What do I still need to grab?"_ — not workflow state labels                                                                                                                                                          |
| Actions                | **Everything Present** → `picked_up` + `PickupEvent`; **Report Issue** → `MaterialIssue`                                                                                                                                   |
| Assignment             | Material Owner attached on issue create                                                                                                                                                                                      |
| Testing                | Scenario A (happy path) + Scenario B (issue creation) per implementation plan                                                                                                                                                |
| Playwright             | Extend `verify:pickup` for issue button + dashboard visibility                                                                                                                                                               |
| Submit label           | **Order Pickup Complete** on submit button (`away-048`)                                                                                                                                              |
| Blocking-issue pickup  | Resolve UI “can still complete pickup” vs CF `unresolved_blocking_issues` block; update verify harness B→A order if needed                                                                                                    |

**Gate:** Successful pickup + issue creation without manual DB edits. **Integration proof passed** (`away-047`: `verify:phase3-integration` + prod pickup verify). **Permanent shop-stock mapping shipped 2026-06-20** — full Phase 3 gate closed.

### Phase 4 — Material Issue Resolution

| Deliverable      | Detail                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| Owner UI         | Open issue, select resolution type, submit (`away-051` — 8-type picker + note)                                                                        |
| Resolution types | Found in Shop, Pick Up at Supply House, Vendor Redeliver, Substitute, Transfer, Continue Without, Hold Job, Other |
| Tech UI          | View resolution status on pickup (`pickupMaterialIssues` readback + per-card panel) ✅ |
| History          | Resolution + status history stored                                                                                |
| Verify           | ✅ `verify:phase4-integration` (+ `:prod`) — issue report → dispatcher resolve → tech readback |

**Gate:** End-to-end Issue Created → Assigned → Resolved → tech sees resolution on pickup. **Passed 2026-06-20** (`verify:phase4-integration` + `:prod`).

---

## LATER

Phases 5–9 are sequenced below for prioritization. **Queue override:** `away-list.json` + `CURRENT_STATE.md` + `npm run away:next` define the next build item (may queue Phase 5 before Phase 3 gate close). Historical detail in `docs/archives/stageverify_implementation_plan.md` — not active guidance.

### Phase 5 — Vendor Email Parsing Prototype (`svscope` §5 Condition 1 — offline)

- Configurable inbox address (not hard-coded); sample emails only (Johnstone, Ferguson, First Supply) — **no live inbox, no production automation**
- Offline prototype with controlled sample emails only — domain-based live-email identification (`emailDomain`) **not required** in Phase 5
- Extract vendor, PO, customer, delivered/missing/backordered, delivery status
- AI may extract, classify, match, score, explain, and **propose** updates for human review — AI may **not** update operational records or change readiness/delivery status
- Confidence: high confidence → proposed auto-processing for human review in Phase 5; actual automation is Phase 6+ only after an approved automation gate
- **Gate:** ≥95% extraction accuracy on approved sample set using defined scoring method; low-confidence routed to review
- **Shipped (away-042…045):** Johnstone + First Supply + Ferguson fixtures; `npm run test:email-parser` prints per-fixture pass/fail + aggregate ≥95% gate; read-only proposed updates panel
- **Polish (away-049):** WinSupply fixtures + panel filters/summary/expandable preview; `verify:dispatcher-nav` asserts panel
- **Dedup + harness (away-054…057):** fingerprint dedup in proposed panel; `verify:phase5-email`; correction-to-earlier-email fixture (`msg-correction-015`) + ≥95% parser gate; expanded proposal review detail (match labels, confidence reason, item lines, body excerpt, Condition 1 after-approval note)
- **Settings (away-053+):** Email Monitoring — disconnected: editable `monitoringInboxEmail` + Connect Gmail; **connected:** unified Gmail Mailbox panel (locked inbox, processing toggle only); `verify:settings-staging` + `verify:email-oauth-connect`
- **Drawer evidence (away-058):** READINESS EVIDENCE panel in delivery drawer — Condition 1 offline proposals, Condition 2 physical fields, blockers (read-only)
- **Condition 1 write (away-059):** `processInboundVendorEmail` callable CF (auth required) — auto-applies high-confidence `vendor_order_complete` to `vendorOrderComplete*` only; `vendorEmailEvents` audit; conflict → pending review; `test:process-inbound-vendor-email`; drawer ✓ Complete / Review Required from delivery fields
- **Invoice import spec (docs):** `docs/vendor-import/johnstone-invoice-import-spec.md` — PDF batch → expected vendor orders; `pickup_at_vendor` displays as **Will-Call / Pickup.**; import ≠ shop receipt
- **Invoice import Slice 1 (shipped 2026-07-03):** Offline text-fixture parser in `src/dispatcher/invoice/` — header/line extraction, fulfillment inference, import status + dispatcher labels, confidence/review routing; `npm run test:invoice-parser` ≥95% gate on spec worked examples + Table D; no PDF upload UI or Firestore writes yet
- **Invoice import Slice 2 (shipped 2026-07-03):** PDF text adapter + `processInvoiceBatch` — multi-page extraction fixtures, one `importBatchId` per batch, page outcomes processed/needs_review/failed, failure isolation; `npm run test:invoice-batch` ≥95% gate; still offline — no upload UI or Firestore
- **Multi-vendor invoice platform (v0.0.59, 2026-07-18):** ✅ Shipped — vendor router + First Supply parser + multi-invoice PDF split; PO-linked vendor wins on shell create; `parserFormatId` on imports; golden First Supply fixtures (Dan PDF)
- **Hybrid canonical extractor (v0.0.60, 2026-07-18):** ✅ Shipped — vendor-agnostic field search (`parseCanonicalInvoice`) on every PDF; Johnstone/First Supply optional accelerators; novel vendors (`generic`) extract without parser files; always review-required for generic; `test:invoice-parser` covers Ferguson + Monroe + Gustave Larson fixtures

### Phase 6 — Vendor Email Monitoring (`svscope` §5 Condition 1 — live)

- **Johnstone alphanumeric Invoice # parser (2026-07-04):** ✅ Shipped — tabular pdf.js header row extracts `P411190` and wide-row Ship Via; S/O 4046362 PDF no longer false `issue` when Invoice # present; `test:pdf-extract-4046362` + `verify:inbound-email-ingest` §3e
- **Shared Refresh Now sync (2026-07-04):** ✅ Shipped — `DispatcherPortalProvider` at portal layout; Refresh Now on any dispatcher tab refreshes invoice queue, vendors, zones + Gmail sync; all tabs consume same snapshot on navigate; dashboard re-fetches deliveries on refresh generation
- **Stage 1 tracked vendor email (2026-07-06, v0.0.15):** ✅ Shipped dark — outbound tracking tokens + reply router behind `emailReplyIngestEnabled`; Needs Review live query; enable flag + Pub/Sub for end-to-end
- **Outbound send (away-068):** ✅ Shipped — `sendVendorEmail` CF (Gmail API); Email Vendor enabled in Resolve Issue when `emailProviderConnected`; outbound `vendorEmailEvents` audit
- **Drawer/readiness UX (away-072, away-073, clarity correction):** ✅ Shipped — Issue Summary item table only (no Open Issues accordion); calm **Waiting on Delivery** banner for normal pending; **What Needs Attention** only for true exceptions; exception-only issue counts; `verify:delivery-consistency` + `test:demo-matrix`
- **Demo drawer uniformity (2026-06-24):** ✅ Shipped — ORD-005 layout/rules on all seed orders (ORD-001..006); hidden lower sections global; verify loop per demo order
- **Firestore doc id + prod demo hide (2026-07-05, v0.0.14):** ✅ Shipped — `fetchAll`/`fetchWhere` merge doc id; seed demo ORD rows hidden on prod gh-pages list; drawer opens via correct `deliveryId`
- **Dispatcher list/drawer polish (2026-06-24):** ✅ Shipped — delivery label modal dismiss + Push to E-Tag copy; activity history compact dedup + raw full view; Issue Summary column Pickup Scheduled priority when ready
- **Short pickup clipboard (2026-07-03):** ✅ Shipped — Copy Pickup Information omits status/items/qty; demo ORD-001..006 short-format + staging rules in `verify:delivery-consistency`
- **Dispatcher staging-action rows (2026-07-03):** ✅ Shipped — missing staging alone triggers `dispatcher-action-required` dark-orange row (any status/received count; `installed` exempt); Issue Summary **Assign staging location** top priority; verify offline + live Staging Loc. column
- **Vendor emailDomain (2026-07-05):** ✅ Shipped — `emailDomain` on Vendor model + Vendors UI column/form; demo seed + email fixtures; client matcher uses explicit domain
- `emailDomain` on `Vendor` for matching when live monitoring starts
- Live inbox monitoring with **human-reviewed proposed updates first**
- Narrow automation only for explicitly approved, high-confidence event types — high confidence alone is not blanket permission to update records
- Unexpected or conflicting cases route to human review (business risk, missing data, conflicting evidence, or action type — not only low confidence score)
- Handle complete, partial, backorder, unknown PO; unknown emails to review queue
- **Gate:** False Ready For Pickup rate below defined threshold on approved test data; does not imply unrestricted live readiness changes

### Phase 7 — E-Tag Automation (Minew ESL)

- Auto-update tag: job name, PO, location, readiness state
- **Gate:** Tag state matches StageVerify; no manual ESL portal edits
- **Status:** ESL/Minew integration is planned; live ESL updates blocked on Minew credentials; no ESL Cloud Function currently implemented; does not block Phase 2 (see `PROJECT_STATUS/ESL_INTEGRATION_PLAN.md`)

### Phase 8 — AI Learning & Correction Engine

- Vendor Knowledge Base, Human Correction DB, confidence tracking, rule generation
- Before automation gate: AI proposes and explains only — no operational writes
- **Gate:** Stable correction storage; demonstrated correction-informed improvement on test cases; demonstrated reduction of repeated error patterns over defined correction window on approved test data

### Phase 9 — AI Recommendations

- Staging suggestions, delivery complexity, vendor risk, issue hints — **≥90% confidence** initial policy target (not a guaranteed calibrated probability), explainable, overridable, disableable
- AI may recommend; AI may **not** assign staging locations or change readiness without an approved automation gate
- **Gate:** Acceptance/override logging; recommendations can be disabled; confidence thresholds validated against correction history and false-positive rates

### Unstaged delivery fast-path (LATER)

- **Distinct from Phase 3:** Phase 3 displays already-known received-but-unstaged material in the pickup detail view; this LATER item adds a dedicated office workflow
- Office staff search by PO → record current location → item appears in technician pickup (no full check-in workflow required) — for ad-hoc shipments (Amazon, UPS, FedEx) not captured through normal vendor check-in

### Cross-cutting (LATER)

| Item                            | Notes                                                     |
| ------------------------------- | --------------------------------------------------------- |
| Security audit (away-007)       | Done — see `PROJECT_STATUS/archives/security-report-2026-06-02.md` |
| `listDeliveries` pagination     | Technical debt; acceptable until ~500+ deliveries         |
| Shared types in Cloud Functions | Refactor CF `DeliveryStatus` duplicate                    |
| Shop map / location IDs         | Blocked on Jake Korb shelving decision                    |
| Firebase App Check (public routes) | `svscope` deferred; evaluate in Phase 3 Slice 4 or later |

---

## MAYBE

Interesting or mentioned in principles; **not** in the current 9-phase gate sequence. Do not implement without explicit approval.

| Idea                                         | Why MAYBE                                       |
| -------------------------------------------- | ----------------------------------------------- |
| BuildOps integration                         | Consume existing job data — no API spec in plan |
| Slack/email notifications for Material Owner | Ops convenience, not core loop                  |
| Mobile native scanner app                    | Web QR flow works today                         |
| Multi-tenant / multi-shop                    | Full multi-tenant customer-facing product experience is out of MVP scope; making the data model tenant-safe now ≠ building a multi-tenant admin product — tenant-safe data boundaries remain a design consideration regardless |
| Technician login / Google auth on pickup | Explicit non-goal — pickup stays public (`svscope` §9) |
| Opaque pickup job tokens | **Not MAYBE** — scheduled in **Phase 3 Slice 5** (see traceability table) |
| Inventory / stock-on-hand                    | Explicit non-goal                               |
| Purchasing / PO creation in-app              | Explicit non-goal                               |
| Dispatch / truck routing                     | Explicit non-goal                               |
| Accounting / cost tracking                   | Explicit non-goal                               |
| Physical shop map UI                         | Blocked on shelving + map asset                 |
| Gemini model upgrades                        | Infrastructure choice, not product phase        |

---

## Phase map (quick reference)

| Phase | Name                           | Roadmap bucket | Status              |
| ----- | ------------------------------ | -------------- | ------------------- |
| 1     | Stabilize                      | — (complete)   | ✅ Gate passed      |
| 2     | Material Readiness Data Model  | — (complete)   | ✅ Gate passed      |
| 3     | Technician Pickup Workflow     | — (complete)   | ✅ Gate closed 2026-06-20 |
| 4     | Material Issue Resolution      | — (complete)   | ✅ Gate closed 2026-06-20 |
| 5     | Vendor Email Parsing Prototype | **NOW**        | 🔵 Active (prototype + inbox settings UI) |
| 6     | Vendor Email Monitoring        | **LATER**      | ⬜                  |
| 7     | E-Tag Automation               | **LATER**      | ⬜ (blocked: Minew) |
| 8     | AI Learning & Correction       | **LATER**      | ⬜                  |
| 9     | AI Recommendations             | **LATER**      | ⬜                  |
| —     | ACES builder (control plane) | **LATER**      | 🔵 Phase 1 audit done — prototype in-repo; see `aecs/README.md`, `docs/aecs-phase1-audit.md` |

---

## Relationship to other status files

| File | Role |
| ---- | ---- |
| **`PROJECT_STATUS/svscope_simple.md`** | **Product authority** — end-to-end vision; everything hinges on scope §; wins on conflict |
| **`docs/project_state.md`** | Canonical phase truth — features, deployment, known issues, current phase |
| **`docs/roadmap.md` (this file)** | V2 phase prioritization and gates for agents; traceability table maps scope § → phase |
| **`PROJECT_STATUS/CURRENT_STATE.md`** | Hot-tier snapshot (~30 lines); pointers only — read first each session |
| **`docs/aecs-phase1-audit.md`** | ACES builder audit (Layer 2) — control-system inventory, boundaries, Phase 2 plan; planning only, not live agent guidance |
| **`aecs/README.md`** | ACES product name + StageVerify-first prototype note; `aecs/` paths unchanged |
| **`docs/archives/stageverify_implementation_plan.md`** | Historical reference only — do not use for active agent guidance |

When a V2 phase ships, update **both** `docs/project_state.md` and `PROJECT_STATUS/CURRENT_STATE.md` per ship-loop. Session history goes to `PROJECT_STATUS/archives/`.

---

## Memory maintenance

> **Scope:** StageVerify project memory in this repo only — not Cursor harness (`.cursor/rules`), agent-ops brain repo, or external AI OS docs.

### When to evaluate (after meaningful work)

Revisit memory when session work changes **project truth**: phase/gate status; features added or removed; architecture decisions; accepted product decisions (nav/scope); blockers or issues; deployment status; repo structure; priorities/next steps; operational lessons (QR, nav, backend); authoritative paths or agent loading instructions.

### When NOT to update

Skip memory churn for routine code edits that do not change project truth (bugfixes, styling, refactors with same behavior). Do **not** blindly touch every memory file each session. Do **not** rewrite `archives/` or historical docs as if they were current authority.

### Ownership (per authority hierarchy)

| Truth type | Owner file(s) |
| ---------- | ------------- |
| Active phase / gate | `docs/project_state.md` + `docs/roadmap.md` + `CURRENT_STATE.md` snapshot |
| Hot snapshot / blockers / next steps | `PROJECT_STATUS/CURRENT_STATE.md` + `NEXT.md` |
| Memory router (concern → file) | `PROJECT_STATUS/MEMORY.md` |
| Away consistency | `npm run away:validate` after memory or away-list edits |
| Phase gates / priorities | `docs/roadmap.md` |
| Architecture | `docs/stageverify_v2_architecture.md` |
| Accepted product decisions (nav/scope) | `PROJECT_STATUS/USER_SCOPE_REJECTIONS.md` |
| Operational lessons (QR/nav/backend) | `PROJECT_STATUS/MODEL_DOSSIER.md` (index + §; rotate detail to `archives/`) |
| ESL / hardware | `PROJECT_STATUS/ESL_INTEGRATION_PLAN.md` |
| Physical deploy chain | `PROJECT_STATUS/PHYSICAL_DEPLOYMENT.md` |
| Security (episodic) | `PROJECT_STATUS/security-report-*.md` |
| History | `PROJECT_STATUS/archives/` and `docs/archives/` — append only; never rewrite as current |

### Agent finish behavior

Before handoff or commit: (1) check whether the session changed project truth; (2) update only the owner file(s) from the table above; (3) report which docs were updated or explicitly why none; (4) cross-doc consistency check — phase in `project_state.md` matches roadmap NOW bucket and `CURRENT_STATE` snapshot; blockers and next steps agree across hot tier and canonical files.
