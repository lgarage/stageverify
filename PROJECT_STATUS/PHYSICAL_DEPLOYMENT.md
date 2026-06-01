# Physical Deployment Plan: StageVerify

## Summary
This document tracks the physical organization of the shop and its integration with the StageVerify software. The shop is being organized concurrently with software deployment, requiring a flexible system that supports partial hardware (Minew tag) rollout.

## Dependency Chain
- [ ] 1. Obtain Minew login credentials
- [ ] 2. Test Minew tag platform
- [ ] 3. Receive shelving decision
- [ ] 4. Create shop map
- [ ] 5. Install shelving
- [ ] 6. Move inventory
- [ ] 7. Create floor staging areas
- [ ] 8. Assign location IDs
- [ ] 9. Count required tags
- [ ] 10. Order Minew tags
- [ ] 11. Install tags
- [ ] 12. Begin full StageVerify deployment

## Physical Setup Tasks

### Shop Layout
- [ ] Define shelf locations
- [ ] Define floor staging locations
- [ ] Define vendor delivery locations
- [ ] Define technician pickup locations
- [ ] Create repeatable location numbering system (e.g., G1, S1-A, V1, T1)
- [ ] Create visual shop map

### Shelving
- [ ] Finalize shelving decision (Waiting on Jake Korb)
- [ ] Order shelving
- [ ] Install shelving

### External Building
- [ ] Move stock inventory to main shop
- [ ] Remove obsolete inventory
- [ ] Remove scrap material
- [ ] Determine long-term purpose
- [ ] Install shelving (if needed)
- [ ] Create floor staging areas
- [ ] Create vendor delivery zones
- [ ] Create technician pickup zones

### Shop Map
- [ ] Map Main Shop: Shelving, Inventory, Staging locations
- [ ] Map External Building: Vendor delivery areas, Technician pickup areas, Overflow storage
- [ ] Map Office Area: Training equipment, Furnaces, Demonstration equipment
- [ ] Map Traffic Flow: Vendor path, Technician path, Material flow

## Minew Tag Deployment
**Status:** BLOCKED
**Open Questions:**
- What information can be displayed?
- How quickly do tags update?
- How are tags managed?
- What API capabilities exist?

## Software Requirements from Physical Deployment
- **Location Status Model:** `Planned` | `Installed` | `Tagged` | `Active`
- **Location Fields Needed:**
    - Floor marked (Yes/No)
    - Minew tag installed (Yes/No)
    - QR code created (Yes/No)
    - Active (Yes/No)
- **Item Status Flow:** `Ordered` → `Shipped` → `Received` → `Staged` → `Picked Up` → `Installed`

## Tool Cleanup
- [ ] Technicians to supply own hand tools
- [ ] Company to supply large/specialty/shared tools
- [ ] Return unnecessary tools (screwdrivers, nut drivers, pliers, etc.)
- [ ] Categorize: Return | Company Specialty Tools | Shop Inventory | Review Later

## Training Program
- [ ] **Furnace Training Stations:** Create intentional faults (ignitor, flame sensor, pressure switch, capacitor, limit switch) for troubleshooting training.
- [ ] **Commercial RTU Training:** Field PMs with technicians.

> [!IMPORTANT]
> **Guiding Principle:** Build StageVerify to help organize the shop — not the other way around.
