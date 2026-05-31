# StageVerify Roadmap

## Current Status

### Working

- Dispatcher Dashboard
- Delivery Detail Drawer
- Status Workflow
- Staging Location Assignment
- Status History Logging
- Delivery Display Board (UI)
- Vendor Check-In (UI)

### Partially Working

- Vendor Check-In Submit
- Entry Display Board Refresh
- QR Scan Workflow

### Missing

- Create Delivery Workflow
- Pickup Workflow
- Persistent Data Storage
- QR Generation
- Real API Layer

---

# MVP Goal

Process one real USA Heating & Cooling delivery from:

Dispatcher Creates Delivery

↓

Vendor Arrives

↓

Vendor Checks In Materials

↓

Dispatcher Reviews

↓

Technician Picks Up Materials

↓

Zone Becomes Available Again

---

# Phase 1 (Current)

## Dispatcher Workflow

Completed:

- Dashboard
- Detail Drawer
- Status Updates
- Staging Reassignment

Status:
~70% Complete

---

# Phase 2 (Highest Priority)

## Create Delivery

Build:

- New Delivery button
- Delivery creation form
- Job selection
- Vendor selection
- Staging location selection
- Line item entry

Required API:

- POST /deliveries

Reason:

Nothing can happen until a delivery exists.

---

# Phase 3

## Vendor Check-In

Fix:

- QR lookup
- Real submit action
- Item quantity updates
- Damaged quantity tracking

Required API:

- POST /deliveries/:id/checkin

---

# Phase 4

## Technician Pickup

Build:

- Log Pickup button
- Pickup modal
- Pickup history
- Free staging zone automatically

Required API:

- POST /deliveries/:id/pickup

---

# Phase 5

## Persistence Layer

Replace mock service with:

- Firebase
  or
- Supabase

Required before production use.

---

# Future Features

- QR label printing
- Zone management page
- Job management page
- Vendor management page
- Real-time updates
- Notifications
- Mobile technician workflow

---

# Current Recommendation

Do NOT build Jobs, Vendors, Auth, Notifications, Analytics, Reporting, or Zone Management yet.

Next feature:

Create Delivery

This unlocks the entire workflow.
