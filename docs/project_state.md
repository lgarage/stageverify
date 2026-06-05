# StageVerify — Project State

> **Canonical phase truth** — single source for current phase, features, deployment status, and known issues.
> Hot-tier agents: read `PROJECT_STATUS/CURRENT_STATE.md` first; load this file for phase/roadmap decisions.
> **Maintained by:** Composer 2.5 (update after major milestones)
> **Last reviewed:** 2026-06-04

---

## Current Vision

**StageVerify V2 — Material Readiness Platform**

Ensure technicians leave the shop with everything needed to successfully complete a job.
StageVerify is not a WMS, ERP, or inventory system. It is a material readiness and
accountability layer that sits between purchasing, vendors, the staging shop, and
field technicians.

---

## Current Phase

**Phase 1 — Stabilize Current Platform** ✅ COMPLETE (gate passed)

The MVP lifecycle is fully operational:
`Ordered → Shipped → Received → Staged → Picked Up → Installed`

The platform is deployed and functional on GitHub Pages.

**Next active phase:** Phase 2 — Material Readiness Data Model
(Extend the data model to express V2 concepts without breaking Phase 1 workflows.)

---

## Deployment Status

| Environment | URL | Status |
|---|---|---|
| Production (GitHub Pages) | https://lgarage.github.io/stageverify | ✅ Live |
| Firebase project | stageverify-db (Blaze) | ✅ Active |
| Cloud Functions | us-central1 | ✅ Deployed (`autoSubmitDeliveries`) |
| Firestore rules | stageverify-db | ✅ Deployed |
| ESL / Minew integration | Cloud Function stub ready | 🔴 Blocked on vendor credentials |

---

## Verified Working Features

| Feature | Route | Actor | Notes |
|---|---|---|---|
| Vendor Check-In | `/#/` and `/#/receive` | Vendor driver | Scan QR → verify items → submit |
| Dispatcher Dashboard | `/#/dispatcher` | Dispatcher (auth) | Full delivery list, status, search |
| Delivery Detail Drawer | (inside dispatcher) | Dispatcher | Status changes, staging, shop stock, PO |
| Staging Assignment | Settings → Zones | Dispatcher | CRUD zones, occupancy guard |
| QR Routing | Scan any tag | Any actor | Zone code → correct portal based on status |
| Pickup Portal | `/#/pickup` | Technician (public) | Verify items + shop stock → Done |
| E-Tag / Zone Labels | `/#/zones` (Print) | Dispatcher | Minew ESL QR + print label |
| Vendor Management | `/#/vendors` | Dispatcher (auth) | CRUD vendors |
| Zone Management | `/#/zones` | Dispatcher (auth) | CRUD staging locations |
| App Settings | `/#/settings` | Dispatcher (auth) | Revert window, auto-submit timer, ESL tag ID |
| Auto-Submit | Cloud Function | System | Submits after inactivity timeout |
| Status History | (inside drawer) | All | Audit trail per delivery |
| Need More Space | Vendor check-in done screen | Vendor | Tiered overflow staging flow |

---

## Known Issues

| # | Description | Severity | Blocked by |
|---|---|---|---|
| 1 | ESL Minew tag updates not live | High | Waiting on Minew vendor credentials |
| 2 | No shop physical map — location IDs unassigned | Medium | Waiting on Jake Korb shelving decision |
| 3 | `listDeliveries` loads full collections in memory (no Firestore pagination) | Medium | Technical debt — acceptable at current scale |
| 4 | `autoSubmitDeliveries` CF misses `shipped` status (only handles `arrived`) | Low | Minor scope gap |

---

## Open Risks

| Risk | Impact | Likelihood |
|---|---|---|
| Minew API credential delay blocks ESL demo | High (demo blockers) | High (waiting) |
| No vendor email processing — V2 AI workflow depends on it | High (V2 roadmap) | Low (future phases) |
| Data model migration (V2 fields) may break existing Firestore reads | Medium | Medium |
| Feature creep pulling toward ERP/inventory | High | Medium |

---

## Technical Debt

| Item | File | Notes |
|---|---|---|
| Full-collection reads on `listDeliveries` | `firestoreService.ts` | No server-side filter/sort. Scales to ~500 items today. |
| `autoSubmitDeliveries` CF has duplicate `DeliveryStatus` type | `functions/src/index.ts` | Should import from shared types in V2 |
| Vendor check-in (`App.tsx`) is a monolithic component | `src/App.tsx` | Should be broken into smaller components |
| No error boundary on public portals | All portal pages | Silent failures on network errors |
| `shopStockPickListItems` is a free-text array | `models.ts` | V2 should evolve this toward structured `MaterialItem` |

---

## Reusable Components for V2

| Component | Current Role | V2 Role |
|---|---|---|
| `DeliveryOrder` model | Core tracking entity | Extend with `materialOwner`, `readinessStatus` |
| `Item` model | Line-item tracking | Extend with `partClassification`, `vendorEmailEventId` |
| `StatusHistoryEvent` | Audit trail | Reuse as-is; AI events can use `actorType: "system"` |
| `PickupEvent` | Technician pickup record | Extend with `issueIds[]` for linked issues |
| `firestoreService.ts` | Data access layer | Add new collections (issues, vendor events, corrections) alongside existing ones |
| `DispatcherDashboardPage` | Delivery list + management | Gain "Material Issues" and "Readiness" columns |
| `PickupPortalPage` | Technician pickup | Gain "Report Issue" flow |
| `QR routing` | Status-aware scan routing | Reuse — add `not_ready` route target |
| `StatusHistory` | Status audit trail | Reuse — AI corrections stored here |
| `Vendor` model | Vendor entity | Extend with `emailDomain`, `knowledgeBaseRef` |
| `PortalSidebar` | Dispatcher nav | Gain "Issues" nav item |

---

## Immediate Next Steps

1. **Architecture review and documentation** — complete V2 architecture docs before code changes. ← (this document is part of that)
2. **Phase 2: Material Readiness Data Model** — extend `models.ts` with new V2 types (`MaterialIssue`, `VendorEmailEvent`, `MaterialOwner`, `IssueResolution`, `AICorrection`) without breaking existing workflows.
3. **ESL integration** — resume when Minew credentials arrive (see `PROJECT_STATUS/ESL_INTEGRATION_PLAN.md`).
4. **Security audit** — complete (away-007 done; see `PROJECT_STATUS/security-report-2026-06-02.md`).
