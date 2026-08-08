# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> **Memory router:** `PROJECT_STATUS/MEMORY.md` — concern → file → when to read.
> **Product authority (on demand):** `PROJECT_STATUS/svscope_simple.md` — scope wins on conflict; load only for scope disputes.

## Snapshot
- **Standing harness:** every session honors **D-47** conf ≥ 97% before any file edit; **D-60** high-risk Sonnet instruct→verify loop on auth/CF/rules ships (`high-risk-sonnet-loop.mdc`); **D-38** security gate = Sonnet 5 (`claude-sonnet-5-thinking-high`) — Sonnet 4.6 retired from active allowlist (2026-08-08); **D-63** UI/UX → Sol Medium preferred (`gpt-5.6-sol-medium`; Task escalate `gpt-5.6-sol-high` with `fallback-from: gpt-5.6-sol-medium (task-allowlist-rejected)`) + Grok verifier + readability DoD — SSOT `ui-model-routing.json`; non-UI Composer unchanged.
- **MVP: 100.00% — done** — SSOT reconciled 2026-07-16 (`MVP_PATH.md`). §14 E2E prod re-verify **PASS** away-130 (2026-07-17).
- **Partial deploy:** D-59 P2–P7 on `main` (`49924c8b`, v0.0.204). **gh-pages LIVE** @ v0.0.234. **Firebase rules NOT deployed** — Sonnet pre-deploy APPROVE (`bf2570ff…`); console TTL on `trainingNoteAudit.expireAt` still needed after rules deploy. **CF deployed:** credit-return delivery block (ingest auto-reject + approve/create_shell/relink guard) @ v0.0.217; prior `approveVendorInvoiceImport` credit-return reject @ v0.0.215 (`eb000e7`); `recalculateDeliveryReadiness` + will-call preserve @ v0.0.214 (`5f1f575`); `recordPickupEvent` (`4755802`); **reject-preserve Gmail sync** @ v0.0.213 (`9529530`).
- Last shipped: **v0.0.234** — dispatcher section-separation: `--admin-section-*` tokens + `.admin-section` wrappers (Needs Review email, Invoice Imports, Search+Filter, Deliveries); nested card/table chrome cleared; dark/light text + `--admin-on-navy` strong-fill fixes preserved; gh-pages only (no CF/rules). [fast-safe UI]
- Prior: **v0.0.233** — merge PR #49 drawer fulfillment/staging UX: Vendor Drop-Off / Will-Call / Pickup wording; STAGING LOCATION NEEDED only when required∧unassigned, directly under Fulfillment; gh-pages LIVE; `verify:delivery-drawer-status` (+ :prod) PASS. [fast-safe UI] Merge `068e09c6`.
- Prior: **v0.0.232** — merge PR #46 technician assignment UX: Settings release checklist removed; drawer-only ASSIGNED TECHNICIAN / exclusive single-tech assign; gh-pages LIVE; `verify:settings-technicians:prod` + `verify:dispatcher-job-release:prod` + `verify:admin-appearance` PASS. [fast-safe UI] Evidence: solution-verifier `bc-2209562f`+`bc-2224a578` PASS; ui-before-after settings+dispatcher-job-release; ui-playwright-verifier `bc-ef7d0b5e`+`bc-01ccc03b` PASS; build-checker `bc-76409955`+`bc-a672883e` PASS; ship merge `6ff88741`.
- Prior: **v0.0.231** — dark-mode readability hierarchy (`--admin-text-data` / label / secondary / table-header); Vendor Communications + credit/return + invoice/settings leftovers tokenized; light mode + `stageverify-theme` persistence unchanged; `verify:admin-appearance` + `verify:invoice-review` + `verify:dispatcher-nav` PASS. [fast-safe UI]
- Prior: **v0.0.230** — admin/dispatcher UI modernization (shared `.portal-shell` radius/spacing/control/shadow tokens + utilities; cards/tables/toolbars/drawers/modals); Light/Dark persistence unchanged; vendor/technician mobile unchanged; `verify:admin-appearance` + `verify:dispatcher-nav` PASS. [fast-safe UI]
- Prior: **v0.0.229** — merge PR #45: Settings **PIN & Access Management** (tech + company-vendor + management roster; job PINs excluded); Light/Dark theme preserved; `verify:settings-technicians` + `verify:settings-management-pins` + `verify:admin-appearance` PASS. [fast-safe UI]
- Prior: **v0.0.228** — dispatcher/admin Light/Dark appearance (`stageverify-theme` localStorage; FOUC bootstrap; floating toggle); vendor/technician mobile themes unchanged; `verify:admin-appearance` PASS. [fast-safe UI]
- Prior: **v0.0.227** — merge PR #44: vendor hub Location code header + Invoice # row; `verify:vendor-monday-safe` location/invoice/accordion/CTA asserts PASS. Live Settings still `full_checkin` until ops flips exception_only. [fast-safe UI]
- Prior: **v0.0.226** — merge PR #43: vendor hub tap-to-expand expected items (read-only accordion); `verify:vendor-monday-safe` accordion asserts PASS. [fast-safe UI]
- Prior: **v0.0.225** — merge PR #41: Monday-safe vendor hub — no-spot disables Mark Delivered (“Ask dispatch for a staging spot.”), “Report a Problem” wording; `verify:vendor-monday-safe` PASS. [fast-safe UI]
- Prior: **v0.0.224** — merge PR #40: CF `recordTechnicianJobOpen` + soft-fail client TECH_JOB_OPENED evidence; CF **deployed** on stageverify-db; gh-pages LIVE. [high-risk CF + fast-safe client]
- Prior: **v0.0.223** — merge PR #39: Settings Workflow **StageVerify Start Date** (`appSettings.stageVerifyActivatedAt`, YYYY-MM-DD); Green Bay live `2026-08-10` (editable); `verify:settings-staging:prod` PASS. [fast-safe UI]
- Prior: **v0.0.222** — merge PR #38: unauthenticated technician Complete Pickup (remove client getDoc before recordPickupEvent). [fast-safe]
- Prior: **v0.0.218** — invoice reject dialog requires non-empty "Why was this rejected?" note for all reasons; shared `InvoiceRejectReasonDialog` deduped from inspect modal; `verify:invoice-review` + `verify:invoice-reject-reason` PASS. [fast-safe UI]
- Prior: **v0.0.217** — credit/return defense-in-depth: ingest auto-rejects structural credits to Rejected Invoices; CF blocks approve/create_shell/relink; auto-import blocked; default Deliveries board hides `creditReturnLinked`; `test:credit-return-delivery-block` + `test:approve-vendor-invoice-import` PASS. [high-risk CF + fast-safe client]
- Prior: **v0.0.216** @ `b9360d5` — delivery drawer STATUS dropdown **Reject…** action; credit/return banner kept; `verify:delivery-drawer-status` PASS. [fast-safe UI]
- Prior: **v0.0.215** @ `eb000e7` — credit/return delivery banner + list badge; drawer Reject linked import (approved credit slip-throughs) via `approveVendorInvoiceImport` + training lesson; `verify:delivery-drawer-status` PASS local+prod. [high-risk CF + fast-safe UI]
- Prior: **v0.0.214** @ `ee696f3` — systemic will-call pickup preserve. [high-risk CF]
- Prior: **v0.0.211** — delivery drawer closes after successful STATUS workflow mutations (Confirm Pickup, revert, mark shipped, spot+ready_for_pickup, dropdown status); stays open while pickup/spot forms pending or on Cancel; `verify:delivery-drawer-status` PASS. [fast-safe UI]
- Prior: **v0.0.209** (`c4d3f1f`) — delivery drawer: `pendingStatusSelection` keeps STATUS label + dropdown on Picked Up while pickup form pending; pickup CF errors surfaced in form; `verify:delivery-drawer-status` PASS local+prod. [fast-safe UI]
- Prior: **v0.0.208** — will-call Confirm Pickup CF (`recordPickupEvent` skipsShopStaging path + `closed_picked_up`); client `closed_picked_up` → Picked Up chip + Complete board; `test:pickup-authority` + `test:invoice-shell-display` PASS; CF deployed (`4755802`); gh-pages LIVE. [high-risk CF + client display]
- Prior: **v0.0.207** — delivery drawer status dropdown + drop-off/will-call fulfillment toggle under PO# (replaces Advanced Manual Controls); labels Ready for Pickup / Picked Up; `verify:delivery-drawer-status` PASS; D-62 post-D-50 retry rounds harness (`model-gates.mdc`, `DECISIONS.md`). [fast-safe UI + firestoreService client writes]
- Prior: **v0.0.206** — D-60 dispatcher account provisioning: Settings manager panel (`listDispatchers`/`provisionDispatcher`/`deactivateDispatcher` CFs), `/no-access` page, `ProtectedRoute` gates `dispatcherRoles`; `verify:login` PASS; `verify:no-access` + `verify:settings-dispatchers` need env creds/manager grant.
- Prior: **v0.0.205** — D-60 auth-native forgot-password on dispatcher login (`verify:login` PASS).
- Prior: **v0.0.197** — Dispatcher Unassign (drawer + table ×); will-call shells on default Deliveries board.
- **D-59 P1 deploy:** gh-pages **built** @ `74414db` · https://lgarage.github.io/stageverify · **CF** (`proposeVendorIgnoreRule` + updated functions on `stageverify-db`) **deployed**.
- Active Phase: Location-first Phase 6 Slice C (C1 shipped) — Slice B audit walk next.
- Stack: React 19 + TS, Vite 8, Firebase 11.x — https://lgarage.github.io/stageverify · `stageverify-db`

## Active Blockers
1. **Shelving decision** — layout IDs provisional (default shop layout locked for v1 map).
2. **GCP Pub/Sub push path** — optional; poll/Refresh Now proven.

## Immediate Next Step
- Dan/ops: set Settings → Exception-only Delivered hub when ready; hard-refresh Settings after v0.0.229 for PIN & Access Management; vendor phone still needs Location/Invoice from v0.0.227+.
## Queued product (deferred)
- **After D-59 phases P1–P7 deploy:** **away-137** — tighten `firestore.rules` so `deliveries`/`items` are not writable by any authenticated client; high-risk; blocked until training-note hardening phases complete (`docs/training-note-ignore-spec.md` §29 #9).
- **Phase 5 Slice B:** pickup verification v2 polish (per-location confirms, exception flags).

## Canonical references
- **Decisions:** `PROJECT_STATUS/DECISIONS.md` (+ `DECISIONS_ARCHIVE.md` when superseded)
- Handoff: `PROJECT_STATUS/archives/MINI_LIBRARIAN_HANDOFF.md` | Queue: `away-list.json` + `NEXT.md` | Validate: `npm run away:validate`

## Update Protocol
- Ship: `npm run away:ship` → `estimate-log.md` → `npm run away:validate` (auto-syncs CURRENT_STATE + Phase Tracker + roadmap from verify PASS) → commit.
