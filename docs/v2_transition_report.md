# StageVerify V2 Transition Report - C:\Projects\stageverify\docs\v2_transition_report.md

> **Audience:** Technical lead authorizing Phase 2 work  
> **Date:** 2026-06-04 (companion docs reviewed 2026-06-05)  
> **Role:** Transition report for **Phase 2 authorization** — not the canonical roadmap or implementation plan.  
> **Status:** Companion documents drafted → reviewed → validated (as of 2026-06-05). Phase 2 is **authorized and active** per `docs/roadmap.md`; checklist below = initial human review confirmation (not an agent workflow blocker).  
> **After authorization, agents follow:** `docs/roadmap.md` (phase priorities), `docs/stageverify_v2_architecture.md` (architecture + Composer guidance), `docs/project_state.md` (canonical phase truth).

**BuildOps boundary:** StageVerify consumes PO and job data from BuildOps but does not replicate BuildOps inventory features. BuildOps owns inventory counts, stock levels, reorder points, purchasing, and warehouse management. StageVerify owns material readiness, material location, pickup verification, material issues, and vendor accountability. Shop stock tracking in StageVerify is a location pointer only—not quantity management.

---

## 1. What StageVerify Is Today

StageVerify V1 is a **live, Firestore-backed staging and pickup system** for USA Heating & Cooling’s shop floor—not a prototype.

**What works in production:**

- Dispatcher creates deliveries, assigns staging zones (with occupancy guard), edits shop stock pick lists, and drives status through **Ordered → Shipped → Received → Staged → Picked Up → Installed**
- Vendor drivers check in via QR (`/#/`, `/#/receive`, `/#/checkin/:id`) with quantity verification, damage/missing capture, and Need More Space overflow
- Technicians pick up via public `/#/pickup` with checkbox verification and `PickupEvent` audit
- QR routing sends scans to the correct portal based on delivery status; compact and legacy URLs supported
- Zone management, vendor CRUD, settings (auto-submit timer, revert window), entry display board
- Cloud Function `autoSubmitDeliveries` auto-submits idle vendor check-ins (**deployed**)
- Zone label printing (ESL QR labels) is operational via `ZoneManagementPage`
- Deployed at https://lgarage.github.io/stageverify

**What V1 does not do:**

- Monitor vendor emails or determine readiness from communications
- Structured material issues or Material Owner accountability loop
- AI parsing, learning, or recommendations
- Live Minew ESL tag updates — ESL/Minew integration is planned; live ESL updates blocked on Minew credentials; no ESL Cloud Function currently implemented; does not block Phase 2 (zone label printing works; live tag push does not)
- ERP, inventory, purchasing, or dispatch

**Honest gaps:** `issueSummary` is free text; readiness is inferred from delivery status labels (“Staged”) rather than principles-aligned **Ready For Pickup / Not Ready**; shop stock is a free-text array; full-collection reads in `listDeliveries` are acceptable today but not infinite scale.

---

## 2. What StageVerify V2 Becomes

V2 is a **Material Readiness platform**: ensure technicians leave the shop with everything required for the job, catching problems **before** the job site.

**End-state workflow:**

PO → Vendor Email (monitored) → Readiness Determination → E-Tag Update → Technician Pickup (verify + issue) → Material Owner Resolution → Historical Learning

**Core additions:**

- Explicit readiness states and rules (unresolved backorder/partial/open issue **normally** blocks **Not Ready**; authorized exceptions with audit trail — see §7 risk #1)
- **Material Owner** per job for issue resolution
- **Vendor email** as primary automation input (prototype then live)
- **AI** as interpreter only; humans correct; vendor knowledge retained
- **Part classification** and analytics for learning—not inventory

**AI posture:** Observe → Suggest → Validate → Automate. Before an approved automation gate, AI may extract, classify, match, score, explain, and propose — but may **not** update operational records or declare material ready for pickup. High confidence alone ≠ permission to update records. Humans retain final authority.

---

## 3. What Is Reusable

Carry forward with minimal or additive change:

| Area                                     | Reuse                                                                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Models**                               | `Job`, `Vendor`, `PurchaseOrder`, `DeliveryOrder`, `Item`, `StagingLocation`, `StatusHistoryEvent`, `PickupEvent`, `AppSettings` |
| **Services**                             | `firestoreService.ts` pattern; `VALID_TRANSITIONS` in `service.ts` (extend, don’t replace blindly)                               |
| **Routes**                               | All current HashRouter paths; public vs `ProtectedRoute` split                                                                   |
| **Portals**                              | `PickupPortalPage`, `ReceivingPage`, `CheckInPage`, `App.tsx` vendor scanner                                                     |
| **Dispatcher**                           | `DispatcherDashboardPage` shell, drawer, create delivery modal                                                                   |
| **QR**                                   | `receiveQrUrls.ts`, `scanRouting.ts`, `shouldRouteScanToPickup`                                                                  |
| **Audit**                                | `StatusHistoryEvent` for operational timeline summaries and state transitions (`actorType: "system"` for automated events). Detailed AI corrections, parsed-email lineage, and evidence records are separate phase-gated structures — StatusHistory may reference or summarize them, not replace them |
| **Zones**                                | `ZoneManagementPage`, occupancy guard, ESL QR label printing (operational). Live Minew tag push: ESL/Minew integration planned; no ESL Cloud Function currently implemented; blocked on Minew credentials; does not block Phase 2 |
| **Ops**                                  | GitHub Pages deploy, Firestore rules workflow, Playwright verify scripts                                                         |
| **CF**                                   | `autoSubmitDeliveries` scheduler pattern                                                                                         |
| **`stagingLocationId` on DeliveryOrder** | Reused as **Assigned Location** (where material should be staged); **Current Location** is an additive extension                 |
| **`shopStockPickListItems`**             | Extends into structured Shop Stock pull list with location — tracks what to pull, where to find it, whether gathered/staged/picked up; **not** stock balances, reorder points, or inventory counts (BuildOps owns inventory) |

---

## 4. What Should Change

| Area                        | Change                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Data model**              | Add readiness, material owner, `MaterialIssue`, `VendorEmailEvent`, `AICorrection`, knowledge base refs            |
| **Collections**             | V2 extends the existing flat root-level collection pattern. Each new collection is created only when its owning phase gate requires it — not speculatively in Phase 2. Never break current reads |
| **Pickup UI**               | Expected materials + Report Issue (Phase 3)                                                                        |
| **Dispatcher UI**           | Issues queue, readiness columns, resolution UI (Phases 3–4)                                                        |
| **Status semantics**        | Align UI labels with principles (Ready For Pickup vs “Staged”) via mapping layer                                   |
| **Shop stock**              | Evolve from `shopStockPickListItems: string[]` toward structured items — pickup accountability (what to pull, where, gathered/staged/picked up), not inventory balances or reorder logic |
| **Current location**        | Add `currentLocationNote` (free-text last known location) to `DeliveryOrder`; individual `Item` lines may also carry location notes when materials in one delivery are in different places (exact placement deferred to Phase 2 implementation plan) |
| **Material source**         | Add `materialSource` primarily at `Item`/material-line level (`vendor_delivery` \| `shop_stock` \| `direct_shipment` \| `unknown`); a delivery may contain mixed sources. Pickup-accountability data, not inventory tracking |
| **Availability status**     | Add `availabilityStatus` (`expected` \| `received` \| `picked_up`) for physical receipt/pickup confirmation — distinct from workflow status and from location (`currentLocationNote`) |
| **Technician pickup scope** | Surface _all_ materials technician needs (vendor-delivered + shop stock + unstaged), not just formally staged ones |
| **Vendor entity**           | `emailDomain` (Phase 6+ live email monitoring; Phase 5 = offline sample emails only — domain routing not required). Knowledge base linkage Phase 8+ |
| **PickupEvent**             | Link created issue IDs                                                                                             |
| **Cloud Functions**         | Email processor: Phase 5 offline prototype (sample emails only), Phase 6 live monitoring. ESL sync: Phase 7 (blocked on Minew creds — does not block Phase 2). Shared types with client (LATER) |
| **Firestore rules**         | Per-collection rules with security gate                                                                            |
| **Documentation**           | `project_state.md` phase tracker after each gate                                                                   |

**Do not change without cause:** sidebar structure per `USER_SCOPE_REJECTIONS.md`; dispatcher visual system unless requested.

---

## 5. Recommended Phase 2 Kickoff Tasks

Phase 1 is complete. **Authorize Phase 2** when this report, `docs/stageverify_v2_architecture.md`, `docs/roadmap.md`, and `docs/project_state.md` are reviewed and the authorization checklist below passes.

Immediate actions (no UI breaking changes):

1. **Review** architecture doc + this report; confirm non-goals understood by implementers.
2. **Extend `models.ts`** with V2 interfaces (optional fields on existing types where appropriate).
3. **Document field mapping** — `DeliveryStatus` ↔ `readinessStatus` in a comment block or small doc section in architecture (avoid dual-write bugs).
4. **Add Firestore persistence only when the active Phase 2 gate explicitly requires it** — do not pre-build later-phase collection APIs (issues, email events, AI corrections, vendor knowledge) unless the gate includes them.
5. **Run build + existing Playwright verifies** — gate before any Phase 3 UI.
6. **Update `docs/project_state.md`** — phase = Phase 2 in progress → complete when gate passes.

**Do not start:** live email ingestion (Phase 6), offline email prototype (Phase 5), live ESL API calls (Phase 7), or dispatcher issues UI (Phase 3+).

---

## 6. Recommended Phase 2 Data Model Tasks

Concrete extension checklist:

| Task                  | Detail                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| Readiness enum        | `ordering` \| `not_ready` \| `ready_for_pickup` \| `picked_up` (+ mapping from `DeliveryStatus`)   |
| Material owner        | `materialOwnerId?`, `materialOwnerName?` on `Job` or `DeliveryOrder`                               |
| Expected materials    | Structured line items (description, qty, classification?) linked to delivery                       |
| Shop stock            | Parallel structure to expected materials; migrate from string array over time                      |
| MaterialIssue         | id, deliveryOrderId, jobId, type, status, reportedBy, assignedOwnerId, createdAt — **interface stub only** in Phase 2 unless gate requires persistence |
| IssueResolution       | resolutionType enum, assignee, notes, resolvedAt — **forward-compatible type/interface only**; persistence and workflows are Phase 4-gated |
| VendorEmailEvent      | raw payload ref, parsed fields, confidence, review status — **forward-compatible type/interface only**; persistence Phase 5–6 |
| AICorrection          | original vs corrected JSON, vendorId, reason, timestamps — **forward-compatible type/interface only**; persistence Phase 8 |
| AI metadata           | `confidenceScore`, `humanReviewRequired` on email events — **type definitions only** in Phase 2; no AI workflows or persistence |
| PickupEvent extension | `issueIds?: string[]` (optional until Phase 3)                                                     |
| Vendor extension      | `knowledgeBaseVersion?` (conceptual, Phase 8+). `emailDomain?` only if Phase 2 gate explicitly requires it — otherwise Phase 6+ (live email monitoring) |
| Current location      | Add `currentLocationNote?: string` to `DeliveryOrder` (and optionally `Item` when lines differ in location). Physical location is separate from `availabilityStatus` — material can be received + located + not-staged + not-ready simultaneously |
| Material source       | Add `materialSource?` primarily on `Item` (`vendor_delivery` \| `shop_stock` \| `direct_shipment` \| `unknown`); mixed sources per delivery. Pickup-accountability only — not inventory tracking |
| Availability status   | Add `availabilityStatus?: "expected" \| "received" \| "picked_up"` on `DeliveryOrder` and/or `Item`. Physical location via `currentLocationNote` — not a `located` lifecycle value |

**Rules:** All new fields optional; old documents load without migration scripts in Phase 2. `IssueResolution`, `VendorEmailEvent`, `AICorrection`, and AI metadata are forward-compatible interfaces in Phase 2 — not persistence implementations. Collections and service methods are created only when the active phase gate requires them.

---

## 7. Biggest Risks (Top 6)

| #   | Risk                                                   | Mitigation                                                                                                                                                            |
| --- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **False Ready For Pickup** from email AI               | Human review gates; approved automation gates; measurable validation on approved test data; bounded false-positive targets. High confidence alone is not sufficient mitigation. Unresolved backorder/partial normally blocks readiness; authorized person may mark nonblocking/substituted/waived with audit trail |
| 2   | **Breaking public portals** during model/UI changes    | Phase 2 data-only; Playwright on pickup/receive; additive Firestore rules                                                                                             |
| 3   | **Dual status confusion** (Staged vs Ready For Pickup) | Single write helper; documented mapping; dispatcher training                                                                                                          |
| 4   | **Feature creep into ERP/inventory**                   | Principles + architecture non-goals; reject scope in review                                                                                                           |
| 5   | **Firestore read regressions**                         | Security gate on rules; never require new fields on existing queries                                                                                                  |
| 6   | **Dual-location confusion**                            | Current location prioritized for immediate wayfinding; assigned location preserved as authoritative destination. Neither erases the other — UI hierarchy makes current location prominent without discarding assigned staging zone |

---

## 8. Biggest Opportunities (Top 7)

| #   | Opportunity                     | Value                                                                                                                                                                              |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Vendor email automation**     | Removes dispatcher re-keying of confirmations and backorders                                                                                                                       |
| 2   | **Technician issue loop**       | Problems caught at shop; Material Owner resolves before job site                                                                                                                   |
| 3   | **Vendor knowledge base**       | Parsing accuracy improves per supplier without retraining generic models                                                                                                           |
| 4   | **Readiness clarity**           | Pickup **queue** shows only `ready_for_pickup` packages; once a technician opens a job, **all** material remains visible (staged, received-but-unstaged, shop-stock, missing, backordered, waived). "Truly ready" = queue eligibility, not material erasure |
| 5   | **Historical learning**         | Vendor performance, issue analytics, staging intelligence (Phase 9)                                                                                                                |
| 6   | **Unstaged delivery visibility** | **Phase 3:** display already-known received-but-unstaged material in pickup detail view (no new office workflow). **LATER:** dedicated office fast-path (PO search → record current location → surfaces in pickup) for ad-hoc shipments (Amazon, UPS, FedEx) |
| 7   | **Shop stock integration**      | Technicians see vendor materials and shop stock pulls in one pickup checklist. StageVerify tracks what to pull, where to find it, whether gathered/staged/picked up — **not** stock balances, reorder points, purchasing, or inventory counts (BuildOps owns inventory) |

---

## Authorization checklist

Before Phase 2 code merge to `main`:

_Lead authorization prerequisites (1–4): satisfied 2026-06-05 (Dan). Implementation/gate items (5–6): not passed — Phase 2 gate still open._

- [x] Lead has read `docs/stage_verify_principles.md` _(reviewed 2026-06-05)_
- [x] Lead has read `docs/roadmap.md` (phase priorities), `docs/stageverify_v2_architecture.md` (architecture + Composer guidance), and `docs/project_state.md` (canonical phase truth) _(reviewed 2026-06-05)_
- [x] Lead agrees Phase 2 is **data-only** (additive, backward-compatible data model; Firestore persistence only when the active gate requires it; no pickup/dispatcher UI breaking changes) _(approved 2026-06-05)_
- [x] Phase 5 = offline email prototype (sample emails only); Phase 6 = live email monitoring; Phase 7 = ESL automation (blocked on Minew creds — does not block Phase 2); no premature later-phase UI, vendor-email automation, AI operational writes, issue-resolution, or ESL automation in Phase 2 _(boundaries confirmed 2026-06-05)_
- [ ] `npm run build` passes; existing Playwright verifies pass; no regressions on V1 workflows (vendor check-in, dispatcher drawer, pickup completion, zone QR routing, public portals) _(Phase 2 types not in `models.ts`; verify scripts exist but Phase 2 gate not run)_
- [ ] `docs/project_state.md` will be updated at Phase 2 gate _(still shows Phase 2 **active**, not complete — 2026-06-05)_

**After approval:** implement per `docs/roadmap.md` Phase 2 deliverables and `docs/stageverify_v2_architecture.md`. Historical detail: `docs/archives/stageverify_implementation_plan.md` (reference only — not active agent guidance).
