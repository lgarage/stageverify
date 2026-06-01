# Security Audit Report — 2026-06-02

**Verdict: SECURITY: PASS**
No HIGH-severity findings. Two MED findings require attention before significant scale-up.

---

## Scope

All `.ts` and `.tsx` files in `src/` and `src/dispatcher/`, plus `functions/src/index.ts` and `firestore.rules`.
Files reviewed: `firebase.ts`, `AuthContext.tsx`, `ProtectedRoute.tsx`, `LoginPage.tsx`, `main.tsx`,
`App.tsx`, `CheckInPage.tsx`, `ReceivingPage.tsx`, `MobileHubPage.tsx`, `DispatcherDashboardPage.tsx`,
`SettingsPage.tsx`, `EntryDisplayPage.tsx`, `PickupPortalPage.tsx`, `ZoneManagementPage.tsx`,
`CreateDeliveryModal.tsx`, `dispatcher/firestoreService.ts`, `dispatcher/service.ts`,
`dispatcher/models.ts`, `dispatcher/seedFirestore.ts`, `dispatcher/index.ts`, `functions/src/index.ts`.

---

## Findings

### HIGH

_None._

---

### MED

**M-01 · Unauthenticated writes to `statusHistory` and `pickupEvents` — audit log pollution**
- **File:** `firestore.rules` lines 120, 126
- **Risk:** `allow create: if true;` permits any unauthenticated actor who knows the project ID (visible in the public SPA bundle) to append arbitrary documents to both collections. This does not affect delivery status or item quantities, but it degrades audit trail integrity. A motivated actor could flood the collections with fake check-in or status events, inflating Firestore read/write costs and obscuring real history.
- **Fix:** Restrict statusHistory and pickupEvents creates to authenticated users, OR add field-level validation in the rule to enforce that `entityId` matches an existing delivery document and that `actorType` is an expected enum value. Least-disruptive: add a `hasOnly([...expected fields...])` check and a `actorType in ['vendor','technician','dispatcher','system']` guard to the unauthenticated create path.

**M-02 · Unbounded `fetchAll` queries — cost amplification and browser OOM at scale**
- **File:** `src/dispatcher/firestoreService.ts` lines 36–39, 172–180
- **Risk:** `listDeliveries` calls `fetchAll` on six Firestore collections simultaneously (deliveries, jobs, vendors, stagingLocations, purchaseOrders, items) with no server-side `limit()`. At operational scale (hundreds of deliveries, thousands of items), each dashboard load billsa full collection scan. This is both a cost DoS surface and a potential browser memory exhaustion issue.
- **Fix:** Add Firestore `query(..., limit(N))` to `fetchAll` calls used in the dashboard path, or replace client-side join logic with a Cloud Function that performs the aggregation server-side and returns only the fields needed for the list view.

---

### LOW

**L-01 · Firebase API key not referrer-restricted**
- **File:** `src/firebase.ts` lines 5–12
- **Risk:** The Firebase web API key is intentionally public (it identifies the project, not a secret), but without HTTP referrer restrictions configured in the Firebase console, any external origin could use the key to trigger anonymous auth flows or read public Firestore collections. Current Firestore rules limit the damage, but referrer restriction is defense-in-depth.
- **Fix:** In the Firebase console → APIs & Services → Credentials, restrict the browser API key to `https://lgarage.github.io/*`.

**L-02 · Item qty fields have no numeric bounds in Firestore rules**
- **File:** `firestore.rules` lines 72–81
- **Risk:** The `unauthItemUpdateAllowed` function validates which fields may change and validates `status` as an enum, but does not validate that `qtyReceived`, `qtyMissing`, `qtyDamaged` are non-negative integers within sane bounds. An unauthenticated actor with a known `itemId` could set quantities to extremely large values.
- **Fix:** Add `request.resource.data.qtyReceived is int && request.resource.data.qtyReceived >= 0 && request.resource.data.qtyReceived <= 9999` (and similar) to `unauthItemUpdateAllowed`.

**L-03 · `driverName` has no server-side length limit**
- **File:** `src/dispatcher/firestoreService.ts` line 524; `src/App.tsx` scanner flow
- **Risk:** The `driverName` field written to `statusHistory.actorName` on check-in has no `maxLength` at the Firestore rule level. A long string would be stored and displayed in audit history views. LOW impact since the field is display-only.
- **Fix:** Add `request.resource.data.actorName.size() <= 128` to the `statusHistory` create rule, or add `maxLength={128}` to the driver name inputs in the UI.

**L-04 · `seedFirestore` guard is scoped only to `deliveries` collection**
- **File:** `src/dispatcher/seedFirestore.ts` lines 320–322; `src/main.tsx` line 57
- **Risk:** `seedFirestore()` runs on every page load. Its guard `if (!snap.empty) return` checks only whether the `deliveries` collection is non-empty. If someone manually purges deliveries from Firestore while other collections retain data (vendors, jobs, etc.), the seed would re-insert demo records into production, silently overwriting vendor/job/zone records with fixture data.
- **Fix:** The seed function should be removed or gated to a dev-only environment flag (`import.meta.env.DEV`). It should not run against the production Firestore project.

**L-05 · Sequential/predictable document IDs**
- **File:** `src/dispatcher/firestoreService.ts` lines 435, 764, 792, 808
- **Risk:** Document IDs are constructed as `delivery-${Date.now()}`, `po-${Date.now()}`, `item-${Date.now()}-${index}`, `event-${Date.now()}`. These are predictable and enable enumeration of delivery IDs if an attacker observes one ID (e.g., from a QR code). Since delivery read access is public, this means any delivery record can be fetched given a base timestamp. LOW risk given the operational context, but worth noting.
- **Fix:** Use `crypto.randomUUID()` (already available in the codebase — see `firestoreService.ts` line 614) for all generated document IDs instead of `Date.now()`.

---

## Summary

| Severity | Count |
|----------|-------|
| HIGH | 0 |
| MED | 2 |
| LOW | 5 |

The auth implementation (`ProtectedRoute`, `AuthContext`, `onAuthStateChanged`) is correct with no race conditions. Open redirect protection in `LoginPage.resolvePostLoginPath` is properly implemented. The Cloud Function (`autoSubmitDeliveries`) is well-scoped and uses admin SDK safely. No XSS vectors (`dangerouslySetInnerHTML` absent throughout), no hardcoded secrets beyond the intentionally-public Firebase API key.

**Priority actions before scale-up:**
1. Restrict audit log writes (M-01)
2. Add server-side pagination or aggregation to dashboard queries (M-02)
3. Remove or env-gate `seedFirestore` from the production bundle (L-04)
