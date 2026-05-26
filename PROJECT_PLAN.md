# StageVerify — Project Plan

## MVP Goal

A working system that lets warehouse staff confirm vendor deliveries by scanning a QR code at a staging zone, and lets dispatchers see those confirmations in near real-time without calling the warehouse.

## Core Workflow

1. Dispatcher or project manager creates a delivery record (vendor, PO, expected items, target staging zone).
2. Vendor arrives at the warehouse with materials.
3. Warehouse staff scan the staging zone QR code or select the delivery from a list.
4. System shows delivery details — what was ordered, what zone it should go to.
5. Staff confirm receipt. They can mark line items as received, short, or damaged.
6. A physical e-ink sign at the staging zone updates to reflect the delivery status.
7. Dispatchers see the confirmation appear on their dispatch view without manual communication.

## Screens To Build

- **Dashboard**
  - Active deliveries grouped by status (Pending, In Progress, Confirmed, Flagged).
  - Quick filters by zone, vendor, or date.
  - Summary counts (total deliveries, pending confirmations, flagged items).

- **Delivery Detail**
  - Full delivery info: vendor name, PO number, scheduled date, target zone.
  - Line-item list with status toggles (Received / Short / Damaged).
  - Notes field for warehouse staff.
  - Confirm button (with "are you sure?" step).
  - QR code display/link for the staging zone.

- **Staging Zone Map**
  - Visual grid or list of staging zones.
  - Color-coded by status: empty (gray), pending delivery (yellow), confirmed (green), flagged (red).
  - Click a zone to see its current delivery.

- **Dispatch View**
  - Read-only view optimized for dispatchers.
  - Auto-refreshing list of recent confirmations.
  - Filter by project, zone, or vendor.

- **E-Ink Preview**
  - Shows exactly what is rendered (or will render) on the physical e-ink display.
  - Zone name, delivery status, vendor, item count, timestamp of last update.
  - Useful for testing without physical hardware.

## Explicitly Out of Scope For MVP

- User authentication and role management.
- Integration with Minew Bluetooth tags/beacons.
- Integration with BuildOps API.
- Inventory tracking or stock-level management.
- Mobile native apps (web only for MVP).
- Notifications (email, SMS, push).
- Historical reporting and analytics.
- Multi-project / multi-tenant support.
- Barcode scanning hardware integration (will use camera-based QR scanning in browser).

## Future Phases

### Phase 2 — Connectivity

- Minew BLE tag integration for automatic zone detection.
- BuildOps API sync for delivery data.
- User auth with role-based access (warehouse vs. dispatcher vs. admin).

### Phase 3 — Hardware

- Physical e-ink sign provisioning and management.
- QR code label printing.
- Tablet-optimized warehouse UI.

### Phase 4 — Intelligence

- Delivery ETA predictions based on vendor history.
- Auto-flagging of discrepancies.
- Inventory reconciliation between ordered and received.
- Reporting dashboard with export.
