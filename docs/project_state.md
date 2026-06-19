# StageVerify — Project State - C:\Projects\stageverify\docs\project_state.md

> **Canonical phase truth** — single source for current phase, features, deployment status, and known issues.
> Hot-tier agents: read `PROJECT_STATUS/CURRENT_STATE.md` first; load this file for phase/roadmap decisions.
> **Product vision authority:** `PROJECT_STATUS/svscope_simple.md` — end-to-end product design; all features and agent work must align with scope § there. Roadmap and phase status trace to it; when this file and scope disagree, **scope wins**.
> **Maintained by:** Composer 2.5 (update after major milestones)
> **Last reviewed:** 2026-06-18

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

**Phase 2 — Material Readiness Data Model** ✅ COMPLETE (gate passed 2026-06-08)

V2 optional fields and forward-compatible stub types live in `src/dispatcher/models.ts`. V1 workflows unchanged. No new Firestore collections or rules in Phase 2.

**Active phase:** Phase 3 — Technician Pickup Workflow 🔵

**Slice 1 (shipped 2026-06-08):** Report Issue from pickup portal (public `createMaterialIssue` CF), warning-only blocking banner, dispatcher open-issue badge + read-only Material Issues panel. Does **not** change `delivery.status` to `issue`; queue rules unchanged.

**Slice 2 (shipped 2026-06-08):** Clear pickup location labels on public pickup (`Pickup at`, `Also check`, `Find it at`, `Shop stock`); hides internal PARTIAL/COMPLETE chips. Display-only — queue, QR, rules, CF unchanged.

**Vendor portal restyling (shipped 2026-06-11):** Restyled vendor receive portal (`/#/receive`) and PIN gate to visually match the polished `PickupPortalPage` (dark theme, rounded-2xl cards, centered job header, bg-bg-secondary/40 metadata blocks, green check icons, sticky footer). No logic changes.

**Vendor native Camera check-in (shipped 2026-06-11):** Removed in-browser QR scanner from vendor receive (`/#/receive`). Vendors scan package/zone QRs with the phone Camera app; deep links open the portal automatically. Manual delivery ID entry remains on `/#/receive`.

**Single vendor UI (shipped 2026-06-11):** One vendor check-in experience — `ReceivingPage` at `/#/receive`. Legacy `/#/` and `/#/checkin/:id` redirect to receive. `appSettings.vendorDeliveryMode`: `exception_only` (Scan → PIN → Delivered hub) or `full_checkin` (line-item flow) on the same page. Removed `App.tsx` and `CheckInPage.tsx`.

**Exception-only vendor flow (shipped 2026-06-11):** Delivered hub with Need More Space, Issue reporting, and `markVendorDelivered` (status `arrived`, not `ready_for_pickup`). E2E: `npm run verify:vendor-delivered`.

**Vendor PIN gate (shipped 2026-06-08):** 4-digit PIN keypad after QR scan on `/#/receive`. `verifyVendorPin` CF validates PIN against order’s vendor; `vendors` collection auth-only read; 15-minute session timeout; audit log in `pinVerificationEvents`. Demo: `vendor-1` PIN `1234` on `delivery-demo-vendor-1`.

**Vendor public-path fix (shipped 2026-06-08):** Unauthenticated vendor receive no longer reads `vendors` for occupancy; `submitCheckin` / `updateStagingLocation` return `getDeliveryDetailsPublic` after write. E2E: `npm run verify:vendor-e2e`. Rules: `additionalStagingLocationIds` allowed on unauth delivery update (deploy rules separately).

**M1 vendor revert hydration (shipped 2026-06-08):** `revertDeliveryStatus` vendor paths (early return + post-commit) route through `hydrateAfterVendorWrite` — unauthenticated revert no longer calls auth-only `getDeliveryDetails`. Focused security review: PASS. Local verify: vendor-e2e 10/10, pickup PASS.

Full Phase 3 gate still open (PO-grouped checklist polish, permanent shop-stock mapping). **Batch 3 shipped 2026-06-17–18:** vendor session (Slice 4), pickup tokens (Slice 5), §10–§11 pickup UI, combination staging stub, Phase 4 issue resolve (`away-021`…`041`; see `archives/away-batch-3.json`).

Phase details and gates: `docs/roadmap.md` (NEXT), `docs/stageverify_v2_architecture.md`, and this file.

---

## Deployment Status

| Environment               | URL                                   | Status                               |
| ------------------------- | ------------------------------------- | ------------------------------------ |
| Production (GitHub Pages) | https://lgarage.github.io/stageverify | ✅ Live                              |
| Firebase project          | stageverify-db (Blaze)                | ✅ Active                            |
| Cloud Functions           | us-central1                           | ✅ Deployed (`autoSubmitDeliveries`, **`createMaterialIssue`** — Slice 1) |
| Firestore rules           | stageverify-db                        | ✅ Deployed (includes **`materialIssues` auth-read-only**) |
| ESL / Minew integration   | Planned — no ESL Cloud Function currently implemented | 🔴 Live ESL updates blocked on Minew credentials; does not block Phase 2 |

---

## Verified Working Features

| Feature                | Route                       | Actor               | Notes                                        |
| ---------------------- | --------------------------- | ------------------- | -------------------------------------------- |
| Vendor Check-In        | `/#/receive` (canonical)    | Vendor driver       | Scan QR → PIN → Delivered hub or full check-in (`vendorDeliveryMode`) |
| Dispatcher Dashboard   | `/#/dispatcher`             | Dispatcher (auth)   | Full delivery list, status, search           |
| Delivery Detail Drawer | (inside dispatcher)         | Dispatcher          | Status changes, staging, shop stock, PO      |
| Staging Assignment     | Settings → Zones            | Dispatcher          | CRUD zones, occupancy guard                  |
| QR Routing             | Scan any tag                | Any actor           | Zone code → correct portal based on status   |
| Pickup Portal          | `/#/pickup`                 | Technician (public) | Verify items + shop stock → Done; **Slice 1:** Report Issue modal + blocking warning (Done not hard-blocked) |
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

1. **away-042** — Phase 5 offline email parser fixture gate (`npm run test:email-parser`); fixtures on disk: Johnstone + First Supply (Ferguson in away-043). Overnight batch queue: away-042…046. See `away-list.json`.
2. **Phase 3 remainder** — permanent shop-stock mapping, full Phase 3 gate (see `docs/roadmap.md`).
3. **ESL integration** — Phase 7; blocked on Minew credentials.
4. **Shop map / Jake Korb shelving** — blocks real combination location IDs; not blocking away-042.
