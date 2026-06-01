# StageVerify Current Project Status

## Purpose

StageVerify helps USA Heating & Cooling track deliveries from dispatcher creation through vendor check-in, staging, display board visibility, and technician pickup. The current app is a live Firestore-backed workflow, not a mock prototype.

## What's Built

### Dispatcher workflow
- Real Firestore-backed dispatcher dashboard.
- `New Delivery` button opens `CreateDeliveryModal`.
- Detail drawer shows status history, staging assignment, and status transitions.
- `Mark Picked Up` appears for `ready_for_pickup` and `complete`.
- `Refresh Now` button and 30-second auto-refresh are working.

### Delivery creation
- `CreateDeliveryModal.tsx` writes jobs, vendors, purchase orders, and line items to Firestore.
- Unified data model lives in `src/dispatcher/models.ts`.
- Legacy `src/types.ts` has been removed.

### Vendor check-in
- Mobile scanner flow in `App.tsx` scans QR codes, looks up Firestore data, verifies items, and submits via Firebase.
- Direct check-in route in `CheckInPage.tsx` works at `/checkin/:orderId`.
- Driver name is captured in the scanner flow; the direct form defaults to `Vendor`.
- `qtyDamaged` is currently hardcoded to `0` in the scanner flow.

### Display and pickup
- `EntryDisplayPage.tsx` at `/display` shows live Firestore data with correct status labels and 30-second refresh.
- `PickupPortalPage.tsx` at `/pickup` filters `ready_for_pickup`, `complete`, and `partial` deliveries.
- Technicians can check off deliveries with `recordPickupEvent`.
- Fuzzy zone matching works (`s2a` resolves to `S2-A`).

### Platform state
- Firebase Firestore and Cloud Functions are deployed and live.
- Settings page exists at `/settings`.
- Current flow includes the `ready_for_pickup` lifecycle.

## What's Missing

1. **Firebase Auth** - no login screen or Auth integration exists, so `/dispatcher` and `/settings` are public.
2. **Staging Zone Management page** - the sidebar `Staging Map` link is still a `#` placeholder and there is no CRUD UI for zones.
3. **QR generation and printing** - scanning works, but there is no QR print view or generation library for labels.
4. **Job creation form** - jobs still have to be seeded manually in Firestore.
5. **`qtyDamaged` input in `App.tsx`** - damaged quantity is submitted as `0` instead of being entered by the driver.
6. **Driver name capture in `CheckInPage.tsx`** - the direct route defaults to `Vendor` instead of collecting a real name.
7. **Check-in flow consolidation** - `App.tsx` and `CheckInPage.tsx` overlap and should be unified or clearly separated.

## Next 3 Priorities

1. **Firebase Auth** - add login and protect dispatcher/settings routes so the live operational tools are not public.
2. **Staging Zone Management** - build zone CRUD plus printable QR labels for staging locations.
3. **Consolidate check-in** - merge the two check-in paths and add a real `qtyDamaged` stepper.

## Development Rules

1. Preserve current dispatcher dashboard styling unless specifically requested.
2. Do not redesign the sidebar.
3. Build functionality before visual polish.
4. Keep implementation tasks small and focused.
5. Verify all changes on the deployed GitHub Pages URL whenever possible.
6. Commit and push after successful build verification.
7. Avoid interactive terminal commands.
8. Prefer one completed workflow at a time over partially built features.
