# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> **Memory router:** `PROJECT_STATUS/MEMORY.md` — concern → file → when to read.
> **Product authority (on demand):** `PROJECT_STATUS/svscope_simple.md` — scope wins on conflict; load only for scope disputes.

## Snapshot
- **Standing harness:** every session honors **D-47** conf ≥ 97% before any file edit; **D-60** high-risk Sonnet instruct→verify loop on auth/CF/rules ships (`high-risk-sonnet-loop.mdc`).
- **MVP: 100.00% — done** — SSOT reconciled 2026-07-16 (`MVP_PATH.md`). §14 E2E prod re-verify **PASS** away-130 (2026-07-17).
- **Partial deploy:** D-59 P2–P7 on `main` (`49924c8b`, v0.0.204). **gh-pages LIVE** (bundle `index-BbmYlaD7.js`). **Firebase rules/functions NOT deployed** — Sonnet pre-deploy APPROVE (`bf2570ff…`) but cloud missing `FIREBASE_TOKEN`. Console TTL on `trainingNoteAudit.expireAt` still needed after CF/rules deploy.
- Last shipped: **v0.0.207** — delivery drawer status dropdown + drop-off/will-call fulfillment toggle under PO# (replaces Advanced Manual Controls); labels Ready for Pickup / Picked Up; `verify:delivery-drawer-status` PASS; D-62 post-D-50 retry rounds harness (`model-gates.mdc`, `DECISIONS.md`); gh-pages deploy pending → done this ship. [fast-safe UI + firestoreService client writes]
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
- Confirm live drawer status dropdown on https://lgarage.github.io/stageverify dispatcher → View delivery; `verify:delivery-drawer-status:prod` PASS post-deploy.

## Queued product (deferred)
- **After D-59 phases P1–P7 deploy:** **away-137** — tighten `firestore.rules` so `deliveries`/`items` are not writable by any authenticated client; high-risk; blocked until training-note hardening phases complete (`docs/training-note-ignore-spec.md` §29 #9).
- **Phase 5 Slice B:** pickup verification v2 polish (per-location confirms, exception flags).

## Canonical references
- **Decisions:** `PROJECT_STATUS/DECISIONS.md` (+ `DECISIONS_ARCHIVE.md` when superseded)
- Handoff: `PROJECT_STATUS/archives/MINI_LIBRARIAN_HANDOFF.md` | Queue: `away-list.json` + `NEXT.md` | Validate: `npm run away:validate`

## Update Protocol
- Ship: `npm run away:ship` → `estimate-log.md` → `npm run away:validate` (auto-syncs CURRENT_STATE + Phase Tracker + roadmap from verify PASS) → commit.
