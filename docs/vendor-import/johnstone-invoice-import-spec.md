# Johnstone Invoice Import Spec

> **Audience:** Engineers and agents implementing Phase 5+ vendor document ingestion  
> **Status:** Design spec — not implemented in code  
> **Last updated:** 2026-06-24  
> **Companion docs:** `docs/stageverify_v2_architecture.md` §4, `docs/roadmap.md` Phase 5, `docs/project_state.md`  
> **Sample structure reference:** Sioux Falls Johnstone multi-invoice PDF (local only — do not commit PDFs)

---

## 1. Purpose & non-goals

### Purpose

Define how StageVerify ingests **Johnstone Supply branch invoices** (PDF) to create **expected vendor-order records** — what Twin Pillar ordered, from which Johnstone branch, for which customer PO / job context, with line-level quantities and operational notes — **without** treating invoice import as shop receipt or readiness completion.

Invoice import is **Condition 1 evidence** (vendor order completeness / expected items), analogous in intent to Phase 5 email parsing but sourced from structured PDF documents rather than unstructured email bodies.

### Goals

| Goal | Detail |
| ---- | ------ |
| Expected material visibility | Dispatchers see what Johnstone invoiced/shipped before physical shop receipt |
| Search & accountability | PO, job hints, customer names, invoice #, product numbers searchable on dispatcher board |
| Will-Call / Pickup handling | Pickup-at-branch orders visible with correct status and UX (no false staging) |
| Line fidelity | Ordered/shipped/backordered qty per line; operational notes preserved |
| Re-upload safety | Detect adds/removes/changes when the same invoice batch is uploaded again |
| Human review path | Low-confidence extractions route to Gavin (or designated reviewer) before applying |

### Non-goals

| Non-goal | Rationale |
| -------- | --------- |
| Accounts payable / payment | Ignore pricing, tax, terms, BillTrust URLs, enrollment tokens |
| Shop receipt | Import does **not** set `qtyReceived`, physical drop-off, or staging location |
| Readiness automation | Import alone must **not** declare material ready for technician pickup at the shop |
| Inventory / stock-on-hand | Truck stock and TOPS STOCK lines are visibility only — not ERP inventory |
| Technician auto-assignment | Never infer technician from PO text (TOPS STOCK, TRUCK STOCK, etc.) |
| Salesperson capture | Ignore Salesman codes (SAD, BBTO, RML, etc.) |
| Floor-Loc | Ignore warehouse bin hints entirely |
| Live Minew / ESL | Out of scope; no vendor platform API details in this repo |

---

## 2. Relationship to Phase 5 email prototype

Phase 5 shipped an **offline email parsing prototype** (`src/dispatcher/email/`, `EMAIL_FIXTURES`, `processInboundVendorEmail` CF). Email and invoice ingestion share goals but differ in source shape and scope.

| Dimension | Phase 5 email prototype | Johnstone invoice import (this spec) |
| --------- | ------------------------ | ------------------------------------ |
| Source | Plain-text sample emails (`emailFixtures.ts`) | Branch invoice PDFs (multi-page batches) |
| Transport | Fixture replay / future Gmail (Phase 6) | Manual upload or future automated fetch (TBD) |
| Primary match keys | PO, ORD-*, job hints in subject/body | Invoice #, Sales Order #, Customer P/O #, Customer # |
| Condition 1 write | High-confidence `vendorOrderComplete` proposal/auto-apply (email path) | Creates/updates **expected vendor order** + line items from invoice structure |
| Shop physical state | Unchanged by email alone | Unchanged by invoice alone |
| UI today | Proposed updates panel, Vendor Communications drawer | **Not built** — spec only |
| Confidence | Parser score + human review queue | Extraction confidence + Gavin review on ambiguity |

**Reuse (future implementation):**

- `Vendor`, `PurchaseOrder`, `DeliveryOrder` linking patterns from architecture §4
- Confidence + human-review policy from AI authority policy (`stageverify_v2_architecture.md` §4)
- Dispatcher search/list patterns (`DispatcherDashboardPage`, `deliveryDisplayHelpers.ts`)
- Audit/event patterns similar to `VendorEmailEvent` (separate collection TBD for invoice imports)

**Do not conflate:**

- Email fixtures (`msg-po-ack-001`, etc.) are **not** invoice PDFs; do not extend email parser fixtures to cover PDF line tables without a dedicated PDF pipeline.
- Invoice import status enum (`pickup_at_vendor`, `closed_picked_up`) is **import-domain planned** — not yet in `DeliveryStatus` (`models.ts`).

---

## 3. Johnstone branch model

Johnstone invoices identify the **fulfilling branch** (not Twin Pillar's Green Bay ship-to address).

### Branch fields (per import batch / per invoice)

| Field | Source on PDF | Example (Sioux Falls sample) |
| ----- | ------------- | ---------------------------- |
| `vendorBranchName` | Remit To block | Johnstone Supply |
| `vendorBranchAddress` | Remit To street + city/state/zip | 335 N Weber Ave, Sioux Falls SD 57103 |
| `vendorBranchPhone` | Footer "please call …" | 605-338-2652 |
| `customerAccountNumber` | Customer # (header row) | 0018114 |

### Sold To / Ship To (customer context — not branch)

Captured for search and job matching; typically identical on sample invoices:

| Field | Example |
| ----- | ------- |
| `soldToName` | TWIN PILLAR HEATING & COOLING |
| `shipToName` | TWIN PILLAR HEATING & COOLING |
| `shipToAddress` | 2944 HOLMGREN WAY, GREEN BAY WI 54304 |
| Sold To phone | 920-687-5081 (optional capture; ship-to phone often blank) |

**Rule:** Branch phone (605…) ≠ customer phone (920…). Store both only when explicitly labeled; branch phone is required for dispatcher "call branch" UX.

---

## 4. Fields to capture

### Header-level (one record per invoice page)

| Field | PDF label | Notes |
| ----- | --------- | ----- |
| `vendorOrderNumber` | Sales Order # | e.g. `6164159` — primary vendor-side order key |
| `vendorInvoiceNumber` | Invoice # | Often matches Sales Order # on samples; still capture both |
| `customerPoOrReference` | Customer P/O # | **Exactly as printed** — e.g. `PLANET FITNESS PICKUP`, `TRUCK STOCK PICKUP` |
| `quoteNumber` | Invoice Message block | e.g. `Q618768` when present |
| `orderDate` | Order Date | ISO date normalization from `MM/DD/YYYY` |
| `invoiceDate` | Invoice Date | |
| `shipDate` | Ship Date | May be `MM/DD/YY` — normalize carefully |
| `buyerName` | Buyer | e.g. `CONNOR SMITH`, `GAVIN PHILIPPON` |
| `shipViaRaw` | Ship Via column | e.g. `TRUCK DELIVE`, blank on pickup rows |
| `fulfillmentMethod` | Inferred (light) | `delivery` \| `will_call_pickup` \| `unknown` — see §4.1 |
| `freightTermsRaw` | Freight Terms | Capture raw; do not drive business logic |
| `jobNumberRaw` | Job Number | Often blank on samples |
| `importBatchId` | System | Links multi-invoice PDF upload |
| `sourceDocumentFingerprint` | System | Hash of PDF bytes or page text for dedup |

### 4.1 Fulfillment method inference (light)

| Signal | `fulfillmentMethod` | Typical import status |
| ------ | ------------------- | --------------------- |
| Customer P/O # contains `PICKUP` (e.g. PLANET FITNESS PICKUP, EXHAUST FANS PICKUP, TRUCK STOCK PICKUP, TOPS STOCK PICKUP, inventory PICKUP) | `will_call_pickup` | `pickup_at_vendor` |
| Ship Via = `TRUCK DELIVE` (truncated "DELIVERY") | `delivery` | `pending` / `partial` / `ready_for_pickup` per line qty |
| Ambiguous (repair PO text, missing both) | `unknown` | `pending` + review flag if high value |

**Do not** overwrite `customerPoOrReference` when inferring; inference is a separate field.

---

## 5. Explicit ignore list

Never parse, store, or display to dispatchers for operational decisions:

| Category | Examples from sample PDF |
| -------- | ------------------------ |
| Floor-Loc | `Floor-Loc: YELLOW`, `Floor-Loc: GREEN`, `Floor-Loc: PUG` |
| Salesperson / order taker | Salesman column: SAD, BBTO, RML, DDJ, CM, BB; Writer: line |
| Freight payment flags | `CUSTOMER PAYS FREIGHT` |
| Promotional / catalog flags | `Above Item is on Special` |
| Pricing & money | LIST PRICE, EACH PRICE, EXTENSION, Merchandise, Freight, Sub Total, Tax, TOTAL, discount lines |
| Payment terms | `PREPAID& ADD 1% 10th Net 11th`, Take 1% Discount, Pay By |
| Payment portal | BillTrust URL, `ENROLLMENT TOKEN`, Sent Copy |
| AP / accounting | Remit To (except branch identity), signature proof timestamps for AP |
| Inbound freight line items | `INBOUND FREIGHT` dollar rows (not product lines) |
| Negative return/core settlement lines | Return from Invoice # … with negative qty (see §6) |

---

## 6. Line items

### Fields per line

| Field | PDF column | Notes |
| ----- | ---------- | ----- |
| `lineNumber` | LN | Integer |
| `quantityOrdered` | QNTY ORD | |
| `quantityShipped` | QNTY SHIP | |
| `quantityBackordered` | QNTY B/O | >0 ⇒ backorder flag |
| `vendorProductNumber` | PRODUCT NUMBER (first token) | e.g. `L46-668`, `NS10762605` |
| `manufacturerOrModelNumber` | PRODUCT NUMBER (second token) / description | e.g. `TH8320R1003/U`, `105105` |
| `description` | DESCRIPTION (+ continuation lines) | Multi-line descriptions merged |
| `filteredNotes` | Non-column text under line | Operational only — see §6.1 |
| `lineType` | Derived | `product` \| `core_charge` \| `return` \| `freight` \| `ignored` |
| `excludeFromExpectedItems` | Derived boolean | true for returns, negative qty, core charges |

### 6.1 Operational notes (keep)

Attach to line or order when printed near line/block:

- Lead time: `2 DAY LEAD`
- Non-stock / restock: `NON STOCK, RESTOCK FEE APPLIES`
- Backorder narrative (when not solely qty B/O column)
- Repair block headers (e.g. `REPAIR...` section) — store as order note, not a line SKU

### 6.2 Exclusions from expected / staging / pickup checklist

| Pattern | Handling |
| ------- | -------- |
| `quantityBackordered > 0` | Include in expected items **with** backorder state; blocks readiness until resolved (align with existing `unresolved_backorder` in `deliveryDisplayHelpers.ts`) |
| Negative qty / "Return from Invoice #" | `lineType: return`, `excludeFromExpectedItems: true` |
| `CORE-*` product numbers | `lineType: core_charge`, `excludeFromExpectedItems: true` |
| INBOUND FREIGHT pseudo-lines | `lineType: freight`, exclude |

### 6.3 Product number parsing

Johnstone lines often use: `{vendorSku} {mfgModel} {description...}`

Example: `L46-668 TH8320R1003/U THERMOSTAT` → vendor `L46-668`, model `TH8320R1003/U`, description continues on next lines.

---

## 7. Status model & dispatcher labels (internal vs display)

### Import-domain status enum (planned)

These values apply to **vendor-order records created from invoice import**. They are **not** identical to today's `DeliveryStatus` in `models.ts`.

| Internal enum | When set | Dispatcher-facing label (ONLY) |
| ------------- | -------- | -------------------------------- |
| `pending` | Delivery order expected; no complete ship signal; not will-call | Pending Delivery |
| `partial` | Some lines shipped/qty short/backorder mix | Partial |
| `ready_for_pickup` | All expected lines shipped to shop context; **shop-staged path** (normal delivery) | Ready for Pickup |
| `pickup_at_vendor` | Will-call / branch pickup (Customer P/O # or fulfillment inference) | **Will-Call / Pickup.** |
| `closed_picked_up` | Will-call order picked up from branch (manual or confirmed) | **Closed / Picked Up.** |
| `issue` | Data conflict, parse failure, or business exception | Issue / Action Needed |

**Critical terminology rule:** Dispatchers never see raw `pickup_at_vendor`. They see **"Will-Call / Pickup."** (including the period). After pickup, **"Closed / Picked Up."**

### Mapping vs current codebase (`models.ts`)

| Planned import status | Current `DeliveryStatus` | Gap |
| --------------------- | ------------------------ | --- |
| `pending` | `pending` | Exists (V1 list may show "Ordered" — import dispatcher label **Pending Delivery**) |
| `partial` | `partial` | Exists |
| `ready_for_pickup` | `ready_for_pickup` | Exists (V1 label "Staged" — import/dispatcher copy should use readiness-aware labels via `deliveryDisplayHelpers.ts`) |
| `pickup_at_vendor` | — | **Missing** — requires new enum or parallel `vendorOrderStatus` field |
| `closed_picked_up` | — | **Missing** — distinct from `picked_up` (shop pickup complete) |
| `issue` | `issue` | Exists (import dispatcher label **Issue / Action Needed**; V1 readiness helper may show "Issue / Review Required") |

**Implementation note (future):** Prefer a dedicated import/vendor-order status field rather than overloading V1 `DeliveryStatus` until readiness model alignment is designed. Display must go through `deliveryDisplayHelpers.ts` / `deliveryReadinessDisplayLabel` patterns — never raw enum in UI.

### Status decision table (invoice import)

| Condition | Import status | Dispatcher label |
| --------- | ------------- | ---------------- |
| `fulfillmentMethod = will_call_pickup` and not closed | `pickup_at_vendor` | **Will-Call / Pickup.** |
| Will-call confirmed picked up at branch | `closed_picked_up` | **Closed / Picked Up.** |
| `fulfillmentMethod = delivery`, all lines fully shipped, no B/O | `ready_for_pickup` only when **separate** shop receipt evidence exists; else `partial` or `pending` | Use readiness display helpers |
| Any line `quantityBackordered > 0` | At least `partial`; may set `issue` if unresolved | Partial / Issue / Action Needed per readiness |
| Parse/conflict on re-upload | `issue` | Issue / Action Needed |

**Invoice import alone never sets shop `ready_for_pickup` readiness.** Expected lines populate Condition 1; physical receipt remains Condition 2.

---

## 8. Will-Call / Pickup behavior

Orders with import status `pickup_at_vendor` (label **Will-Call / Pickup.**):

| Behavior | Rule |
| -------- | ---- |
| Dispatcher board | Visible, searchable (PO, customer name, invoice #, buyer, branch) |
| Staging location | **No** SV staging location assigned automatically |
| Shop-staged flag | **Not** shop-staged — material is at Johnstone branch |
| Job staging / pickup portal | **No** job staging unless dispatcher manually classifies/links to a job delivery |
| Technician checklist | **Exclude** from shop pickup checklist until manually reclassified or closed |
| QR / `/#/receive` | Must not open vendor receive flow for will-call-only expected records |
| Closeout | When tech picks up at branch, transition to `closed_picked_up` (**Closed / Picked Up.**) |

---

## 9. Technician / PO heuristics forbidden

**Never** auto-assign `technicianId`, material owner, or job crew from Customer P/O # text.

| PO text pattern | Forbidden inference |
| --------------- | ------------------- |
| `TOPS STOCK PICKUP` | Assign to TOPS technician |
| `TRUCK STOCK PICKUP` | Assign to truck / default tech |
| `inventory PICKUP` | Treat as shop inventory owner |
| Buyer name | Assign to buyer as technician |
| Job name fragments in PO | Auto-link to BuildOps job |

Allowed: store raw `customerPoOrReference`, classify `fulfillmentMethod`, flag `truck_stock` / `inventory` **categories** for search filters only (manual classification UI later).

---

## 10. Inventory / truck stock orders

| PO pattern (examples) | Visibility | Staging | Job link |
| --------------------- | ---------- | ------- | -------- |
| `TRUCK STOCK PICKUP` | Searchable on board | None automatic | Manual only |
| `TOPS STOCK PICKUP` | Searchable | None automatic | Manual only |
| `inventory PICKUP` | Searchable | None automatic | Manual only |

Treat as **Will-Call / Pickup.** when picked up at branch (`pickup_at_vendor` → `closed_picked_up`). Do not create shop expected-receipt pressure or staging assignments unless a dispatcher explicitly links to a job delivery.

---

## 11. Multi-invoice PDFs

Sample PDF: **8 invoices**, each `Page 1/1`, one invoice per PDF page.

| Rule | Detail |
| ---- | ------ |
| Batch identity | Single upload ⇒ one `importBatchId` |
| Record count | **One vendor order per invoice page** (8 orders from 8 pages) |
| Shared customer # | Same `customerAccountNumber` across pages allowed |
| Failure isolation | Page-level parse errors do not discard successful pages; mark failed pages `issue` |
| Ordering | Process pages in sequence; preserve `pageIndexInBatch` |

---

## 12. Re-upload / dedup / change detection

| Scenario | Behavior |
| -------- | -------- |
| Exact duplicate PDF (fingerprint match) | No-op or idempotent refresh; log duplicate upload |
| Same `vendorInvoiceNumber`, changed lines | Diff lines: added / removed / changed qty or product |
| Same invoice #, immaterial metadata change | Auto-update header fields with audit log |
| Conflicting totals vs line sum | Flag `issue`; do not silently fix |
| Removed line on new upload | Mark line removed from expected set (soft-delete with audit) |
| New line on re-upload | Add to expected set |

Compare key: `vendorInvoiceNumber` + `vendorBranchPhone` + `customerAccountNumber`.

---

## 13. Confidence & human review

| Tier | Criteria | Action |
| ---- | -------- | ------ |
| High | All required header fields; line table parse complete; qty columns numeric; fulfillment unambiguous | Auto-create/update vendor order + audit log |
| Medium | Missing optional fields; ambiguous fulfillment; partial OCR | Create proposal; Gavin review queue |
| Low | Missing invoice #; line count mismatch; negative lines mixed without return context | Block apply; `issue` status; Gavin review required |

Align with Phase 5 policy: **high confidence does not bypass human review for readiness-changing shop states** — invoice import does not change shop readiness anyway.

**Reviewer:** Gavin (default) for low/medium import proposals until automation gate approved.

---

## 14. Search & dispatcher UX

### Search keys (minimum)

- `customerPoOrReference`
- `vendorInvoiceNumber` / `vendorOrderNumber`
- `soldToName` / `shipToName`
- `buyerName`
- `vendorProductNumber` / description
- `quoteNumber`
- Branch phone / name

### List / drawer display

| Element | Content |
| ------- | ------- |
| Status chip | Dispatcher label from §7 — **never** raw enum |
| Will-Call rows | Badge **Will-Call / Pickup.**; no staging zone column |
| Branch | Sioux Falls + phone clickable |
| PO reference | Exact Customer P/O # string |
| Lines | Shipped / ordered / B/O; exclude core/return lines from pickup checklist |
| Evidence panel | "Imported from Johnstone invoice {date}" — parallel to email evidence (future) |

### Filters (future)

- Will-Call only
- Truck stock / inventory pickup
- Open backorders
- Import issues pending review

---

## 15. Open questions / TBD

| # | Question | Default assumption |
| - | -------- | ------------------ |
| 1 | Separate `VendorInvoiceImportEvent` collection vs extend `VendorEmailEvent`? | New collection with parallel audit shape |
| 2 | Upload UI entry point (Settings vs dispatcher vs both)? | Dispatcher batch upload + Settings vendor config |
| 3 | Link imported order to existing `DeliveryOrder` / `PurchaseOrder` — match keys? | Match on PO + job; manual link when ambiguous |
| 4 | Auto-fetch from email attachment (Phase 6)? | Out of scope until PDF parser gate passes |
| 5 | `closed_picked_up` — who confirms? | Dispatcher manual action + optional note |
| 6 | Ferguson / First Supply PDF formats | Separate specs; do not generalize Johnstone tables |
| 7 | Timezone for invoice dates | Store ISO date + source timezone America/Chicago for Midwest branches |
| 8 | Partial will-call (some lines B/O) | Status `partial` + Will-Call label if fulfillment is pickup; show B/O in line table |

---

## 16. Appendix

### Table A — Header field mapping (PDF → StageVerify)

| PDF label | StageVerify field | Required |
| --------- | ----------------- | -------- |
| Customer # | `customerAccountNumber` | Yes |
| Sales Order # | `vendorOrderNumber` | Yes |
| Invoice # | `vendorInvoiceNumber` | Yes |
| Customer P/O # | `customerPoOrReference` | Yes |
| Order Date | `orderDate` | Yes |
| Invoice Date | `invoiceDate` | Yes |
| Ship Date | `shipDate` | Yes |
| Buyer | `buyerName` | No |
| Ship Via | `shipViaRaw` | No |
| Job Number | `jobNumberRaw` | No |
| Quote Number (message block) | `quoteNumber` | No |
| Remit To | `vendorBranchName`, `vendorBranchAddress` | Yes |
| Footer phone | `vendorBranchPhone` | Yes |
| Sold To / Ship To blocks | `soldToName`, `shipToName`, `shipToAddress` | Yes |

### Table B — Line field mapping

| PDF column | StageVerify field |
| ---------- | ----------------- |
| LN | `lineNumber` |
| QNTY ORD | `quantityOrdered` |
| QNTY SHIP | `quantityShipped` |
| QNTY B/O | `quantityBackordered` |
| PRODUCT NUMBER + DESCRIPTION | `vendorProductNumber`, `manufacturerOrModelNumber`, `description` |
| (notes) | `filteredNotes` |
| (derived) | `lineType`, `excludeFromExpectedItems` |

### Table C — Import status → dispatcher label

| Internal `importStatus` | Dispatcher label |
| ----------------------- | ---------------- |
| `pending` | Pending Delivery |
| `partial` | Partial |
| `ready_for_pickup` | Ready for Pickup |
| `pickup_at_vendor` | **Will-Call / Pickup.** |
| `closed_picked_up` | **Closed / Picked Up.** |
| `issue` | Issue / Action Needed |

### Table D — Customer P/O # → fulfillment (sample PDF)

| Customer P/O # (exact) | `fulfillmentMethod` | Import status (initial) |
| ------------------------ | -------------------- | ----------------------- |
| `PLANET FITNESS PICKUP` | `will_call_pickup` | `pickup_at_vendor` |
| `EXHAUST FANS PICKUP` | `will_call_pickup` | `pickup_at_vendor` |
| `TRUCK STOCK PICKUP` | `will_call_pickup` | `pickup_at_vendor` |
| `TOPS STOCK PICKUP` | `will_call_pickup` | `pickup_at_vendor` |
| `inventory PICKUP` | `will_call_pickup` | `pickup_at_vendor` |
| `La Crosse PF` + Ship Via `TRUCK DELIVE` | `delivery` | `partial` / `pending` (no shop ready) |
| `KALAFAT Tuesday John` (no PICKUP token) | `unknown` | `pending` |

### Worked example — Invoice 6164159 (PLANET FITNESS PICKUP)

**Source:** Page 4 of Sioux Falls sample PDF, 2026-06-24 batch.

**Header (captured):**

| Field | Value |
| ----- | ----- |
| `customerAccountNumber` | 0018114 |
| `vendorOrderNumber` | 6164159 |
| `vendorInvoiceNumber` | 6164159 |
| `customerPoOrReference` | PLANET FITNESS PICKUP |
| `orderDate` | 2026-06-23 |
| `invoiceDate` | 2026-06-23 |
| `shipDate` | 2026-06-23 |
| `buyerName` | CONNOR SMITH |
| `shipViaRaw` | *(blank)* |
| `fulfillmentMethod` | `will_call_pickup` |
| `soldToName` / `shipToName` | TWIN PILLAR HEATING & COOLING |
| `shipToAddress` | 2944 HOLMGREN WAY, GREEN BAY WI 54304 |
| `vendorBranchPhone` | 605-338-2652 |
| `vendorBranchAddress` | 335 N Weber Ave, Sioux Falls SD 57103 |

**Ignored:** Salesman `SAD`; pricing; tax; TOTAL; BillTrust URL; ENROLLMENT TOKEN; payment terms.

**Lines (expected items):**

| LN | QNTY ORD | QNTY SHIP | QNTY B/O | Product | Description | exclude? |
| -- | -------- | --------- | -------- | ------- | ----------- | -------- |
| 1 | 1 | 1 | 0 | L46-668 / TH8320R1003/U | THERMOSTAT PROGRAMMABLE REDLINK… | No |
| 2 | 2 | 2 | 0 | B86-380 / 4050-08 | SEALANT REFRIGERATIO EASYSEAL… | No |

**Import result:**

- `importStatus`: `pickup_at_vendor`
- Dispatcher list label: **Will-Call / Pickup.**
- No staging location; searchable by "PLANET FITNESS", `6164159`, `CONNOR SMITH`
- After branch pickup confirmed: `closed_picked_up` → **Closed / Picked Up.**
- Does **not** create shop-received material or technician pickup checklist entries

### Worked example — Invoice 6163986 (TRUCK DELIVERY)

**Header highlights:** Customer P/O `La Crosse PF`, Ship Via `TRUCK DELIVE`, Quote `Q618468`.

**Line notes retained:** `2 DAY LEAD`, `NON STOCK, RESTOCK FEE APPLIES` on Greenheck fan line.

**Ignored:** `CUSTOMER PAYS FREIGHT`, `Floor-Loc: GREEN`, INBOUND FREIGHT dollars.

**Import result:** `fulfillmentMethod = delivery`, `importStatus = partial` or `pending` until shop receipt evidence; not Will-Call.

### Worked example — Invoice 6164242 (TOPS STOCK + core/return)

**PO:** `TOPS STOCK PICKUP` → `pickup_at_vendor` / **Will-Call / Pickup.**

**Lines:** Core charges (`CORE-16`, `CORE-45`) and negative return line excluded from expected items (`excludeFromExpectedItems: true`). Gas product lines (`AOX-016`, `AOX-045`) remain in expected list.

---

*End of spec.*
