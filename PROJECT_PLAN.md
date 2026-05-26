# StageVerify — Project Plan

## MVP Goal

A working system that lets an HVAC shop assign approved vendor orders to staging zones, guide vendors to the correct physical drop location, let vendors confirm delivery by QR code, and notify dispatch whether the order is complete or partial.

## Core Workflow

1. Dispatcher records an approved vendor order.
2. Dispatcher assigns vendor, job/site name, job number, site number, expected items, and target staging zone.
3. System updates the entry display board and staging-zone sign preview.
4. Vendor arrives at the shop.
5. Vendor checks the entry display and finds the assigned zone.
6. Vendor places materials in the assigned zone.
7. Vendor scans the QR code on the zone sign.
8. Vendor marks each item as Delivered, Missing, or Backordered.
9. Vendor submits the confirmation.
10. System marks the order as Complete or Partial.
11. Dispatch receives a confirmation email/status update.

## Screens To Build

- **Orders Dashboard**
  - Active order list with status, vendor, job/site, and staging zone.
  - Filters for zone, vendor, job, and status.
  - Summary counts for complete, partial, and pending orders.

- **Create Order**
  - Manual order entry for vendor, job/site, job number, site number, expected items, and staging zone.
  - Mock data support for MVP.

- **Entry Display Board**
  - Shop entry display showing assigned deliveries and zone directions.
  - Clear vendor-facing guidance for where to place materials.

- **Vendor QR Check-In Page**
  - Zone-specific page loaded from the scanned QR code.
  - Item checkoff flow for Delivered, Missing, or Backordered.
  - Submit confirmation button.

- **Dispatch Status View**
  - Read-only view of recent confirmations.
  - Displays order status as Complete or Partial.
  - Placeholder for confirmation email/log.

- **E-Ink Sign Preview**
  - Preview of what the physical zone sign would display.
  - Includes zone, order status, vendor, job/site, and timestamp.

- **Zone Map/List**
  - Visual list or map of staging zones.
  - Status indicators for assigned, pending, complete, or partial.

## Out of Scope For MVP

- BuildOps API integration
- Minew API integration
- Full inventory tracking
- Truck inventory sync
- User authentication
- Multi-location SaaS billing
- AI PDF parsing
- Vendor login accounts

## Keep in MVP

- Mock data
- QR code generation
- Manual order creation
- Delivery item checkoff
- Complete/Partial status logic
- Confirmation email placeholder or console/logged confirmation
- E-ink sign preview placeholder

## Future Phases

1. Minew e-ink sign API connection
2. BuildOps/order email parsing or import
3. Repair/install kits
4. Truck stock replenishment routing
5. Real email/SMS notifications
6. Multi-shop SaaS setup
