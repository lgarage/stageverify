# StageVerify V2 Transition Report

> **ARCHIVED 2026-06-04** — One-time executive summary. Active phase truth: `docs/project_state.md`; active roadmap: `docs/roadmap.md`.

> **Audience:** Technical lead authorizing Phase 2 work  
> **Date:** 2026-06-04  
> **Status:** Architecture validation complete when companion docs land in `docs/`

---

## 1. What StageVerify Is Today

StageVerify V1 is a **live, Firestore-backed staging and pickup system** for USA Heating & Cooling’s shop floor—not a prototype.

**What works in production:**

- Dispatcher creates deliveries, assigns staging zones (with occupancy guard), edits shop stock pick lists, and drives status through **Ordered → Shipped → Received → Staged → Picked Up → Installed**
- Vendor drivers check in via QR (`/#/`, `/#/receive`, `/#/checkin/:id`) with quantity verification, damage/missing capture, and Need More Space overflow
- Technicians pick up via public `/#/pickup` with checkbox verification and `PickupEvent` audit
- QR routing sends scans to the correct portal based on delivery status; compact and legacy URLs supported
- Zone management, vendor CRUD, settings (auto-submit timer, revert window), entry display board
- Cloud Function `autoSubmitDeliveries` auto-submits idle vendor check-ins
- Deployed at https://lgarage.github.io/stageverify

**What V1 does not do:**

- Monitor vendor emails or determine readiness from communications
- Structured material issues or Material Owner accountability loop
- AI parsing, learning, or recommendations
- Live Minew ESL updates (designed, **blocked on vendor API credentials**)
- ERP, inventory, purchasing, or dispatch

**Honest gaps:** `issueSummary` is free text; readiness is inferred from delivery status labels (“Staged”) rather than principles-aligned **Ready For Pickup / Not Ready**; shop stock is a free-text array; full-collection reads in `listDeliveries` are acceptable today but not infinite scale.

---

## 2. What StageVerify V2 Becomes

V2 is a **Material Readiness platform**: ensure technicians leave the shop with everything required for the job, catching problems **before** the job site.

**End-state workflow:**

PO → Vendor Email (monitored) → Readiness Determination → E-Tag Update → Technician Pickup (verify + issue) → Material Owner Resolution → Historical Learning

**Core additions:**

- Explicit readiness states and rules (backorder, partial, open issue → **Not Ready**)
- **Material Owner** per job for issue resolution
- **Vendor email** as primary automation input (prototype then live)
- **AI** as interpreter only; humans correct; vendor knowledge retained
- **Part classification** and analytics for learning—not inventory

**AI posture:** Observe → Suggest → Automate. Humans retain final authority.

---

## 3. What Is Reusable

Carry forward with minimal or additive change:

| Area | Reuse |
|------|-------|
| **Models** | `Job`, `Vendor`, `PurchaseOrder`, `DeliveryOrder`, `Item`, `StagingLocation`, `StatusHistoryEvent`, `PickupEvent`, `AppSettings` |
| **Services** | `firestoreService.ts` pattern; `VALID_TRANSITIONS` in `service.ts` (extend, don’t replace blindly) |
| **Routes** | All current HashRouter paths; public vs `ProtectedRoute` split |
| **Portals** | `PickupPortalPage`, `ReceivingPage`, `CheckInPage`, `App.tsx` vendor scanner |
| **Dispatcher** | `DispatcherDashboardPage` shell, drawer, create delivery modal |
| **QR** | `receiveQrUrls.ts`, `scanRouting.ts`, `shouldRouteScanToPickup` |
| **Audit** | `StatusHistoryEvent` + `actorType: "system"` for future AI actions |
| **Zones** | `ZoneManagementPage`, occupancy guard, ESL QR print flow |
| **Ops** | GitHub Pages deploy, Firestore rules workflow, Playwright verify scripts |
| **CF** | `autoSubmitDeliveries` scheduler pattern |

---

## 4. What Should Change

| Area | Change |
|------|--------|
| **Data model** | Add readiness, material owner, `MaterialIssue`, `VendorEmailEvent`, `AICorrection`, knowledge base refs |
| **Collections** | New Firestore collections alongside existing; never break current reads |
| **Pickup UI** | Expected materials + Report Issue (Phase 3) |
| **Dispatcher UI** | Issues queue, readiness columns, resolution UI (Phases 3–4) |
| **Status semantics** | Align UI labels with principles (Ready For Pickup vs “Staged”) via mapping layer |
| **Shop stock** | Evolve from `shopStockPickListItems: string[]` toward structured items |
| **Vendor entity** | `emailDomain`, knowledge base linkage |
| **PickupEvent** | Link created issue IDs |
| **Cloud Functions** | Email processor (Phases 5–6), ESL sync (Phase 7), shared types with client |
| **Firestore rules** | Per-collection rules with security gate |
| **Documentation** | `project_state.md` phase tracker after each gate |

**Do not change without cause:** sidebar structure per `USER_SCOPE_REJECTIONS.md`; dispatcher visual system unless requested.

---

## 5. Recommended Phase 2 Kickoff Tasks

Phase 1 is complete. **Authorize Phase 2** when this report and `stageverify_v2_architecture.md` are reviewed.

Immediate actions (no UI breaking changes):

1. **Review** architecture doc + this report; confirm non-goals understood by implementers.
2. **Extend `models.ts`** with V2 interfaces (optional fields on existing types where appropriate).
3. **Document field mapping** — `DeliveryStatus` ↔ `readinessStatus` in a comment block or small doc section in architecture (avoid dual-write bugs).
4. **Stub Firestore accessors** for new collections (read empty, write behind feature flag if needed).
5. **Run build + existing Playwright verifies** — gate before any Phase 3 UI.
6. **Update `docs/project_state.md`** — phase = Phase 2 in progress → complete when gate passes.

**Do not start:** live email ingestion, ESL API calls, or dispatcher issues UI (Phase 3+).

---

## 6. Recommended Phase 2 Data Model Tasks

Concrete extension checklist:

| Task | Detail |
|------|--------|
| Readiness enum | `ordering` \| `not_ready` \| `ready_for_pickup` \| `picked_up` (+ mapping from `DeliveryStatus`) |
| Material owner | `materialOwnerId?`, `materialOwnerName?` on `Job` or `DeliveryOrder` |
| Expected materials | Structured line items (description, qty, classification?) linked to delivery |
| Shop stock | Parallel structure to expected materials; migrate from string array over time |
| MaterialIssue | id, deliveryOrderId, jobId, type, status, reportedBy, assignedOwnerId, createdAt |
| IssueResolution | resolutionType enum, assignee, notes, resolvedAt |
| VendorEmailEvent | raw payload ref, parsed fields, confidence, review status |
| AICorrection | original vs corrected JSON, vendorId, reason, timestamps |
| AI metadata | `confidenceScore`, `humanReviewRequired` on email events |
| PickupEvent extension | `issueIds?: string[]` (optional until Phase 3) |
| Vendor extension | `emailDomain?`, `knowledgeBaseVersion?` |

**Rules:** All new fields optional; old documents load without migration scripts in Phase 2.

---

## 7. Biggest Risks (Top 5)

| # | Risk | Mitigation |
|---|------|------------|
| 1 | **False Ready For Pickup** from email AI | Human review queue; backorder/partial always Not Ready; Phase 6 gate |
| 2 | **Breaking public portals** during model/UI changes | Phase 2 data-only; Playwright on pickup/receive; additive Firestore rules |
| 3 | **Dual status confusion** (Staged vs Ready For Pickup) | Single write helper; documented mapping; dispatcher training |
| 4 | **Feature creep into ERP/inventory** | Principles + architecture non-goals; reject scope in review |
| 5 | **Firestore read regressions** | Security gate on rules; never require new fields on existing queries |

---

## 8. Biggest Opportunities (Top 5)

| # | Opportunity | Value |
|---|-------------|-------|
| 1 | **Vendor email automation** | Removes dispatcher re-keying of confirmations and backorders |
| 2 | **Technician issue loop** | Problems caught at shop; Material Owner resolves before job site |
| 3 | **Vendor knowledge base** | Parsing accuracy improves per supplier without retraining generic models |
| 4 | **Readiness clarity** | Techs only see truly ready jobs—less job-site material surprise |
| 5 | **Historical learning** | Vendor performance, issue analytics, staging intelligence (Phase 9) |

---

## Authorization checklist

Before Phase 2 code merge to `main`:

- [ ] Lead has read `docs/stage_verify_principles.md`
- [ ] Lead agrees Phase 2 is **data-only** (no pickup/dispatcher UI breaking changes)
- [ ] ESL / email live integration deferred to Phases 6–7
- [ ] `docs/project_state.md` will be updated at Phase 2 gate

**Next document after approval:** implement per `docs/stageverify_implementation_plan.md` Phase 2 deliverables.
