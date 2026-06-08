# StageVerify Roadmap (V2) - C:\Projects\stageverify\docs\roadmap.md

> **Format:** NOW / NEXT / LATER / MAYBE — aggressive prioritization for Composer and technical leads  
> **Authority chain:** `docs/project_state.md` = canonical phase truth (features, deployment, known issues, current phase); **`docs/roadmap.md` (this file)** = V2 phase prioritization and gates for agents and Phase 2+ work; `PROJECT_STATUS/CURRENT_STATE.md` = hot-tier snapshot (~30 lines; pointers only); `docs/archives/stageverify_implementation_plan.md` = **historical reference only** — not active agent guidance. Memory-system audit (archived): `PROJECT_STATUS/archives/MEMORY_ARCHITECTURE_ASSESSMENT.md`.  
> **Scope:** This file summarizes priorities and gates — it is not a detailed implementation plan and must not drift into one.  
> **Last updated:** 2026-06-08

> **BuildOps boundary:** StageVerify does not replicate BuildOps. BuildOps owns: inventory counts, stock levels, reorder points, purchasing. StageVerify owns: material readiness, material location, pickup verification, material issues, vendor accountability.

---

## NOW (Phase 2 complete)

**Phase 2 — Material Readiness Data Model** ✅ Gate passed 2026-06-08. Active work is Phase 3 (see NEXT).

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

**Active phase: Phase 3 — Technician Pickup Workflow**

Phase 2 gate passed 2026-06-08. Do not start Phase 4 until Phase 3 gate passes.

### Phase 3 Slice 1 — Report Issue + dispatcher visibility ✅ (shipped 2026-06-08)

| Item | Status |
| ---- | ------ |
| Report Issue (pickup portal) | ✅ Modal + `createMaterialIssue` callable CF |
| Blocking behavior | ✅ Warning banner only — **Done flow unchanged**; no `delivery.status → issue` |
| Dispatcher visibility | ✅ `Issues (n)` badge + read-only Material Issues panel |
| Firestore | ✅ `materialIssues` auth-read-only; indexes; denormalized counts on delivery |
| Verify | ✅ `verify:pickup` (Scenarios A+B), `verify:material-issue-dashboard`, fixture resets |
| Sonnet security gate | ✅ PASS WITH NOTES (counter-in-transaction, scoped `clientRequestId`) |

**Not in Slice 1 / still Phase 3:** expected-materials UI, shop-stock pull states, readiness-aware queue, unstaged display polish.

### Phase 3 — Technician Pickup Workflow (full gate)

| Deliverable            | Detail                                                                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pickup UI              | Customer, address, job #, PO #, location, **Expected Materials**, shop stock                                                                                                                                                 |
| Queue eligibility      | Job appears in pickup queue when the overall package is **`ready_for_pickup`** (business readiness) — distinct from detail visibility                                                                                         |
| Detail visibility      | Once open, **all** material states are visible: staged, received-but-unstaged, shop-stock, missing, backordered, substituted, waived, exceptions — the _"What do I still need to grab?"_ goal applies to this detail view, not queue eligibility |
| Material location      | Pickup screen shows **current location** (where material actually is), not only assigned staging zone                                                                                                                      |
| Shop + vendor mix        | Shop stock items appear alongside vendor-delivered items in pickup verification                                                                                                                                              |
| Shop-stock pull states | Not Pulled / Pulled / Staged UI for pickup accountability (what to pull, where to find it) — not inventory tracking; not a committed Phase 2 state machine                                                                     |
| Unstaged deliveries    | **Display only:** show already-known received-but-unstaged material in the pickup detail view (no new office workflow in Phase 3)                                                                                            |
| Pickup framing         | Goal: _"What do I still need to grab?"_ — not workflow state labels                                                                                                                                                          |
| Actions                | **Everything Present** → `picked_up` + `PickupEvent`; **Report Issue** → `MaterialIssue`                                                                                                                                   |
| Assignment             | Material Owner attached on issue create                                                                                                                                                                                      |
| Testing                | Scenario A (happy path) + Scenario B (issue creation) per implementation plan                                                                                                                                                |
| Playwright             | Extend `verify:pickup` for issue button + dashboard visibility                                                                                                                                                               |

**Gate:** Successful pickup + issue creation without manual DB edits. **Slice 1 satisfies issue-creation + dispatcher visibility; full gate requires remaining pickup UI deliverables above.**

### Phase 4 — Material Issue Resolution

| Deliverable      | Detail                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| Owner UI         | Open issue, select resolution type, submit                                                                        |
| Resolution types | Found in Shop, Pick Up at Supply House, Vendor Redeliver, Substitute, Transfer, Continue Without, Hold Job, Other |
| Tech UI          | View resolution status                                                                                            |
| History          | Resolution + status history stored                                                                                |

**Gate:** End-to-end Issue Created → Assigned → Resolved → Closed for all resolution types, using defined test scenarios per implementation plan.

---

## LATER

Phases 5–9 are sequenced here for prioritization; not started until Phases 3–4 are stable. Historical detail in `docs/archives/stageverify_implementation_plan.md` — not active guidance.

### Phase 5 — Vendor Email Parsing Prototype

- Sample emails only (Johnstone, Ferguson, First Supply) — **no live inbox, no production automation**
- Offline prototype with controlled sample emails only — domain-based live-email identification (`emailDomain`) **not required** in Phase 5
- Extract vendor, PO, customer, delivered/missing/backordered, delivery status
- AI may extract, classify, match, score, explain, and **propose** updates for human review — AI may **not** update operational records or change readiness/delivery status
- Confidence: high confidence → proposed auto-processing for human review in Phase 5; actual automation is Phase 6+ only after an approved automation gate
- **Gate:** ≥95% extraction accuracy on approved sample set using defined scoring method; low-confidence routed to review

### Phase 6 — Vendor Email Monitoring

- `emailDomain` (vendor email domain matching) — Phase 6+ operational concern for live inbox monitoring; a conceptual optional field on `Vendor` may appear earlier only if the Phase 2 data-model gate explicitly requires it
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
| Security audit (away-007)       | Done — see `PROJECT_STATUS/security-report-2026-06-02.md` |
| `listDeliveries` pagination     | Technical debt; acceptable until ~500+ deliveries         |
| Shared types in Cloud Functions | Refactor CF `DeliveryStatus` duplicate                    |
| Shop map / location IDs         | Blocked on Jake Korb shelving decision                    |

---

## MAYBE

Interesting or mentioned in principles; **not** in the current 9-phase gate sequence. Do not implement without explicit approval.

| Idea                                         | Why MAYBE                                       |
| -------------------------------------------- | ----------------------------------------------- |
| BuildOps integration                         | Consume existing job data — no API spec in plan |
| Slack/email notifications for Material Owner | Ops convenience, not core loop                  |
| Mobile native scanner app                    | Web QR flow works today                         |
| Multi-tenant / multi-shop                    | Full multi-tenant customer-facing product experience is out of MVP scope; making the data model tenant-safe now ≠ building a multi-tenant admin product — tenant-safe data boundaries remain a design consideration regardless |
| Technician authentication                    | Pickup remains public by design                 |
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
| 3     | Technician Pickup Workflow     | **NEXT**       | 🔵 Active           |
| 4     | Material Issue Resolution      | **NEXT**       | ⬜                  |
| 5     | Vendor Email Parsing Prototype | **LATER**      | ⬜                  |
| 6     | Vendor Email Monitoring        | **LATER**      | ⬜                  |
| 7     | E-Tag Automation               | **LATER**      | ⬜ (blocked: Minew) |
| 8     | AI Learning & Correction       | **LATER**      | ⬜                  |
| 9     | AI Recommendations             | **LATER**      | ⬜                  |
| —     | AECS conversion (control plane) | **LATER**      | 🔵 Phase 1 audit done — see `docs/aecs-phase1-audit.md` |

---

## Relationship to other status files

| File | Role |
| ---- | ---- |
| **`docs/project_state.md`** | Canonical phase truth — features, deployment, known issues, current phase |
| **`docs/roadmap.md` (this file)** | V2 phase prioritization and gates for agents; summarizes priorities — not a detailed implementation plan |
| **`PROJECT_STATUS/CURRENT_STATE.md`** | Hot-tier snapshot (~30 lines); pointers only — read first each session |
| **`docs/aecs-phase1-audit.md`** | AECS conversion audit (Layer 2) — control-system inventory, boundaries, Phase 2 plan; planning only, not live agent guidance |
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
| Hot snapshot / blockers / next steps | `PROJECT_STATUS/CURRENT_STATE.md` |
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
