# StageVerify Current Project Status

## Purpose

StageVerify is being built to help USA Heating & Cooling manage deliveries, staging locations, vendor check-ins, dispatcher visibility, and technician pickups.

The primary goal is to eliminate confusion around where deliveries are physically located inside the shop and provide visibility from delivery arrival through technician pickup.

---

# Current Status (As Of This Revision)

## Working

### Dispatcher Dashboard

- Search
- Sorting
- Filtering
- Status summary cards
- Delivery detail drawer
- Status history display

### Dispatcher Workflow

- Mark Arrived
- Mark Partial
- Mark Complete
- Mark Issue
- Mark Picked Up

### Staging Assignment

- Dispatcher can assign or reassign staging locations
- Dashboard updates immediately
- Detail drawer updates immediately
- History events are logged

### Display Board

- UI exists
- Demonstrates intended workflow

### Vendor Check-In

- UI exists
- QR scanning prototype exists
- Item verification workflow exists

---

# Important Reality Check

The application is currently a functional prototype.

Most business workflows are still powered by mock data.

Data persistence does not yet exist.

Refreshing the application resets all changes.

The current focus should be making the workflow complete before adding advanced features.

---

# Current Known Issues

### Mark Issue Workflow

- Issue text area currently requires investigation and verification.
- Treat this as an active bug until confirmed fixed and deployed.

### Vendor Check-In Integration

- Vendor workflow and dispatcher workflow are not yet connected to the same data source.

### Display Board

- Uses mock data.
- Does not yet reflect real dispatcher activity.

---

# Immediate Next Priorities

## Priority 1

Create Delivery Workflow

Goal:
Allow Gavin to create a delivery before a vendor arrives.

Required:

- New Delivery button
- Delivery creation form
- Vendor selection
- Job selection
- Staging location assignment
- Line item entry

This is the next major workflow that should be built.

---

## Priority 2

Vendor Check-In Integration

Goal:
Connect vendor actions to dispatcher data.

Vendor submissions should update the same delivery records viewed by dispatch.

---

## Priority 3

Technician Pickup Workflow

Goal:
Track who picked up materials and when.

This should automatically free staging locations after pickup.

---

## Priority 4

Persistence Layer

Options:

- Firebase
- Supabase

Do not build a large backend prematurely.

Focus on validating workflow first.

---

# Development Rules

1. Preserve current dispatcher dashboard styling unless specifically requested.
2. Do not redesign the sidebar.
3. Build functionality before visual polish.
4. Keep implementation tasks small and focused.
5. Verify all changes on the deployed GitHub Pages URL whenever possible.
6. Commit and push after successful build verification.
7. Avoid interactive terminal commands.
8. Prefer one completed workflow at a time over partially built features.

---

# Current Recommendation

The next feature to build is:

CREATE DELIVERY WORKFLOW

This unlocks the entire StageVerify lifecycle and provides the greatest business value relative to implementation effort.

StageVerify: Minimum Viable Workflow — End-to-End Gap Analysis
The complete lifecycle has 4 phases and 12 discrete steps. Below is each step with its current implementation status, every missing screen, every missing button, every missing API endpoint, and every data model gap.

Phase 1 — Pre-Delivery Setup (Dispatcher creates the delivery record)
This entire phase is absent from the app. The dispatcher dashboard only reads and updates deliveries that already exist. There is no creation path.

Step 1.1 — Gavin creates a Job
Status: Missing — no screen exists

The Job model is well-defined in dispatcher/models.ts:

models.ts
Lines 1-18
export interface Job {
id: string;
jobNumber: string;
jobName: string;
siteNumber?: string;
status: JobStatus;
createdAt: string;
updatedAt: string;
}
What's missing:

Screen: "New Job" form with fields for job number, job name, site number
Button: "New Job" on the dispatcher dashboard
API: POST /api/jobs — { jobNumber, jobName, siteNumber? }
API: GET /api/jobs — list for dropdown selection in delivery creation
For USA H&C's 30-day goal, this can be bypassed by pre-seeding jobs from a spreadsheet import, but it still needs to exist eventually.

Step 1.2 — Gavin creates (or selects) a Vendor
Status: Missing — no screen exists

Vendor model exists in dispatcher/models.ts with name, contactName, contactPhone. The dispatcher dashboard shows vendor names in the table but there's no way to add one.

What's missing:

API: GET /api/vendors — list for dropdown in delivery creation
API: POST /api/vendors — { name, contactName?, contactPhone? }
Step 1.3 — Gavin creates a Delivery Order with line items
Status: Missing — no screen exists, this is the primary missing flow

This is the single most important missing piece. No screen in the app allows creating a delivery. The dashboard is read-only for existing mock records.

What's missing:

Screen: "New Delivery" modal or page with fields:
Job (dropdown from jobs list)
Vendor (dropdown from vendors list)
PO number (optional text)
Expected delivery date
Staging zone assignment (dropdown from staging locations)
Line items (repeating rows of: SKU, description, qty ordered)
Button: "New Delivery" — completely absent from DispatcherDashboardPage.tsx
API: POST /api/deliveries body:
{
"jobId": "string",
"vendorId": "string",
"purchaseOrderId": "string | null",
"deliveryDate": "YYYY-MM-DD",
"stagingLocationId": "string | null",
"notes": "string?",
"items": [
{ "sku": "string?", "description": "string", "qtyOrdered": 2 }
]
}
Data model gap: Item has no id at creation time — the backend must generate it. The existing model is fine for reads but there's no create payload type defined.
Step 1.4 — Staging zone QR code is printed and affixed to the physical zone
Status: Missing — no functionality exists

The scanner in App.tsx decodes the QR and searches:

App.tsx
Lines 92-99
const foundOrder = mockOrders.find(
(o) => o.id === decodedText || o.zoneId === decodedText,
);
So the QR must encode either a delivery order ID or a staging zone code (like "G1"). But there is no way to generate or print these QR codes from within the app.

What's missing:

Screen: Staging Zone Management page showing all zones with their codes
Button: "Print QR" for each zone — renders a printable label
API: GET /api/staging-locations — list all zones (already in mock service, needs real endpoint)
The QR content should encode the zone code (e.g. "G1"), which is stable and reusable across deliveries. Encoding the delivery ID is fragile — a new delivery means a new QR sticker.
No qrcode or similar package is installed. html5-qrcode is for scanning only, not generation.
Note on the data model: StagingLocation has code, label, type, active — this is sufficient. No model changes needed here.

Phase 2 — Delivery Day: Vendor Check-In
Three of the four check-in steps exist in the UI but are wired to mock data and have broken submit logic.

Step 2.1 — Vendor driver arrives and sees their staging zone on the display board
Status: Partially working — uses mock data, never updates

EntryDisplayPage (/#/display) exists and renders an attractive staging board:

EntryDisplayPage.tsx
Lines 56-60
const activeZones = stagingZones.filter((z) => z.currentOrderId !== null);
But stagingZones comes from src/mockData.ts — hardcoded, never changes, disconnected from the dispatcher's data model. The display board and the dispatcher dashboard use two separate datasets.

What's missing:

API: GET /api/staging-locations/active — returns all zones with their current delivery's vendor name and job name
Auto-refresh: the board needs a setInterval polling every 30–60 seconds; the clock is currently frozen at mount time
Data model alignment: EntryDisplayPage uses src/types.ts → StagingZone.currentOrderId which is the old model. It needs to query the dispatcher model's StagingLocation + DeliveryOrder join.
Step 2.2 — Driver scans QR code at their staging zone
Status: Partially working — QR scan runs, but lookup uses wrong data and has no real API call

The html5-qrcode integration in App.tsx correctly opens the camera and decodes. But on decode:

App.tsx
Lines 91-99
(decodedText: string) => {
const foundOrder = mockOrders.find(
(o) => o.id === decodedText || o.zoneId === decodedText,
);
if (foundOrder) {
handleOrderFound(foundOrder);
} else {
handleOrderFound(mockOrders[0]);
}
},
Two bugs:

Looks up in src/mockData.ts (old model), not the dispatcher's dataset
If no match, silently falls back to mockOrders[0] — a wrong order silently loads
What's missing:

API: GET /api/deliveries?zoneCode=G1 or GET /api/deliveries?zoneCode=G1&status=pending,arrived — return the active delivery at that zone
Error state: if the zone has no pending delivery, show a clear message instead of loading a random order
Side effect on scan: scanning should trigger status transition from pending → arrived
API: PATCH /api/deliveries/:id/status body { toStatus: "arrived" } — called automatically when the driver scans
The arrived status exists in the dispatcher model's state machine:

service.ts
Lines 9-9
pending: ["arrived", "issue"],
But the check-in flow in App.tsx uses the old src/types.ts model which has no arrived status at all — it jumps straight to Pending → Partial/Complete.

Step 2.3 — Driver verifies line items and marks quantities
Status: Partially working — UI exists but uses wrong data model

App.tsx renders a scrollable item checklist. It works well as a UI. But it uses src/types.ts → LineItem:

types.ts
Lines 4-11
export interface LineItem {
id: string;
description: string;
quantity: number;
deliveredQty: number;
missingQty: number;
status: ItemStatus | null;
}
The dispatcher model's Item is richer:

models.ts
Lines 72-83
export interface Item {
id: string;
deliveryOrderId: string;
sku?: string;
description: string;
qtyOrdered: number;
qtyReceived: number;
qtyMissing: number;
qtyDamaged: number;
qtyBackordered: number;
status: ItemStatus;
}
The check-in UI has no field for qtyDamaged — a critical operational data point for an HVAC company where equipment arrives broken. The Damaged status pill exists in CheckInPage.tsx but there's no numeric quantity input for damaged units.

What's missing:

Data model alignment: check-in must submit to the dispatcher's Item shape
UI addition: "Qty Damaged" stepper input alongside "Qty Delivered" in the item card
CheckInPage.tsx has the better item-per-card UI; App.tsx has the better scan flow — these two components need to be merged
Step 2.4 — Driver submits the check-in
Status: Broken — submit does nothing

This is the most critical broken step in the app. In App.tsx:

App.tsx
Lines 183-190
const confirmSubmit = () => {
setShowSubmitConfirm(false);
if (order) {
const allDelivered = items.every((it) => it.deliveredQty === it.quantity);
setOrder({ ...order, status: allDelivered ? "Complete" : "Partial" });
}
setStep("done");
};
setStep("done") is the entire submit. No API call. No persistence. Data is lost on refresh.

In CheckInPage.tsx:

CheckInPage.tsx
Lines 246-248
const handleSubmit = () => {
setStep("done");
};
Same problem. Both files show "Dispatch has been notified" on the done screen — this is false.

What's missing:

API: POST /api/deliveries/:id/checkin body:
{
"items": [
{
"id": "item-1",
"qtyReceived": 2,
"qtyMissing": 0,
"qtyDamaged": 0,
"qtyBackordered": 0,
"status": "received"
}
],
"vendorNote": "string?",
"overallStatus": "partial | complete"
}
This API call should:
Update each Item record with received/missing/damaged/backordered quantities
Advance DeliveryOrder.status from arrived → partial or complete
Create a StatusHistoryEvent with actorType: "vendor" and the driver's name
Trigger dispatcher notification (at minimum: in-app status refresh; ideally email/SMS)
The vendor's name needs to be captured. Currently there's no input for "driver name" on the check-in screen. The history event logs actorName but it's hardcoded to "Dispatcher" in the mock service.
Phase 3 — Dispatcher Review
Most of this phase has UI, but nothing persists.

Step 3.1 — Gavin sees the updated delivery status on his dashboard
Status: Broken — dashboard never auto-refreshes

fetchAllData() is called on mount and whenever query changes (filter/sort). It is never called on a timer. If a vendor submits at 2:00 PM and Gavin loaded the page at 1:55 PM, he will never see the update unless he changes a filter or refreshes the browser.

What's missing:

Polling: useEffect with setInterval(fetchAllData, 30_000) as a minimum
Or WebSocket/SSE push for real-time: server emits an event when a delivery's status changes; client listens and calls fetchAllData()
Visual indicator: "New activity" badge or "Updated X seconds ago" counter that turns red when stale
Step 3.2 — Gavin reviews delivery detail and handles issues
Status: Mostly working in demo — all mutations only touch in-memory state

The StatusActionPanel in DispatcherDashboardPage.tsx provides:

Status transition buttons (well-designed, correct state machine)
Issue reporting with reason text input
Staging location assignment dropdown
All three call mockDispatcherDataService methods which mutate local arrays. On page refresh everything resets to dispatcher/mockData.ts.

What's missing:

API: PATCH /api/deliveries/:id/status body { toStatus, reason? }
API: PATCH /api/deliveries/:id/staging-location body { stagingLocationId: string | null }
Both exist as method signatures in DispatcherDataService interface — the contract is already designed, it just needs a real HTTP implementation
Step 3.3 — Entry display board reflects current state
Status: Broken — static, uses wrong dataset

As noted in Step 2.1, the display board reads from src/mockData.ts and never polls. A delivery that goes from pending to complete on the dispatcher dashboard will still show as pending on the display board indefinitely.

What's missing:

The board must be re-pointed to query the dispatcher's data layer
Auto-refresh interval (every 30–60s is fine for a warehouse TV screen)
The status color/label should use the dispatcher model's DeliveryStatus values, not the old OrderStatus
Phase 4 — Technician Pickup
This phase has zero implementation. The data model exists; the UI has a read-only view; there is no creation path anywhere.

Step 4.1 — Technician arrives and logs the pickup
Status: Missing — no screen or button exists

The PickupEvent model is fully defined:

models.ts
Lines 105-113
export interface PickupEvent {
id: string;
deliveryOrderId: string;
jobId: string;
technicianName: string;
pickedUpAt: string;
itemsPickedSummary: string;
notes?: string;
}
The dispatcher drawer correctly displays pickup events in a read-only timeline. But there is no way to create one.

What's missing:

Button: "Log Pickup" in the StatusActionPanel section of the detail drawer — should only appear when status === "complete"
Screen/modal: pickup form with fields:
Technician name (text input)
Items picked summary (text area — free text like "2 RTU units, 4 duct sections")
Notes (optional text area)
API: POST /api/deliveries/:id/pickup body:
{
"technicianName": "Mike Torres",
"itemsPickedSummary": "2 RTU units, 4 duct sections",
"notes": "Left filter rack — technician returning Thursday"
}
Step 4.2 — Status advances to picked_up and zone is freed
Status: Partially exists in state machine, never executes

The state machine correctly defines:

service.ts
Lines 12-12
complete: ["picked_up"],
So the "Mark Picked Up" button appears in the StatusActionPanel when status is complete. But pressing it only mutates the local mock array. Additionally, there is no logic to free the staging zone when status reaches picked_up.

What's missing:

The PATCH /api/deliveries/:id/status call (from Step 3.2) must also clear stagingLocationId when toStatus === "picked_up" — or this can be a separate field in the request
The staging location manager (dropdown in the drawer) should reflect the zone as "available" again after pickup
The display board must remove the zone card and show it as "Available"
Optionally: auto-create the PickupEvent record when status transitions to picked_up if the Log Pickup form was already filled
Consolidated Missing Pieces
Missing Screens (6)
Screen Route suggestion Purpose
Create Delivery Order
/#/dispatcher/deliveries/new
Dispatcher creates a delivery before it arrives
Create Job
/#/dispatcher/jobs/new
Register a job/site
Staging Zone Management
/#/dispatcher/zones
Manage zones and print QR codes
QR Print View
/#/zones/:code/print
Printable label with QR code for a zone
Technician Pickup Form
Modal in dispatcher drawer
Log who picked up what
Vendor Login / Name Entry
Before check-in
Capture driver name for audit trail
Missing Buttons (7)
Button Location Triggers
New Delivery
Dispatcher dashboard header
Opens Create Delivery modal
New Job
Dispatcher dashboard or settings
Opens Create Job form
Print QR
Each staging zone in zone manager
Opens print view
Log Pickup
Dispatcher drawer — visible when status === "complete"
Opens pickup form
Refresh Now
Dispatcher dashboard header
Manual fetchAllData() call
Clear Zone
Dispatcher drawer — after pickup
Removes staging location assignment
Qty Damaged stepper
Check-in item card
Records damaged quantity
Missing API Endpoints (10)
Method Path Called from
POST
/api/jobs
Create Job form
GET
/api/jobs
Delivery creation dropdown
POST
/api/vendors
Vendor registration
GET
/api/vendors
Delivery creation dropdown
POST
/api/deliveries
Create Delivery form
GET
/api/deliveries
Dispatcher dashboard (replace mock)
GET
/api/deliveries/:id
Detail drawer (replace mock)
GET
/api/deliveries?zoneCode=G1
QR scan lookup
PATCH
/api/deliveries/:id/status
Status transitions in drawer
PATCH
/api/deliveries/:id/staging-location
Zone assignment in drawer
POST
/api/deliveries/:id/checkin
Vendor submit button
POST
/api/deliveries/:id/pickup
Log Pickup form
GET
/api/staging-locations
Zone dropdown + display board
GET
/api/staging-locations/:code/qr
QR code image generation
Data Model Gaps
Issue Location Fix
Two disconnected type systems
src/types.ts vs src/dispatcher/models.ts
Delete src/types.ts; App.tsx and CheckInPage.tsx must use dispatcher models
LineItem has no qtyDamaged field
src/types.ts
Align to dispatcher Item shape
Check-in submits no driver name
App.tsx, CheckInPage.tsx
Add actorName field to checkin payload
StagingZone.currentOrderId (old model)
src/mockData.ts
Remove; derive zone occupancy from DeliveryOrder.stagingLocationId
OrderStatus (old: Pending/Partial/Complete)
src/types.ts
Remove; use DeliveryStatus from dispatcher model
ItemStatus mismatch (old: "Delivered" vs new: "received")
src/types.ts vs src/dispatcher/models.ts
Canonicalize on dispatcher model's lowercase values
No qrPackage dependency
package.json
Add qrcode or qr-code-styling for QR generation
No auth/session types
entire codebase
Add User, Session, Role models and protect routes
The Minimum Viable Path
If the goal is specifically "one real delivery, end-to-end, in 30 days" the critical chain is:

Seed real data directly — skip Create Job/Vendor screens by manually inserting real USA H&C jobs into a database. Eliminates 2 screens from the critical path.
Build Create Delivery screen — one form, one POST /api/deliveries. This unblocks everything else.
Wire checkin submit to a real API — POST /api/deliveries/:id/checkin with item quantities.
Add Log Pickup button + form — one modal, one POST /api/deliveries/:id/pickup.
Replace mock service with real HTTP calls throughout the dispatcher dashboard.
Add a 30-second poll to the dashboard — single setInterval, instant win.
Steps 4–6 can be done by one developer in a week. Steps 2–3 take another week. The real work is step 5 — standing up the backend — which is not a frontend task at all and dominates the timeline regardless of what else is done.
