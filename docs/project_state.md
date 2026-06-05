# StageVerify — Project State - C:\Projects\stageverify\docs\project_state.md

> **Canonical phase truth** — single source for current phase, features, deployment status, and known issues.
> Hot-tier agents: read `PROJECT_STATUS/CURRENT_STATE.md` first; load this file for phase/roadmap decisions.
> **Maintained by:** Composer 2.5 (update after major milestones)
> **Last reviewed:** 2026-06-05

---

## Current Vision

**StageVerify V2 — Material Readiness Platform**

Ensure technicians leave the shop with everything needed to successfully complete a job.
StageVerify is not a WMS, ERP, or inventory system. It is a material readiness and
accountability layer that sits between purchasing, vendors, the staging shop, and
field technicians.

V2 tracks both assigned staging location and current physical location of materials, enabling technicians to find materials regardless of whether they've been formally staged.

**BuildOps boundary:** BuildOps owns inventory, procurement, purchasing, reorder logic, and warehouse stock management. StageVerify owns material readiness, assigned and current location, pickup accountability, material issues, and vendor-delivery accountability — not stock-on-hand balances, min/max levels, or purchasing.

### Material state dimensions (distinct questions)

| Concept | Answers | Notes |
| ------- | ------- | ----- |
| **Assigned location** | Where material *should* be staged | `stagingLocationId` (V1); unchanged in V2 |
| **Current location** | Where material was *last known* to physically be | Recommended V2 field: `currentLocationNote` — distinct from assigned location |
| **Availability** | Physical receipt state | Recommended V2 field: `availabilityStatus` — `expected` / `received` / `picked_up`. Physical location is a separate attribute via `currentLocationNote` — material can simultaneously be received + located somewhere + not-staged + not-ready. |
| **Business workflow** | Ordering, staging, pickup progression | V1 `DeliveryStatus`; V2 `ReadinessStatus` — not the same as physical location or availability |

`materialSource` belongs at the individual `Item` or material-line level primarily. A single delivery may contain mixed sources (`vendor_delivery` | `shop_stock` | `direct_shipment` | `unknown`). This is pickup-accountability data, NOT inventory tracking.

---

## Current Phase

**Phase 1 — Stabilize Current Platform** ✅ COMPLETE (gate passed)

The Phase 1 MVP lifecycle is fully operational:

Ordered → Shipped → Received → Staged → Picked Up → Installed

Note:

StageVerify V2 is transitioning toward a Material Readiness model:

Ordering → Not Ready → Ready For Pickup → Picked Up

The existing MVP workflow remains operational and serves as the foundation for V2.

The platform is deployed and functional on GitHub Pages.

**Active phase:** Phase 2 — Material Readiness Data Model 🔵

Extend the data model with forward-compatible V2 types and optional fields without breaking Phase 1 workflows. Phase details and gate criteria: `docs/roadmap.md` (NOW/NEXT/LATER/MAYBE), `docs/stageverify_v2_architecture.md`, and this file.

---

## Deployment Status

| Environment               | URL                                   | Status                               |
| ------------------------- | ------------------------------------- | ------------------------------------ |
| Production (GitHub Pages) | https://lgarage.github.io/stageverify | ✅ Live                              |
| Firebase project          | stageverify-db (Blaze)                | ✅ Active                            |
| Cloud Functions           | us-central1                           | ✅ Deployed (`autoSubmitDeliveries`) |
| Firestore rules           | stageverify-db                        | ✅ Deployed                          |
| ESL / Minew integration   | Planned — no ESL Cloud Function currently implemented | 🔴 Live ESL updates blocked on Minew credentials; does not block Phase 2 |

---

## Verified Working Features

| Feature                | Route                       | Actor               | Notes                                        |
| ---------------------- | --------------------------- | ------------------- | -------------------------------------------- |
| Vendor Check-In        | `/#/` and `/#/receive`      | Vendor driver       | Scan QR → verify items → submit              |
| Dispatcher Dashboard   | `/#/dispatcher`             | Dispatcher (auth)   | Full delivery list, status, search           |
| Delivery Detail Drawer | (inside dispatcher)         | Dispatcher          | Status changes, staging, shop stock, PO      |
| Staging Assignment     | Settings → Zones            | Dispatcher          | CRUD zones, occupancy guard                  |
| QR Routing             | Scan any tag                | Any actor           | Zone code → correct portal based on status   |
| Pickup Portal          | `/#/pickup`                 | Technician (public) | Verify items + shop stock → Done             |
| E-Tag / Zone Labels    | `/#/zones` (Print)          | Dispatcher          | Minew ESL QR + print label                   |
| Vendor Management      | `/#/vendors`                | Dispatcher (auth)   | CRUD vendors                                 |
| Zone Management        | `/#/zones`                  | Dispatcher (auth)   | CRUD staging locations                       |
| App Settings           | `/#/settings`               | Dispatcher (auth)   | Revert window, auto-submit timer, ESL tag ID |
| Auto-Submit            | Cloud Function              | System              | Submits after inactivity timeout             |
| Status History         | (inside drawer)             | All                 | Audit trail per delivery                     |
| Need More Space        | Vendor check-in done screen | Vendor              | Tiered overflow staging flow                 |

---

## Known Issues

| #   | Description                                                                                                                                                          | Severity | Blocked by                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------- |
| 1   | ESL Minew tag updates not live                                                                                                                                       | High     | Waiting on Minew vendor credentials          |
| 2   | No shop physical map — location IDs unassigned                                                                                                                       | Medium   | Waiting on Jake Korb shelving decision       |
| 3   | `listDeliveries` loads full collections in memory (no Firestore pagination)                                                                                          | Medium   | Technical debt — acceptable at current scale |
| 4   | `autoSubmitDeliveries` CF misses `shipped` status (only handles `arrived`)                                                                                           | Low      | Minor scope gap                              |
| 5   | Received-but-unstaged material can be physically present in the shop with no last-known location recorded — technicians and office staff struggle to find it (e.g. Amazon/UPS drops on the office counter). | Medium   | Phase 2 optional field recommendation (`currentLocationNote`); capture UI is Phase 3+ |

---

## Open Risks

| Risk                                                                | Impact               | Likelihood          |
| ------------------------------------------------------------------- | -------------------- | ------------------- |
| Minew API credential delay blocks ESL demo                          | High (demo blockers) | High (waiting)      |
| No vendor email processing — V2 AI workflow depends on it           | High (V2 roadmap)    | Low (future phases) |
| Data model migration (V2 fields) may break existing Firestore reads | Medium               | Medium              |
| Feature creep pulling toward ERP/inventory                          | High                 | Medium              |

---

## Technical Debt

| Item                                                          | File                     | Notes                                                                    |
| ------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------ |
| Full-collection reads on `listDeliveries`                     | `firestoreService.ts`    | No server-side filter/sort. Scales to ~500 items today.                  |
| `autoSubmitDeliveries` CF has duplicate `DeliveryStatus` type | `functions/src/index.ts` | Should import from shared types in V2                                    |
| Vendor check-in (`App.tsx`) is a monolithic component         | `src/App.tsx`            | Should be broken into smaller components                                 |
| No error boundary on public portals                           | All portal pages         | Silent failures on network errors                                        |
| `shopStockPickListItems` is a free-text array                 | `models.ts`              | Phase 3+: structured shop-stock pickup UI; not inventory balances        |
| `shopStockPickListItems` has no location structure            | `models.ts`              | Phase 2 may add optional per-`Item` `materialSource` / location fields on models only |

---

## Reusable Components for V2

| Component                                      | Current Role                    | V2 Role                                                                                             |
| ---------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `DeliveryOrder` model                          | Core tracking entity            | **Phase 2:** optional `materialOwner`, `readinessStatus`, `currentLocationNote`, `availabilityStatus`. No breaking changes. |
| `Item` model                                   | Line-item tracking              | **Phase 2:** optional `materialSource` (primary placement), `currentLocationNote`, `availabilityStatus`. **Phase 5+:** `partClassification`, `vendorEmailEventId` (conceptual until email phase). |
| `StatusHistoryEvent`                           | Audit trail                     | **Reuse as-is** — operational transitions and concise timeline summaries; `actorType: "system"` for automated events. Detailed `AICorrection` records are separate (conceptual; persistence Phase 8). |
| `PickupEvent`                                  | Technician pickup record        | **Phase 3+:** `issueIds[]` linkage. Phase 2: type stub only if gate requires.                       |
| `firestoreService.ts`                          | Data access layer               | **Phase-gated:** new root-level collections and helpers only when the active phase gate requires them; extend existing flat layout (same as V1), do not restructure. Not all V2 collections in Phase 2. |
| `DispatcherDashboardPage`                      | Delivery list + management      | **Phase 3+:** Material Issues and Readiness columns/views. Phase 2: no UI changes.                  |
| `PickupPortalPage`                             | Technician pickup               | **Phase 3:** Report Issue flow. Phase 2: unchanged behavior.                                        |
| `QR routing`                                   | Status-aware scan routing       | **Reuse as-is** in Phase 2 — preserve compact hashes, public portals, legacy parsing. Readiness-aware routing is Phase 4+; a `not_ready` route target is possible but not a confirmed design. |
| `StatusHistory`                                | Status audit trail              | **Reuse** for transitions; may reference or summarize AI actions. Does not replace dedicated correction records (Phase 8). |
| `Vendor` model                                 | Vendor entity                   | **Phase 6+:** `emailDomain` (live email monitoring — not a Phase 5 Vendor UI concern). Phase 5 = offline prototype with controlled sample emails only; a conceptual optional field may be introduced earlier only if the Phase 2 gate explicitly requires it. **Phase 8+:** `knowledgeBaseRef` (conceptual). Not Phase 2. |
| `PortalSidebar`                                | Dispatcher nav                  | Potential future enhancement (Phase 4+). Not required for Phase 2.                                  |
| `shopStockPickListItems` (DeliveryOrder field) | Free-text shop stock pull list  | **Phase 3+:** extended structured pickup UI. Shop stock = what to pull, where to find it, whether picked up — not stock-on-hand or reorder. |
| `stagingLocationId` (Assigned Location)        | Target staging zone on delivery | **Keep** as Assigned Location. **Phase 2 (optional):** `currentLocationNote` recommendation for Current Location — distinct field, distinct question. |

---

## Immediate Next Steps

1. **Architecture review and documentation** — V2 architecture docs complete; see `docs/stageverify_v2_architecture.md` and `docs/roadmap.md`.
2. **Phase 2: Material Readiness Data Model** — establish forward-compatible V2 data concepts only:
   - Add optional fields on existing models (`readinessStatus`, `materialOwner`, recommended `currentLocationNote`, per-`Item` `materialSource`, `availabilityStatus`) per `docs/roadmap.md` § Phase 2.
   - Add **stub types/interfaces** where the Phase 2 gate requires them (`MaterialIssue`, `IssueResolution`); treat `VendorEmailEvent`, `AICorrection`, and `VendorKnowledgeBase` as **conceptual / phase-gated** (Phase 5+ / Phase 8) — not permission to implement ingestion, UI, or persistence in Phase 2.
   - **V1 workflows must remain functional** throughout (vendor check-in, dispatcher drawer, pickup Done, zone QR routing).
   - Firestore collections, rules, indexes, service methods, and UI changes **only when the Phase 2 gate explicitly requires them** — not a one-shot build of all V2 architecture.
   - **Phase 2 does not include:** vendor-email ingestion, issue-resolution UI, AI automation, or a full structured shop-stock system.
3. **ESL integration** — ESL/Minew integration is planned (Phase 7; see `PROJECT_STATUS/ESL_INTEGRATION_PLAN.md`); no ESL Cloud Function currently implemented; live ESL updates blocked on Minew credentials; does not block Phase 2.
4. **Security audit** — complete (away-007 done; see `PROJECT_STATUS/security-report-2026-06-02.md`).
