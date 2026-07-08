# Location-First Transition Spec — Permanent Location QR, PIN Tiers, No Status Cards

| Field | Value |
| --- | --- |
| **Title** | StageVerify transition: delivery-tag-first → permanent-location-QR-first workflow |
| **Date approved** | 2026-07-07 |
| **Status** | Approved — **Phase 1 complete** (2026-07-08) · **Vendor PIN scope REVISED to job-scoped** (Dan 2026-07-08 — see § Job-scoped vendor PIN) |
| **Authors** | War-game/spec: Fable 5 (planner) · Implementation: Composer 2.5 (one phase at a time) · Security review: Sonnet 4.6 (`claude-4.6-sonnet-medium-thinking`) for Phases 2, 5, 6 |

> **How to use this file (agents):** Read **§ Phase Tracker** first — it is the living source of truth for current state. Implement **exactly one phase** at a time, precisely as specified in that phase's section. **Never start a later phase until the prior phase's drift review passes.** When a phase completes, update the Phase Tracker table **and** `PROJECT_STATUS/CURRENT_STATE.md` in the **same commit** as phase completion. Do not invent design decisions — everything binding is in § Locked design decisions; anything ambiguous is in § Open questions and needs Dan.

---

## § Phase Tracker (LIVING SECTION — agents update this)

> **Approved next action: Phase 2** (privacy hardening — Sonnet-gated; explicit Dan approval before rules/CF deploy). Phase 1 completed 2026-07-08.
>
> **REVISION (Dan 2026-07-08):** Vendor PIN is now **job-scoped**, not vendor/company-scoped — read **§ Job-scoped vendor PIN (D14)** before implementing Phases 2–4. The original vendor-scoped D3 visibility model is REJECTED.

| Phase | Name | Status | Started | Completed | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | Groundwork: docs, types, clipboard | `complete` | 2026-07-08 | 2026-07-08 | ESL plan amended; additive types; job-level clipboard; URL locked `#/s?loc=` |
| 2 | Privacy hardening (backend) | `not_started` | — | — | Sonnet-gated; EXPLICIT Dan approval before rules/CF deploy |
| 3 | Permanent location entry + vendor scan v2 | `not_started` | — | — | Sign printing blocked on shop map + shelving decision (Jake Korb) |
| 4 | Vendor exception flows + dispatcher planning | `not_started` | — | — | Multi-spot, releases, planned/actual divergence |
| 5 | Technician door two + pickup verification v2 | `not_started` | — | — | Sonnet-gated; per-tech PINs; two-level verification |
| 6 | Management audit walk + unexpected-delivery resolution | `not_started` | — | — | Sonnet-gated; shared shop PIN; highest-sensitivity surface after Phase 2 |
| Future | E-tag premium layer | `not_started` | — | — | Unscheduled; blocked on Minew creds regardless |

**Current phase: Phase 2 — not started. Next action: drift review Phase 1, then await Dan approval before Phase 2 rules/CF deploy per § Phase 2.**

**Phase 1 drift review:** ESL plan rejects occupancy-dynamic QR-flip; types additive only; clipboard job-level format shipped; permanent URL **`#/s?loc={code}`** locked (see § Permanent URL scheme).

---

## § Master architecture decision

**The printed QR code is permanent and dumb; the software is dynamic and role-aware.**

- Every staging location (G1–G6 ground, S1A… shelf) gets **one static QR** encoding a **location-only URL that never changes**.
- Scanning that QR lands on a **role gate**:
  - **Vendor PIN (job-scoped)** → that **JOB's** staging context only — never the vendor's other jobs (REVISED Dan 2026-07-08; see § Job-scoped vendor PIN).
  - **Technician PIN** → full job pickup package.
  - **Management PIN** → shop-wide audit view.
- Deliveries are **dynamically assigned** to locations in **three distinct roles** — never conflated:
  - **Planned** — the dispatcher's instruction ("put it in G1").
  - **Scanned** — workflow entry (the spot the vendor actually scanned).
  - **Actual** — physical truth (where the delivery physically sits).
- **Physical colored status cards are eliminated entirely.** The phone-after-scan is the live status display. E-tags become the future premium glanceable layer on the **same location identity**.
- This is a **completion of the existing architecture, not a rebuild.** The `stagingLocations` registry, occupancy enforcement, vendor PIN infrastructure, and job-scoped pickup tokens all already exist and are extended, not replaced.
- The **occupancy-dynamic QR-flipping design** in `PROJECT_STATUS/ESL_INTEGRATION_PLAN.md` is **explicitly rejected** and must be amended in Phase 1.

---

## § Job-scoped vendor PIN (REVISION — Dan 2026-07-08, binding)

> **Supersedes** the original vendor-scoped PIN visibility model everywhere in this spec. The pre-revision D3 wording ("show a list of that vendor's active orders") and the master-architecture bullet "Vendor PIN → that vendor's deliveries only" are **REJECTED** as written — vendor/company-scoped visibility is the hazard this revision eliminates. Any phase section or older doc that implies a vendor PIN reveals company-wide orders is superseded by this section.

### The rule

1. **The vendor PIN is tied to each JOB, not to the vendor/company.** Entering a PIN reveals only that one job's staging context.
2. **Wrong-spot scan:** a vendor driver scans ANY location QR (e.g. G2) and enters their job PIN → the UI shows **only the staging spots assigned to THAT job** (e.g. G1, G15, S1A). It must **never** reveal the vendor's orders or spots for other jobs — even when the scanned spot is assigned to the **same company** for a different job.
3. **Overflow / Need More Space:** if the driver indicates they need more space, show additional spots that are **EMPTY and NOT assigned to any company** — never spots assigned to other jobs, **including the same vendor's other jobs**.

### Rationale (data integrity, not just privacy)

If a driver delivering for job A scans G2 and learns G2 is assigned to their company for job B, they may simply dump job A's items in G2. The jobs get mixed, and the whole StageVerify location-first process falls apart. Cross-job visibility is an **anti-mixup / data-integrity hazard** — hiding other jobs is what keeps physical staging truthful, not merely a privacy nicety.

### Implementation implications (Phases 2–4)

- The existing **per-vendor** `pinCode`/`pinHash` infrastructure (vendors collection, `verifyVendorPin` CF, `vendorSessions`) must be **extended or replaced with per-job PINs** — one PIN per job, issued in the vendor email ("put the stuff in G1"). Session resolution returns a **job scope**, not a vendor scope.
- Post-PIN resolvers (Phase 3) filter by **job**, not vendor: deliveries/spots for the PIN's job only.
- Need More Space v2 (Phase 4) spot suggestions must exclude every spot assigned to **any** job/company — only empty, unassigned spots qualify (strict-occupancy D2 already helps; this adds "not planned/assigned for anyone" to the filter).
- Cross-**job** absence becomes a mandatory negative test alongside cross-vendor absence (see Phase 3 acceptance criteria).

---

## § Locked design decisions

| ID | Decision |
| --- | --- |
| **D1** | Privacy hardening (read isolation) ships **BEFORE** the new vendor scan flow — no expanded security-theater window. |
| **D2** | **Strict occupancy** — one delivery per spot, everywhere (ground and shelf); existing `StagingLocationOccupiedError` behavior stands. |
| **D3** *(REVISED Dan 2026-07-08)* | **Wrong-spot scan** — after the **job-scoped** vendor PIN, show only THAT JOB's assigned staging spots (order # / PO # + assigned location for that job), never a dead end. A single match may deep-link straight in. **Never** show the vendor's orders/spots for other jobs, even if the scanned spot belongs to the same company on a different job — see § Job-scoped vendor PIN. *(Original vendor-scoped wording "that vendor's active orders" REJECTED.)* |
| **D4** | **Planned-spot release** — explicit prompt "Did you place anything in G1?"; "No" releases immediately, logged for the dispatcher via `plannedLocationReleases` audit entries. |
| **D5** | **Management = one shared shop PIN** in Settings (hashed); audit view + narrowly-gated resolution actions; **NO broad edit powers**. |
| **D6** | **Technician = per-technician PINs** (pickup accountability). |
| **D7** | Dispatcher can **plan multiple spots / spot strings up front** (e.g. G4+G5+G6 for pipe) via `plannedStagingLocationIds`. |
| **D8** | **In-app printable sign generator** (location name + permanent QR + down arrow) on `ZoneManagementPage`. |
| **D9** | **NO colored status cards at all** — the scan is the status display; the management audit walk enforces "nothing in an SV zone is untracked". |
| **D10** | **PIN sessions expire after N minutes**, configurable in Settings per tier. `appSettings.vendorSessionMinutes` already exists; add `technicianSessionMinutes`, `managementSessionMinutes`. |
| **D11** *(default, open to Dan veto)* | `needs_review` = review **FLAG** overlaying existing statuses (`reviewFlag` object on `DeliveryOrder`), **NOT** a new status enum value — keeps `firestore.rules` and the forward-only transition graph untouched. |
| **D12** *(default, open to Dan veto)* | "Reserved" (waiting for delivery) = **DERIVED display state** (planned locations assigned + status pending/shipped), **not** a new enum value. |
| **D13** | Vendor pickup orders display as **"Will-Call / Pickup"** — already shipped as the `invoiceFulfillmentMethod: will_call_pickup` display label; keep it, do not create a new status. Will-call / deliver-to-site shells legitimately skip shop staging; location-first logic must **not** force locations onto them. |
| **D14** *(Dan 2026-07-08)* | **Job-scoped vendor PIN** — the vendor PIN is per-JOB, not per-vendor/company. Post-PIN visibility = that job's spots only; overflow suggestions = empty spots unassigned to any company only. Full rule + rationale: § Job-scoped vendor PIN. |

---

## § Current-state findings (war-game scouts, 2026-07-07)

What already exists in the codebase — the transition builds on these, and phase scopes reference them:

1. **Permanent location registry exists.** `stagingLocations` collection is already a first-class permanent registry: `code` (G1 / S1A), `type` (`ground | shelf | bin | other`), `status`, `eslTagId?` (`src/dispatcher/models.ts` ~L613–624). Managed in `ZoneManagementPage.tsx`.
2. **Multi-spot per delivery exists — but no role distinction.** `stagingLocationId` + `additionalStagingLocationIds[]` + `pickedUpStagingLocationIds[]` exist on `DeliveryOrder`. **No planned/scanned/actual distinction exists** yet.
3. **Status enum and forward-only transitions.** `DeliveryStatus` enum (`models.ts` L1–10): `pending, shipped, arrived, partial, ready_for_pickup, complete, issue, picked_up, installed`. Forward-only transitions defined in `src/dispatcher/service.ts` L15–42, enforced in `firestoreService.ts` L521–536, and mirrored in `firestore.rules`. `picked_up` is reachable only via the `recordPickupEvent` CF. There is **no `needs_review` status** (that concept is invoice-domain only today).
4. **Zone QR exists but resolution is unsafe.** `#/receive?zone=G2` works via `receiveQrUrls.ts`, but resolution (`getDeliveryDetailsByStagingCode` in `firestoreService.ts` ~L1687–1712) picks **ONE** delivery — most-recently-updated on collision, with only a `console.warn`. Unsafe; must be replaced by the role-aware resolver.
5. **Pickup token is JOB-scoped.** `functions/src/generatePickupToken.ts`, `validatePickupToken.ts`; `pickupTokens/{hash}` → `jobId`. `JobPickupScreen` in `PickupPortalPage.tsx` already aggregates all job deliveries grouped by staging code. `recordPickupEvent` CF **already accepts `stagingLocationIds`** but the UI never passes it.
6. **Clipboard is single-delivery despite job-scoped token.** Dispatcher drawer `CopyPickupLinkButton` (`DispatcherDashboardPage.tsx` ~L2001) copies SINGLE-delivery text via `buildPickupInformationClipboardText` (`deliveryDisplayHelpers.ts`).
7. **Vendor PIN infrastructure exists — but is per-VENDOR, which the 2026-07-08 revision supersedes.** Per-vendor `pinCode`/`pinHash` on the vendors collection; `verifyVendorPin` CF; delivery-scoped `vendorSessions` (~15 min, `appSettings.vendorSessionMinutes`); rate-limited via `vendorPinAttempts`. Client gate: `VendorPinGate.tsx`. Offline fallback `vendorPinVerifier` digest on public delivery docs (flagged MEDIUM in security scan). **NO technician or management PIN exists.** Per § Job-scoped vendor PIN (D14), this infrastructure must evolve to **per-job PINs** — the per-vendor pattern (hashing, rate limiting, sessions) is reused, but scope resolution becomes job-scoped.
8. **SECURITY (critical).** `firestore.rules` allows **public read** on deliveries, items, jobs, purchaseOrders, stagingLocations, appSettings — any unauth caller can enumerate ≤500 deliveries (full cross-vendor visibility). Unauth delivery/item writes are constrained by field whitelist + forward-only transitions but are **NOT bound to any session**. Pre-PIN hydration on `/receive` leaks delivery+items before the PIN. Already flagged HIGH in `PROJECT_STATUS/security-scan-2026-07-04-invoice.md` (away-107).
9. **Email ingest safety rails to preserve.** Default `pending_review`; auto-apply only ≥85 confidence; `humanReviewRequired`; no delivery-shell auto-creation from inbound email. Reply-ingest pilot is live (flag on since 2026-07-07).
10. **Need More Space partial UI exists.** `VendorNeedMoreSpaceFlow.tsx`; `assignVendorStagingLocation` CF (session-gated). Occupancy: `stagingOccupancy.ts` throws `StagingLocationOccupiedError`.
11. **Report Issue modal exists** with types `missing, wrong_item, damaged, backordered, running_low, other` — no inline partial flag.
12. **Active blockers relevant here:** physical shop map not created; shelving decision (Jake Korb) pending — **Phase 3 sign printing depends on these; Phases 1–2 do not.**

---

## § Global data model changes

**ALL additive. No renames. No enum changes.**

### On `DeliveryOrder` (`src/dispatcher/models.ts`)

| Field | Type | Meaning |
| --- | --- | --- |
| `plannedStagingLocationIds?` | `string[]` | Dispatcher instruction; may be multiple (D7) |
| `stagingLocationId` + `additionalStagingLocationIds` | *(existing)* | Formally **REINTERPRETED as ACTUAL locations** — documented, not renamed. Renaming would break occupancy, pickup grouping, the ESL plan, and the drawer. |
| `scannedStagingLocationId?` | `string` | Recorded at vendor check-in |
| `scannedAt?` | timestamp | Recorded at vendor check-in |
| `plannedLocationReleases?` | `{ locationId, releasedAt, releasedBy, reason }[]` | Audit entries for planned-spot release (D4) |
| `reviewFlag?` | `{ flagged: boolean, reason, flaggedBy, flaggedAt }` | Review-flag overlay (D11) |

### On `StagingLocation`

| Field | Meaning |
| --- | --- |
| `sizeClass?` (or capacity hint) | Capacity hint for spot suggestions |
| `adjacentGroupId?` | Ground-spot strings for Need More Space adjacency suggestions |

### New collections (later phases; CF-written only)

| Collection | Phase | Purpose |
| --- | --- | --- |
| Technician PIN/session storage | 5 | Per-technician PIN + session model (mirrors vendor pattern) |
| `locationScanEvents` | later phases | Scan audit: location, PIN tier, outcome |
| `stagingAuditFlags` | 6 | Management audit resolutions |

### `AppSettings`

`technicianSessionMinutes?`, `managementSessionMinutes?`, `managementPinHash?`.

### Hard constraint

**NO new status enum values.** The forward-only transition graph and its `firestore.rules` mirror stay untouched.

---

## § Permanent URL scheme

**Phase 1 decision (locked):** `#/s?loc={code}` — full production form:

`https://lgarage.github.io/stageverify/#/s?loc=G1`

- **One URL per location.** Short hash path for QR density; distinct from legacy `#/receive?zone=` so migration does not break printed receive materials.
- **Once signs are printed, this URL is a permanent contract with the physical shop — never change it.** Review again before Phase 3 sign printing.
- The landing page routes by PIN tier: **vendor** (Phase 3), **technician** (Phase 5), **management** (Phase 6). Unimplemented tiers degrade gracefully.

---

## § Phase 1 — Groundwork: docs, types, clipboard (RECOMMENDED FIRST PHASE)

**Goal:** Lock the architecture on paper and in types; ship one safe user-visible win. **Zero behavior change except clipboard text.**

**Scope (exact file paths):**

1. **Amend `PROJECT_STATUS/ESL_INTEGRATION_PLAN.md`** — kill the occupancy-dynamic QR-flip design; e-tags = premium display on permanent location identity (per § Master architecture decision and § Future e-tag premium layer).
2. **This spec file (`docs/location-first-transition-spec.md`)** serves as the architecture doc — cross-referenced from `PROJECT_STATUS/MEMORY.md`.
3. **Add the additive fields as TypeScript types only** (no UI writes yet) in `src/dispatcher/models.ts`: the `DeliveryOrder`, `StagingLocation`, and `AppSettings` fields listed in § Global data model changes.
4. **Replace `buildPickupInformationClipboardText`** (`src/dispatcher/deliveryDisplayHelpers.ts`) with a job-level format:

```
StageVerify Pickup
Job Name: {jobName}
Job #: {jobNumber}
PO #: {aggregated POs}
Order #: {aggregated order numbers}
Staging Location(s): {all actual location codes across job deliveries}

Open pickup checklist:
{pickup URL}
```

5. Decide the final permanent URL path form (see § Permanent URL scheme and Open question 2) — a docs decision in this phase, no route implementation.

**Out of scope / boundaries:** No `firestore.rules` changes, no Cloud Functions changes, no route changes, no vendor flow changes, no pickup flow changes (beyond the clipboard text).

**Data model:** Types only — additive optional fields; nothing reads or writes them yet.

**UI behavior:** Only the dispatcher drawer's copied pickup clipboard text changes (single-delivery format → job-level format above). Everything else identical.

**Access control:** No changes.

**Acceptance criteria:**

- `npm run build` clean.
- Clipboard Playwright assertion on the new job-level format.
- `npm run verify:pickup` still green.
- Docs cross-referenced from `PROJECT_STATUS/MEMORY.md`.

**Test plan:** Build gate; clipboard Playwright assert; `verify:pickup` (and `:prod` after deploy per ship-loop).

**Rollback:** `git revert` — nothing depends on the new fields yet.

**Security review requirement:** Not required (no rules/CF/auth surface).

**Drift review requirement:** Fable 5 confirms docs match this spec before Phase 2 begins.

---

## § Phase 2 — Privacy hardening (backend; Sonnet-gated; EXPLICIT DAN APPROVAL required before deploy)

**Goal:** Make "vendor sees only their delivery" true **at the data layer** before any new vendor surface ships (D1). Extends the away-107 findings (`PROJECT_STATUS/security-scan-2026-07-04-invoice.md`). **Deliberately feature-free** so failures are unambiguous.

**Scope:**

1. **Replace public direct reads on `/receive` with scoped access** — pre-PIN resolves only non-sensitive location/branding info; delivery+item hydration happens **AFTER** a `verifyVendorPin` session (fixes the pre-PIN leak in `prefetchVendorReceiveDelivery` / `getDeliveryDetailsPublicForVendorReceive`).
2. **Bind unauth deliveries/items writes to a validated vendor session** — move vendor writes fully behind session-checked CFs (following the `markVendorDelivered` / `assignVendorStagingLocation` pattern); tighten `unauthDeliveryUpdateAllowed()`, including the client-side `pending→arrived` and `updateItemQty` paths.
3. **Close public enumeration** — public reads on deliveries, items, jobs, purchaseOrders become token/session-mediated (pickup page data load behind a CF or a scoped pattern).
4. **Remove/relocate `vendorPinVerifier`** from public delivery docs (the offline digest fallback flagged MEDIUM).

**Out of scope / boundaries:** **NO new features.** Existing receive UX, pickup links, dispatcher dashboard, and email ingest must behave **identically** for legitimate users. The `emailReplyIngestEnabled` pilot stays untouched.

**Data model:** No schema additions beyond what session mediation requires; no enum changes.

**UI behavior:** Identical for legitimate users — this phase only changes *who can read/write what*, not what any legitimate flow looks like.

**Access control:** This IS the phase — public reads scoped/session-mediated; unauth writes session-bound; pre-PIN hydration removed.

**Acceptance criteria:**

- All existing `verify:*` scripts green locally **and** `:prod`.
- **NEW negative-test script** asserting an unauth client cannot: list deliveries, read another vendor's items, or write status without a session.
- Vendor demo flow (PIN `1234`) works end to end.

**Test plan:** Full existing verify suite local + prod; new negative privacy test script; vendor demo E2E.

**Rollback:** Rules and CF versions revertible **independently**; keep the previous rules file in history; **test the rollback before deploy**.

**Security review requirement:** Sonnet 4.6 gate **mandatory before push**; HIGH blocks. **Deploy of `firestore:rules` + `functions` ONLY with explicit Dan approval** — this spec does not grant it.

**Drift review requirement:** Confirm no feature scope leaked into this deliberately feature-free phase.

---

## § Phase 3 — Permanent location entry + vendor scan v2

**Goal:** The core new vendor experience — scan the permanent sign, PIN in, see THAT JOB's deliveries/spots, confirm. **(Job-scoped per D14 / § Job-scoped vendor PIN — Dan 2026-07-08.)**

**Scope:**

1. **New landing route** (`#/s?loc=…` — final form from Phase 1): location header → PIN gate (session-backed, duration from Settings).
2. **Post-PIN resolver (JOB-scoped):** list of the PIN's **job** deliveries (order # / PO # + that job's assigned locations) **regardless of scanned spot** (D3 revised); a single match may deep-link straight in; record `scannedStagingLocationId` (+ `scannedAt`). **Never** list the vendor's deliveries/spots for other jobs — even when the scanned spot is the same company's spot on a different job (§ Job-scoped vendor PIN).
3. **Confirm-delivered** reuses `VendorDeliveredHub` / `markVendorDelivered` (session-gated per Phase 2).
4. **In-app printable sign generator** on `ZoneManagementPage` (D8): location name + permanent QR + down arrow.
5. **Settings:** vendor session minutes editable (D10).
6. **Legacy routes keep working:** `#/receive?id=` and `#/receive?zone=` — printed materials and old links must not break.

**Out of scope / boundaries:** Need More Space redesign and planned-multi are **Phase 4**; **no** technician or management tiers (those degrade gracefully on the landing route).

**Data model:** Writes `scannedStagingLocationId` / `scannedAt` at check-in (fields added in Phase 1).

**UI behavior:** New scan landing flow (location header → PIN → own-deliveries list → confirm); sign generator page; Settings field. Existing receive UI unchanged.

**Access control:** All vendor data behind the PIN session (Phase 2 foundation); pre-PIN shows only non-sensitive location/branding info.

**Acceptance criteria (Playwright):**

- Scan-sim → PIN → deliveries list shows **ONLY** that job's records (**assert another vendor's delivery is absent AND the same vendor's other-job delivery is absent** — D14 cross-job negative test) → confirm delivered → status correct.
- Wrong-spot scan (e.g. scanned G2, job assigned G1/G15/S1A) shows that job's spot list only, not a dead end and not the company's other-job spots.
- Sign page QR encodes the **exact** permanent URL.
- Existing receive verify scripts stay green.

**Test plan:** New route Playwright script (scan-sim E2E incl. cross-vendor absence assert + wrong-spot case); sign QR content assert; existing receive verifies; `:prod` reruns after deploy.

**Rollback:** New route is additive — revert removes it without touching legacy flows.

**Security review requirement:** Only if CF/rules deltas emerge during implementation.

**Drift review requirement:** Resolver matches D2/D3; **no delivery-specific QR crept back**.

**Blocker note:** Sign *printing* depends on the physical shop map + shelving decision (Jake Korb) — the software scope above does not.

---

## § Phase 4 — Vendor exception flows + dispatcher planning

**Goal:** Pipe-delivery reality — multi-spot placement, wrong-size spots, clean releases.

**Scope:**

1. **Need More Space v2** (extends `VendorNeedMoreSpaceFlow.tsx`): available spots honoring strict occupancy (D2) **AND job-scoped filtering (D14)** — suggest only spots that are **empty and not assigned/planned for any company or job** (never another job's spots, including the same vendor's other jobs); suggest adjacent ground strings via `adjacentGroupId`; checkbox multi-select → actual locations written via session-gated CF.
2. **Release prompt** when the planned spot is not among the selected actuals: "Did you place anything in G1?" → "No" releases now + writes a `plannedLocationReleases` entry + dispatcher drawer visibility (D4).
3. **Dispatcher planned-multi UI:** assign `plannedStagingLocationIds` (single or string) from the drawer; planned-vs-actual divergence visible in drawer **and** list (list shows actuals, badge indicates divergence).
4. **"Reserved" derived display state** (D12) in dispatcher views: planned locations assigned + status pending/shipped.

**Out of scope / boundaries:** No technician/management tiers; no status enum changes; planned/scanned/actual roles must stay distinct.

**Data model:** Writes `plannedStagingLocationIds`, `plannedLocationReleases`, actual-location multi-select (existing actual fields); uses `adjacentGroupId` / `sizeClass` on `StagingLocation`.

**UI behavior:** Vendor multi-select spot flow with adjacency suggestions and release prompt; dispatcher drawer planned-multi assignment + divergence badge; Reserved display state.

**Access control:** All vendor writes via session-gated CFs (Phase 2 pattern).

**Acceptance criteria (Playwright E2E — canonical scenario):**

- Planned G1 → vendor scans G1 → needs more space → selects G4+G5+G6 → G1 released with audit entry → dispatcher sees divergence.
- Occupancy conflict test: selecting an occupied spot fails cleanly.

**Test plan:** The G1→G4/G5/G6 scenario is the canonical Phase 4 E2E; occupancy-conflict negative test; existing verifies green; `:prod` after deploy.

**Rollback:** One revertible commit-set; additive fields mean revert restores prior behavior.

**Security review requirement:** CF changes → Sonnet gate before push.

**Drift review requirement:** Planned/scanned/actual semantics not blurred.

---

## § Phase 5 — Technician door two + pickup verification v2

**Goal:** Location QR + per-tech PIN as a **second door into the SAME job-scoped pickup package**; two-level verification.

**Scope:**

1. **Per-technician PIN model** + Settings management UI + `verifyTechnicianPin` CF + session storage — mirror the vendor pattern: hashing, rate limiting, `technicianSessionMinutes` (D6, D10).
2. **Landing route tech path:** PIN → jobs with actual locations at the scanned spot → job picker if >1 → the **same `JobPickupScreen` package** the token link opens (**single source of truth** — no forked pickup logic).
3. **Pickup verification v2** in `PickupPortalPage.tsx`:
   - **Level 1** = per-location confirm checkboxes ("Picked up supplies @ [x] G2 [x] S1A [x] G4,G5,G6") — wire the `stagingLocationIds` param that `recordPickupEvent` already accepts.
   - **Level 2** = expected-parts drop-down with **exception-only** flags: missing / wrong / damaged / could-not-find / partial / do-not-pick-up (extend `ReportIssueModal` types; add inline partial).
   - **"Complete Pickup"** enabled only when all locations confirmed.
   - **Per-tech identity** recorded on `pickupEvents`.

**Out of scope / boundaries:** No management tier; no changes to the token door's behavior (both doors must share one data path); no status enum changes (`picked_up` still only via `recordPickupEvent`).

**Data model:** New technician PIN/session collection (CF-written only); `pickedUpStagingLocationIds` driven by per-location confirms; per-tech identity on `pickupEvents`; `AppSettings.technicianSessionMinutes`.

**UI behavior:** Tech path on the landing route (PIN → job picker → JobPickupScreen); per-location checkboxes; exception-only parts flags; gated Complete Pickup.

**Access control:** Per-technician PIN sessions (hashed, rate-limited, expiring per D10); pickup writes via `recordPickupEvent` CF only.

**Acceptance criteria:**

- Extend `scripts/verify-pickup-portal.mjs` — **both doors reach identical packages**.
- Per-location confirm drives `pickedUpStagingLocationIds`.
- `picked_up` only when **all** spots confirmed.
- Exception flags persist and surface to the dispatcher.

**Test plan:** Extended `verify:pickup` (+ `:prod`); both-doors equivalence; per-location confirm assertions; exception-flag persistence.

**Rollback:** One revertible commit-set; token door unaffected by revert of the PIN door.

**Security review requirement:** Sonnet gate **mandatory** (new PIN/auth surface + CFs); **explicit Dan approval before CF deploy**.

**Drift review requirement:** Token door and PIN door share **ONE** data path — no forked pickup logic.

---

## § Phase 6 — Management audit walk + unexpected-delivery resolution

**Goal:** Enforce "nothing in an SV zone is untracked" — the audit walk replaces the physical cards (D9).

**Scope:**

1. **Shared management PIN** (Settings, hashed — `managementPinHash`; `managementSessionMinutes`) (D5, D10).
2. **Audit view (mobile-first):** all locations in "(X) G1 – PF-Wausau" style — occupancy mark, code, short contents descriptor; tap → job, vendor, PO, order, expected vs current status, actual locations.
3. **Resolution actions — ALL via gated CFs, ALL logged:**
   1. **Capture unexpected delivery** — explicit form (vendor, description, location, optional photo) → creates a **FLAGGED shell** (`reviewFlag` set), modeled on the `approveVendorInvoiceImport` pattern; **never auto-created from weak signals**.
   2. **Flag mismatch** — "SV says occupied, spot empty" (or vice versa) → `stagingAuditFlags` entry surfacing on the dispatcher dashboard; management does **NOT** silently release or reassign.
   3. **Mark needs review** — sets the D11 `reviewFlag` on the delivery.

**Out of scope / boundaries:** **NO broad edit powers** for management (D5) — capture/flag only; no direct release/reassign; no status edits; no enum changes.

**Data model:** `AppSettings.managementPinHash` + `managementSessionMinutes`; `stagingAuditFlags` collection (CF-written); flagged shells via `reviewFlag`.

**UI behavior:** Management path on the landing route (shared PIN → audit list → location detail → narrow resolution actions).

**Access control:** Shared shop PIN (hashed, expiring session per D10); resolution actions only via gated CFs; **negative requirement:** a management session cannot perform broad status edits.

**Acceptance criteria (Playwright):**

- Management PIN → audit list → each resolution action → correct flagged artifacts appear dispatcher-side.
- **Negative test:** management session cannot perform broad status edits.

**Test plan:** Management-path Playwright E2E per resolution action; negative broad-edit test; existing verifies green; `:prod` after deploy.

**Rollback:** One revertible commit-set; audit view and CFs additive.

**Security review requirement:** Sonnet gate **mandatory** (shared PIN on a public wall + shell creation = the highest-sensitivity surface after Phase 2); explicit Dan approval before any rules/CF deploy.

**Drift review requirement:** Resolution stayed narrow (capture/flag only) per D5.

---

## § Future (unscheduled) — E-tag premium layer

- Same **permanent location identity** — the e-tag replaces nothing structural.
- The e-tag renders: location, job # / name, vendor, PO, order, expected date, status, notes, QR.
- **Server-side Minew calls only** (NDA rule `minew-nda-compliance.mdc`) — CF-triggered on delivery/location changes per the amended ESL plan (Phase 1 amendment).
- **Blocked on Minew creds regardless** of transition progress.

---

## § Cross-cutting requirements

### MUST NOT change (any phase)

- Dispatcher dashboard core behavior.
- Existing pickup token links — **all previously copied links keep working**.
- Vendor email / reply-ingest pilot and its review gates.
- The status enum and forward-only transition graph.
- Will-call / deliver-to-site staging-skip guards.
- The principle that **no weak signal auto-creates shells or mutates status**.

### Test plan (per phase)

- Clean `npm run build`.
- Route-level Playwright verify scripts extended per phase (new negative privacy tests in Phase 2).
- Existing `verify:pickup`, `verify:dispatcher-nav`, and receive verifies stay green.
- `:prod` reruns after each deploy.
- The G1→G4/G5/G6 scenario is the **canonical Phase 4 E2E**.

### Pre-deploy verification

1. All acceptance criteria green **locally**.
2. gh-pages deploy → `:prod` verify.
3. For Phases 2/5/6: Sonnet security verdict (**with `security-gate-id`**) **AND explicit Dan approval** before any `firestore:rules` or `functions` deploy — **this spec does NOT grant that approval**.

### Rollback

- Every phase is one revertible commit-set.
- Phase 2 keeps a **tested** rules rollback copy.
- The permanent URL scheme is the **one non-revertible commitment** once signs are printed — decided in Phase 1, reviewed before Phase 3 printing.

### Architecture drift review (tripwires)

Fable 5 reviews each phase's diff summary against this spec **before the next phase begins**. Drift tripwires:

- Delivery-specific QRs reappearing.
- **Vendor PIN visibility widening back to vendor/company scope** — any UI or resolver that shows a vendor's other-job orders/spots after PIN violates D14 (§ Job-scoped vendor PIN).
- Planned/actual conflation.
- Pickup logic forking between the two doors.
- Management scope creep beyond capture/flag.
- New status enum values.

---

## § Security review requirements

- **Sonnet 4.6 gate** (`claude-4.6-sonnet-medium-thinking` via `security-review` Task per `.cursor/rules/security-review-gate.mdc`) is **mandatory before push** for **Phases 2, 5, and 6** (and any other phase where CF/rules deltas emerge).
- A valid **`security-gate-id`** (UUID from the Task return) + model line + verdict is required in the completion report — missing id = **NOT RUN** = do not push.
- **HIGH** findings block push until fixed.
- **Explicit Dan approval is required before ANY `firestore:rules` or Cloud Functions deploy in this transition — this spec does not grant that approval.** Passing the Sonnet gate is necessary but not sufficient.

---

## § Open questions (non-blocking; Dan can veto anytime)

1. **D11/D12 defaults** (review-flag overlay; derived Reserved state) were adopted without explicit Dan confirmation — open to veto.
2. **Exact permanent URL path** — **decided Phase 1:** `#/s?loc={code}` (see § Permanent URL scheme). Permanent once signs print.
3. **Phase 6 "SV occupied / spot empty":** MVP flags for the dispatcher rather than direct management release; escalate later if the flag loop proves too slow.
4. **Physical shop map / shelving decision (Jake Korb)** blocks Phase 3 sign *printing*; Phases 1–2 unaffected.

---

## § Glossary

| Term | Meaning |
| --- | --- |
| **Planned location** | The dispatcher's instruction — where a delivery *should* go (`plannedStagingLocationIds`). May be multiple spots / a spot string (D7). |
| **Scanned location** | Workflow entry point — the spot whose QR the vendor actually scanned at check-in (`scannedStagingLocationId` + `scannedAt`). |
| **Actual location** | Physical truth — where the delivery physically sits. Existing `stagingLocationId` + `additionalStagingLocationIds`, formally reinterpreted (never renamed). |
| **Spot codes G/S** | `G1–G6` = ground spots; `S1A…` = shelf spots. Registered in the `stagingLocations` collection (`code` + `type`). |
| **PIN tiers** | Three role gates behind the same permanent location QR: **vendor** (**per-JOB PIN — that job's spots/deliveries only**, D14; never company-wide), **technician** (per-tech PIN — job pickup package), **management** (one shared shop PIN — audit view + narrow resolution actions). Sessions expire per-tier via Settings minutes (D10). |
| **Audit walk** | Management routine: scan any location QR → shared PIN → shop-wide audit view → walk the zones resolving unexpected deliveries, mismatches, and needs-review flags. Replaces the physical colored status cards (D9). |
| **Reserved** | Derived display state (D12): planned locations assigned + status pending/shipped. Not an enum value. |
| **Review flag** | D11 overlay: `reviewFlag` object on `DeliveryOrder` — flags a delivery for review without adding a `needs_review` enum status. |
| **Spot string** | Multiple adjacent ground spots used together for long stock (e.g. G4+G5+G6 for pipe), suggested via `adjacentGroupId`. |
