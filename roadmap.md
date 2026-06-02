# StageVerify Roadmap

## Purpose

StageVerify helps USA Heating & Cooling track deliveries from dispatcher creation through vendor check-in, staging, display board visibility, and technician pickup. The current app is a live Firestore-backed workflow, not a mock prototype.

---

## What's Built ✓

### Auth & routing
- Firebase Auth fully implemented: `LoginPage`, `ProtectedRoute`, `AuthContext`, logout buttons.
- `/dispatcher` and `/settings` are protected; hub/receive/display/pickup are public.
- Logged-in users at `/` are redirected to `/hub`.

### Dispatcher workflow
- Real Firestore-backed dispatcher dashboard.
- `New Delivery` button opens `CreateDeliveryModal`.
- Detail drawer shows status history, staging assignment, and status transitions.
- `Refresh Now` button and 30-second auto-refresh are working.
- Print Label QR button in delivery detail drawer (`qrcode.react`).
- **Mark Shipped** button in drawer (appears when status is Ordered); **Mark Installed** button in pickup portal.
- Delivery lifecycle: `Ordered → Shipped → Received → Staged → Picked Up → Installed`.

### Delivery creation
- `CreateDeliveryModal.tsx` writes jobs, vendors, purchase orders, and line items to Firestore.
- Unified data model lives in `src/dispatcher/models.ts`.
- Legacy `src/types.ts` has been removed.

### Vendor check-in
- Mobile scanner flow in `App.tsx` scans QR codes, looks up Firestore data, verifies items, and submits via Firebase.
- Direct check-in route in `CheckInPage.tsx` works at `/checkin/:orderId`.
- Driver name captured in scanner flow.
- `qtyDamaged` numeric input present in both `App.tsx` (adjust modal) and `CheckInPage.tsx` (inline when Damaged/Partial).
- Manual delivery ID input capped at `maxLength={64}` in `ReceivingPage.tsx`.
- **`ReceivingPage` check-in items step** restyled to match pickup portal (card layout, checkbox rows); **Adjust** button per line opens qty/damaged modal; partial delivery badges + footer partial-order warning; `npm run verify:receive` Playwright script.
- URL-aware QR scan handlers accept full URLs with `?id=` or `?zone=` params.
- **Status-aware zone QR routing** — scan routes to vendor receive (`/receive`) or tech pickup (`/pickup`) based on delivery status; zone tags encode pickup URL when staged/complete.
- **Need More Space?** tiered flow: Tier 1 shows closest shelf spot (3×3) and ground spot (4×4) side-by-side; Tier 2 offers closest oversized ground spot (4×10). Vendor picks; locations saved via `arrayUnion`.
- Multiple staging locations per delivery (`additionalStagingLocationIds`); pickup portal shows all locations with primary emphasized.
- **Shop Stock Pick List** — dispatcher adds free-text extra shop-stock lines + optional location note per delivery; technicians check off items on pickup before confirming staged pickup (not inventory).

### Staging zone management
- `/zones` route with full CRUD UI (`ZoneManagementPage.tsx`).
- Zones grouped by area, with QR preview per zone.
- `Print All Active Labels` prints all zone QR labels at once.
- `StagingLocation` schema includes `eslTagId`, `notes`, `sortOrder`, `widthFt`, `depthFt`.
- `LocationStatus` enum (`Planned | Installed | Tagged | Active`) replaces `active` boolean; color-coded badge and quick-toggle on each zone card.
- Zone form includes Width/Depth inputs for spot sizing (shelf = 3×3 ft, ground = 4×4 ft, oversized = 4×10 ft).
- Sidebar link active.

### Display and pickup
- `EntryDisplayPage.tsx` at `/display` shows live Firestore data with correct status labels and 30-second refresh; clock advances.
- `PickupPortalPage.tsx` at `/pickup` filters `ready_for_pickup`, `complete`, `partial`, and `picked_up` deliveries.
- Technicians check off deliveries with `recordPickupEvent`; **Mark Installed** button appears after pickup.
- Fuzzy zone matching works (`s2a` resolves to `S2-A`).
- `stagingLocationId` cleared on `picked_up` transition.
- All status labels use `DELIVERY_STATUS_LABEL` map: Ordered / Shipped / Received / Staged / Picked Up / Installed.

### Platform state
- Firebase Firestore and Cloud Functions (v2) deployed and live (Blaze plan, project: `stageverify-db`).
- Settings page exists at `/settings` (protected).
- Route-level code-splitting via `React.lazy` in `main.tsx`.
- Deploy: GitHub Pages — https://lgarage.github.io/stageverify

---

## What's Still Missing

| # | Item | Status |
|---|------|--------|
| 1 | **Driver name in `CheckInPage.tsx`** — direct route still defaults to `"Vendor"` instead of prompting for a name | Done (880ba2f) |
| 2 | **Check-in flow consolidation** — `App.tsx` + `CheckInPage.tsx` overlap; unify or clearly separate | Done (03699ec) — ID QRs routed to CheckInPage; zone QRs stay in App.tsx |
| 3 | **ESL Cloud Function** — MinewTag ESL tag integration via Cloud Function | Blocked: waiting on vendor API creds |
| 4 | **Security audit (away-007)** — full `src/` scan, Gemini 3 Flash scanner + Sonnet verifier | Queued |
| 5 | **Location status model** — add `Planned/Installed/Tagged/Active` status to `StagingLocation` schema; allow system to operate with partial tag deployment | Done (4df28e5) |
| 6 | **Item status flow** — extend delivery/item status to include `Ordered → Shipped → Received → Staged → Picked Up → Installed` with location field | Done (22e5415) |

---

## ESL Integration

Full design spec: `PROJECT_STATUS/ESL_INTEGRATION_PLAN.md`

---

## Development Rules

1. Preserve current dispatcher dashboard styling unless specifically requested.
2. Do not redesign the sidebar.
3. Build functionality before visual polish.
4. Keep implementation tasks small and focused.
5. Verify all changes on the deployed GitHub Pages URL whenever possible.
6. Commit and push after successful build verification.
7. Avoid interactive terminal commands.
8. Prefer one completed workflow at a time over partially built features.
