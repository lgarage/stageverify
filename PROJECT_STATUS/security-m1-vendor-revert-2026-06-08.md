# M1 Security Review — Vendor Revert Hydration (2026-06-08)

**Finding:** M1 — `revertDeliveryStatus` called auth-only `getDeliveryDetails()` on all vendor paths (early returns + post-commit), causing permission failures for unauthenticated vendor revert.

**Fix:** `revertDeliveryStatus` uses `hydrateAfterVendorWrite` when `actorType === "vendor"` (same pattern as `submitCheckin`). Dispatcher revert unchanged (`getDeliveryDetails`).

**Verdict: PASS** — No remaining MEDIUM+ risk on M1.

| Check | Result |
| ----- | ------ |
| Vendor early returns use public-safe hydrate | ✓ |
| Vendor post-commit uses public-safe hydrate | ✓ |
| Dispatcher revert still auth-only hydrate | ✓ |
| `App.tsx` handleRevert passes `actorType: "vendor"` | ✓ |

**Verification:**
- Local: `verify:vendor-e2e` 10/10 PASS, `verify:pickup` PASS
- Prod (commit `0ed7734`, gh-pages deployed): `verify:vendor-e2e:prod` 10/10 PASS, `verify:pickup:prod` PASS (after `reset-pickup-verify-fixture`)
- Firestore rules: unchanged for M1; prior vendor rules deployment still active

**Files:** `src/dispatcher/firestoreService.ts`, `src/App.tsx`, `src/DispatcherDashboardPage.tsx`

**Deferred:** M2 (`additionalStagingLocationIds` validation) — not in scope.
