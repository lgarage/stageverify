# StageVerify Roadmap (V2)

> **Format:** NOW / NEXT / LATER / MAYBE — aggressive prioritization for Composer and technical leads  
> **Phase source:** `docs/archives/stageverify_implementation_plan.md` (archived; superseded by this file)  
> **Operational tracker:** `docs/project_state.md` — canonical phase truth (update after each gate)  
> **Last updated:** 2026-06-04

---

## NOW

**Active phase: Phase 2 — Material Readiness Data Model**

Phase 1 (Stabilize) is **complete**. Do not start Phase 3 UI until Phase 2 gate passes.

### Phase 2 — Material Readiness Data Model

| Item | Deliverable |
|------|-------------|
| **2.1** | Extend `src/dispatcher/models.ts` with V2 types (no breaking changes to existing interfaces) |
| **2.2** | Add conceptual fields: readiness (`ordering` / `not_ready` / `ready_for_pickup` / `picked_up`), `materialOwner`, `expectedMaterials`, structured shop stock |
| **2.3** | Add stub types: `MaterialIssue`, `IssueResolution`, `VendorEmailEvent`, `AICorrection`, `AIConfidenceScore`, `humanReviewRequired` |
| **2.4** | Plan Firestore collection names (`materialIssues`, `vendorEmailEvents`, `aiCorrections`, `vendorKnowledge`) — implement read/write helpers only if gate requires persistence in Phase 2 |
| **2.5** | Update mock/seed data if present; ensure existing UI still loads all deliveries |
| **2.6** | Firestore rules: **additive only** if new collections written in Phase 2 — security gate mandatory |

**Success criteria (gate):**

- [ ] `npm run build` passes
- [ ] Existing workflows: vendor check-in, dispatcher drawer, pickup Done, zone QR routing — unchanged behavior
- [ ] New fields optional on documents; no required migration of production data
- [ ] `docs/project_state.md` updated to Phase 2 complete
- [ ] Playwright: `verify:pickup`, `verify:receive`, `verify:dispatcher-nav` (or equivalent) pass

**Known blockers:**

| Blocker | Affects | Notes |
|---------|---------|-------|
| Architecture docs in progress | Phase 2 start | Complete `stageverify_v2_architecture.md` + this roadmap before first model PR |
| None for Phase 2 code | — | ESL/Minew creds block Phase 7 only |

**Pre-Phase-2 documentation (NOW-adjacent):**

- [x] Principles doc exists (`stage_verify_principles.md`)
- [x] Implementation plan exists (`docs/archives/stageverify_implementation_plan.md`)
- [x] V2 architecture doc + transition report + this roadmap (authoritative for agents)

---

## NEXT

Expected immediately after Phase 2 gate passes.

### Phase 3 — Technician Pickup Workflow

| Deliverable | Detail |
|-------------|--------|
| Pickup UI | Customer, address, job #, PO #, location, **Expected Materials**, shop stock |
| Actions | **Everything Present** → `picked_up` + `PickupEvent`; **Report Issue** → `MaterialIssue` |
| Assignment | Material Owner attached on issue create |
| Testing | Scenario A (happy path) + Scenario B (issue creation) per implementation plan |
| Playwright | Extend `verify:pickup` for issue button + dashboard visibility |

**Gate:** Successful pickup + issue creation without manual DB edits.

### Phase 4 — Material Issue Resolution

| Deliverable | Detail |
|-------------|--------|
| Owner UI | Open issue, select resolution type, submit |
| Resolution types | Found in Shop, Pick Up at Supply House, Vendor Redeliver, Substitute, Transfer, Continue Without, Hold Job, Other |
| Tech UI | View resolution status |
| History | Resolution + status history stored |

**Gate:** End-to-end Issue Created → Assigned → Resolved → Closed for all resolution types.

---

## LATER

Validated in the implementation plan; not started until Phases 3–4 are stable.

### Phase 5 — Vendor Email Parsing Prototype

- Sample emails only (Johnstone, Ferguson, First Supply) — **no live inbox**
- Extract vendor, PO, customer, delivered/missing/backordered, delivery status
- Confidence: high → auto path; low → human review flag
- **Gate:** 95% extraction accuracy on sample set; low-confidence routed to review

### Phase 6 — Vendor Email Monitoring

- Live email automation → readiness + pickup eligibility updates
- Handle complete, partial, backorder, unknown PO
- **Gate:** No false Ready For Pickup; unknown emails to review queue

### Phase 7 — E-Tag Automation (Minew ESL)

- Auto-update tag: job name, PO, location, readiness state
- **Gate:** Tag state matches StageVerify; no manual ESL portal edits
- **Blocker:** Minew API credentials (see `PROJECT_STATUS/ESL_INTEGRATION_PLAN.md`)

### Phase 8 — AI Learning & Correction Engine

- Vendor Knowledge Base, Human Correction DB, confidence tracking, rule generation
- **Gate:** Stable storage; demonstrated learning (same mistake does not repeat)

### Phase 9 — AI Recommendations

- Staging suggestions, delivery complexity, vendor risk, issue hints — **≥90% confidence**, explainable, overridable, disableable
- **Gate:** Acceptance/override logging; recommendations can be disabled

### Cross-cutting (LATER)

| Item | Notes |
|------|-------|
| Security audit (away-007) | Done — see `PROJECT_STATUS/security-report-2026-06-02.md` |
| `listDeliveries` pagination | Technical debt; acceptable until ~500+ deliveries |
| Shared types in Cloud Functions | Refactor CF `DeliveryStatus` duplicate |
| Shop map / location IDs | Blocked on Jake Korb shelving decision |

---

## MAYBE

Interesting or mentioned in principles; **not** in the current 9-phase gate sequence. Do not implement without explicit approval.

| Idea | Why MAYBE |
|------|-----------|
| BuildOps integration | Consume existing job data — no API spec in plan |
| Slack/email notifications for Material Owner | Ops convenience, not core loop |
| Mobile native scanner app | Web QR flow works today |
| Multi-tenant / multi-shop | Single-shop MVP scope |
| Technician authentication | Pickup remains public by design |
| Inventory / stock-on-hand | Explicit non-goal |
| Purchasing / PO creation in-app | Explicit non-goal |
| Dispatch / truck routing | Explicit non-goal |
| Accounting / cost tracking | Explicit non-goal |
| Physical shop map UI | Blocked on shelving + map asset |
| Gemini model upgrades | Infrastructure choice, not product phase |

---

## Phase map (quick reference)

| Phase | Name | Roadmap bucket | Status |
|-------|------|----------------|--------|
| 1 | Stabilize | — (complete) | ✅ Gate passed |
| 2 | Material Readiness Data Model | **NOW** | 🔵 Active |
| 3 | Technician Pickup Workflow | **NEXT** | ⬜ |
| 4 | Material Issue Resolution | **NEXT** | ⬜ |
| 5 | Vendor Email Parsing Prototype | **LATER** | ⬜ |
| 6 | Vendor Email Monitoring | **LATER** | ⬜ |
| 7 | E-Tag Automation | **LATER** | ⬜ (blocked: Minew) |
| 8 | AI Learning & Correction | **LATER** | ⬜ |
| 9 | AI Recommendations | **LATER** | ⬜ |

---

## Relationship to other status files

- **`docs/project_state.md`** — canonical phase truth (features, deployment, known issues).
- **`docs/roadmap.md` (this file)** — V2 phase prioritization for agents and Phase 2+ work.
- **`PROJECT_STATUS/CURRENT_STATE.md`** — hot-tier snapshot (~30 lines); pointers only.

When a V2 phase ships, update **both** `docs/project_state.md` and `PROJECT_STATUS/CURRENT_STATE.md` per ship-loop. Session history goes to `PROJECT_STATUS/archives/`.
