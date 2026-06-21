# StageVerify — Simple Product Scope

> **Product authority — read this for “what we’re building.”** All features, phases, away-queue items, UI flows, and agent work **must align with this document**. `docs/roadmap.md` and `docs/project_state.md` trace delivery status to scope § here; **`PROJECT_STATUS/CURRENT_STATE.md`** points here first. When any doc disagrees with this file, **this file wins** — update the other doc, do not widen scope silently.

## What StageVerify Does

StageVerify helps manage material deliveries, staging locations, readiness, scheduling, and technician pickup.

It tells vendors where to place material, tells dispatch when the material is actually ready, and gives technicians a simple mobile checklist showing what to pick up and where it is located.

The system should be:

- Simple
- Fast to load
- Mobile-friendly
- Secure without unnecessary steps
- Easy for vendors and technicians to use
- Accurate even when people retry, double-tap, or use more than one browser

Vendors and technicians should not need individual StageVerify accounts.

---

# 1. Dispatcher Creates the Job and Delivery

Gavin or another authorized dispatcher creates the job and delivery information in StageVerify.

The information may include:

- Site or shop name
- Customer name
- Job name
- Job number
- Vendor
- Purchase order number
- Vendor order or delivery number
- Expected material
- Assigned staging location
- Expected delivery date

One job may include:

- Multiple vendors
- Multiple purchase orders
- Multiple deliveries
- Multiple items
- Multiple quantities
- Multiple staging locations

Each PO belongs to one job and one vendor.

One vendor may have more than one PO for the same job.

Each PO may have more than one delivery.

Each delivery may include multiple items, quantities, and staging locations.

StageVerify keeps each vendor, PO, delivery, item, quantity, and location separate.

One completed delivery must not complete another delivery.

One completed PO must not make the entire job ready while another required PO is still incomplete.

---

# 2. Vendor Arrival Display

When the vendor arrives at the shop, the 7.3-inch entry display shows where the delivery should go.

Example:

- Site: GB External Building
- Job: PF-Green Bay West
- Job Number: 26-1042
- Vendor: Johnstone Supply
- Assigned Location: G2

The driver goes directly to the assigned staging location.

The driver does not need an individual account.

The entry display should show only enough information to help the vendor find the correct delivery location.

---

# 3. Vendor Check-In

At the assigned staging location, the vendor scans the delivery-specific QR code.

The vendor then enters the vendor company’s shared four-digit PIN.

The PIN identifies the vendor company, not the individual driver.

Anyone delivering for that vendor may use the shared PIN.

The vendor does not need to enter:

- Their name
- Their email address
- A signature
- A username
- A password
- A Google account
- Any personal information

After the correct PIN is entered, StageVerify opens only the delivery connected to the scanned QR code.

The vendor must not be able to browse:

- Other deliveries for the same vendor
- Other jobs
- Other POs
- Other vendors
- The dispatcher page
- A full staging-location map

The vendor initially sees only the staging location assigned to that delivery.

## Vendor Access Protection

Vendor access should eventually use:

- A delivery-specific QR link
- The vendor’s shared PIN
- A temporary delivery-specific session
- Configurable session expiration
- Server-side validation
- A shop geofence as an additional control

The geofence helps confirm that the vendor is near the shop, but it is not the only security protection.

---

# 4. Vendor Delivery Actions

The vendor page should remain very simple.

The main actions are:

- Need More Space?
- Issue
- DELIVERED

The vendor does not:

- Count material
- Enter quantities
- Check off individual items
- Compare the delivery against the PO
- Decide whether the whole order is complete
- Decide whether the material is Ready for Pickup

## DELIVERED

If there are no problems, the vendor presses:

**DELIVERED**

This confirms that material associated with the displayed PO was physically dropped off at the assigned location.

Before pressing DELIVERED, the vendor verifies:

- The correct job
- The correct PO

Pressing DELIVERED does not automatically make the material Ready for Pickup.

The vendor confirms only that physical drop-off occurred for that PO.

The vendor does not confirm:

- Item quantities
- Order completeness
- Material readiness

StageVerify separately decides whether the complete order is ready.

## Need More Space?

If the assigned location is not large enough, the vendor selects:

**Need More Space?**

The choices may include:

- Shelf
- Ground
- Large/Oversized Delivery

For Shelf or Ground material, StageVerify assigns or suggests another appropriate open location.

The original location remains connected to the delivery.

The additional location is also connected to the same delivery.

Example:

- Original location: G2
- Additional location: G3
- Delivery locations: G2 and G3

After the additional location is assigned, the vendor may see both G2 and G3 because both locations now apply to that specific delivery.

The vendor still does not see unrelated locations.

## Large or Oversized Delivery

For a large or oversized delivery, StageVerify should direct the vendor to contact dispatch rather than assigning an unsuitable normal shelf or ground location.

The dispatch phone number should be clickable:

**920-336-0110**

When the vendor taps the number, the phone asks whether they want to place the call.

## Issue

The vendor may report an issue such as:

- Wrong Location
- Damaged Items
- Missing Items
- Other

“Missing Items” allows the driver to report an obvious missing package or a delivery issue they already know about. The driver is not required to count material or verify the complete PO.

Selecting any issue opens a text box where the vendor can provide more information.

The issue is recorded and clearly flagged for Gavin or another dispatcher to review.

An unresolved issue can prevent the affected material from becoming Ready for Pickup.

---

# 5. StageVerify Determines Readiness

The vendor does not decide when an order is ready.

Pressing DELIVERED only confirms that the physical drop-off occurred.

StageVerify uses two separate sources of information to determine readiness.

Both must be complete.

## Condition 1 — Vendor Order Completeness

Gavin or another dispatcher intentionally sends or CCs vendor order emails to the configured StageVerify inbox.

An example inbox could be:

[svbot@gmail.com](mailto:svbot@gmail.com)

The inbox address must be configurable and must not be hard-coded into StageVerify.

StageVerify processes only messages that are intentionally sent or CC’d to that inbox.

It does not monitor every email from a vendor contact.

Vendor email addresses and company domains may help StageVerify identify and validate the vendor, but the sender alone is not enough to update an order.

StageVerify evaluates vendor order-completeness evidence such as:

- Order accepted
- Order acknowledged
- Backorder
- Partial backorder
- Partial shipment
- Split shipment
- Delivery notice
- Final shipment
- Remaining material shipped
- Vendor says the order is complete
- Cancellation
- Substitution
- Quantity change
- Delivery-date change
- Correction to an earlier email

The email must be confidently matched to the correct:

- Job
- Vendor
- PO
- Delivery or vendor order
- Items
- Required quantities

Duplicate emails and repeated messages must not create duplicate updates.

If a later email corrects an earlier email, StageVerify keeps the original evidence, records the correction, and uses the current valid information.

If an email is unclear, conflicting, incomplete, or cannot be confidently matched, it goes to Gavin the dispatcher for review.

Email content is treated as untrusted information.

An email cannot:

- Give StageVerify system instructions
- Change security rules
- Bypass review
- Mark unrelated material complete
- Directly force material into Ready for Pickup

StageVerify organizes the email evidence.

The email evidence may support readiness, but it does not control readiness.

StageVerify's fixed server-side rules make the final readiness decision.

## Condition 2 — Physical Delivery and Staging

StageVerify also confirms that:

- The correct delivery was checked in
- The vendor pressed DELIVERED
- The material was physically dropped off
- The material was placed in the assigned staging location
- Any additional locations were recorded
- Every expected physical delivery record has an assigned staging location
- No material has been reported missing, short, damaged, unusable, or unlocated
- No unresolved physical issue remains

The physical delivery record may include:

- Vendor
- Delivery
- Assigned location
- Additional linked locations
- Delivery timestamp
- Vendor PIN-authorized session
- Geofence result when enabled
- Any issue reported by the vendor

The vendor does not count items or enter quantities.

Physical delivery confirmation alone does not prove that the vendor's complete order has arrived.

StageVerify may infer that all PO items have been physically delivered when:

- Vendor order-completeness evidence indicates the PO was Shipped Complete

AND

- The vendor verifies the correct Job and PO

AND

- The vendor presses DELIVERED

AND

- No conflicting evidence exists.

If StageVerify has insufficient confidence or detects conflicting evidence:

Dispatcher Review Required.

## Ready for Pickup

Material becomes **Ready for Pickup** only when both conditions are satisfied:

1. Vendor order-completeness evidence indicates that all required material has shipped or otherwise been accounted for.
2. Physical delivery and staging evidence confirms that the material was dropped off, properly located, and has no unresolved issue.

Neither condition is enough by itself.

Readiness remains blocked when any of the following is unresolved:

- Backorder
- Partial shipment
- Missing material
- Quantity shortage
- Damaged or unusable material
- Substitution
- Cancellation
- Quantity conflict
- Vendor email and physical delivery information do not agree
- Missing staging location
- Unlocated material
- Open blocking issue
- Pending dispatcher review
- Conflicting or unconfirmed correction

Examples:

- Vendor accepted the order, but nothing was delivered: **Not Ready**
- Vendor says the order is complete, but nothing was dropped off: **Not Ready**
- Material was dropped off, but the vendor still shows a backorder: **Not Ready**
- Material was dropped off, but no staging location was recorded: **Not Ready**
- Vendor says complete, but material is damaged or missing: **Not Ready**
- Driver presses DELIVERED, but vendor information still shows material outstanding: **Review Required**
- Vendor email and physical delivery information conflict: **Review Required**
- Vendor confirms completion and the complete physical delivery is properly staged with no unresolved issue: **Ready for Pickup**

## Readiness by Delivery, PO, and Job

StageVerify checks readiness separately for every delivery and PO.

One completed delivery must not complete another delivery.

One completed delivery must not make an incomplete PO ready.

One completed PO must not make the entire job ready if another required PO remains incomplete.

A job may have some deliveries that are Ready for Pickup while other deliveries are still incomplete.

StageVerify may show an individual delivery or PO as ready.

The entire job must NOT show:

**Everything Ready for Pickup**

until every required:

- Vendor
- PO
- Delivery
- Item
- Required quantity
- Staging location

passes the two-source readiness check.

The readiness calculation is controlled by StageVerify’s server-side rules.

Repeating the same readiness calculation without any new information must NOT create duplicate updates or duplicate history.

---

# 6. Dispatcher Readiness View

The dispatcher page gives the dispatcher a clear view of the job’s current state.

Possible states may include:

- Awaiting Vendor Delivery
- Partial
- Issue or Review Required
- Ready for Pickup
- Pickup Scheduled
- Pickup in Progress
- Picked Up
- All Items Picked Up

The dispatcher should be able to see:

- Which deliveries are ready
- Which deliveries are incomplete
- Which POs are ready
- Which POs are incomplete
- Which vendors still have material outstanding
- Which deliveries have issues
- Whether the entire job is ready
- What has already been picked up
- What still remains

The entire job must not show Everything Ready for Pickup until all required material is ready.

When everything required is ready, Gavin sees a clear Ready for Pickup indicator.

This tells him the pickup can now be scheduled.

---

# 7. Gavin Marks the Pickup Scheduled

After Gavin schedules the technician in BuildOps, he updates StageVerify to show:

**Pickup Scheduled**

This tells dispatch and the shop that:

- The material is ready
- A technician has been scheduled
- The pickup has not yet been completed

Pickup Scheduled is clearer than simply saying Scheduled because Scheduled could be confused with the vendor delivery schedule.

---

# 8. Copy Pickup Information

The dispatcher page includes a button such as:

**Copy Pickup Information**

When Gavin presses the button, StageVerify copies a complete pickup message to the computer clipboard.

The copied information includes:

- Site or shop name
- Job name
- Job number
- Pickup locations
- StageVerify pickup link

Example:

> **StageVerify Pickup**
> Site: GB External Building
> Job: PF-Green Bay West
> Job Number: 26-1042
> Pickup Locations: G2, S1A, G12, S2F
>
> Open pickup checklist:
> [StageVerify job pickup link]

Gavin pastes the complete message directly into the BuildOps job or technician instructions.

He does not need to separately copy the site, job number, locations, and link.

The copied message lets the technician verify:

- They are at the correct shop
- They have the correct job
- They are looking for the correct pickup locations
- They opened the correct StageVerify pickup checklist

---

# 9. Technician Opens the Pickup Link

When the technician arrives at the shop, they open the link from BuildOps.

The StageVerify pickup page opens directly on the technician’s phone.

The technician does not need:

- A PIN
- A username
- A password
- A Google login
- An account
- Any authentication screen

The link immediately opens the correct job.

The final secure design should use an opaque, unguessable, revocable, server-validated pickup token instead of relying only on a plain job number or predictable ID.

The token allows access only to the intended job pickup page.

It does not provide general access to Firestore, other jobs, or the dispatcher dashboard.

---

# 10. Technician Pickup Page

The technician sees all material assigned to the job.

The page should be organized by physical pickup location.

For each pickup line, the technician should see:

- PO
- Item
- Quantity
- Pickup location
- Pickup status

Vendor and delivery information may remain stored in StageVerify for dispatch, email matching, and history, but the technician does not need to see it unless it is required to distinguish otherwise identical material.

Example:

**Site:** GB External Building
**Job:** PF-Green Bay West
**Job Number:** 26-1042
**PO Numbers:** PO-45821, PO-45822, PO-45823, PO-45824
**Pickup Locations:** G2, S1A, G12, S2F

## G2

**PO:** PO-45821

- ☐ 1 × Condenser fan motor

## S1A

**PO:** PO-45822

- ☐ 1 × Mounting kit

## G12

**PO:** PO-45824

- ☐ 1 × Filter rack

## S2F

**PO:** PO-45823

- ☐ 1 × Hardware box

The technician goes to each location and confirms they are at the correct location.

The technician may use:

- The pickup page
- The E-tag
- Physical location labels
- Shop signage

The E-tag is preferred when available.

The pickup link from BuildOps and the StageVerify pickup page remain the source of truth.

The E-tag may show:

- Location, such as G2
- Job name
- Job number
- PO number
- Other information needed to confirm the correct material

These displays help the technician confirm that they are collecting material for the correct job and location.

The technician checks only the material they physically collect.

Each checkbox or pickup line represents a specific:

- Item
- Quantity
- Pickup location

The checkboxes must be saved in StageVerify. They are not only a temporary visual checklist.

Checking one pickup line must not mark unrelated items, POs, deliveries, or locations as picked up.

If the same item is stored in more than one location, each location must have its own pickup line.

If only part of an assigned quantity is collected:

- The collected quantity becomes Picked Up
- The remaining quantity stays outstanding
- The location stays assigned if material remains there
- The job remains Pickup in Progress

---

# 11. Shop Stock on the Pickup Page

A technician’s pickup list may also include shop-stock items assigned by Gavin or another authorized dispatcher.

Vendor-delivered material and shop stock appear in one pickup experience.

They remain separate in:

- The data model
- Transactions
- Audit history
- Dispatcher reporting

Shop stock is not modeled as:

- A vendor
- A PO
- A vendor delivery

Example:

## Shop Stock

### S6F Bin

- ☐ 3 × 3/4-inch PVC 90s

### G15–G17

- ☐ 1 × 10-foot piece of 3/4-inch PVC pipe

The stock directory maps each stock item to its physical location.

A stock area may use:

- One shelf location
- One bin
- One ground location
- One rack
- A combination of several standard locations

## Combination Locations

A long stock item may occupy more than one standard location.

Example:

- Combination location: G15–G17
- Primary location: G15
- Member locations: G15, G16, G17

The three locations represent one physical pipe-storage area.

They do not represent three separate quantities of pipe.

All member locations remain reserved together while the combination stock area is active.

G15, G16, and G17 must not be assigned separately to:

- Another stock group
- Another job
- A vendor delivery
- Another temporary staging use

## Running-Low Shop Stock

The technician may report that a shop-stock item is running low.

The technician selects an action such as:

**Running Low**

The technician may add a short note if needed.

StageVerify flags the item for Gavin or another authorized person to review and reorder.

Reporting that stock is running low does not automatically create a purchase order.

It creates a visible restock alert.

Only Gavin or another authorized user may create, change, deactivate, or remove a permanent shop-stock location mapping.

---

# 12. Technician Completes Pickup

When the technician submits the checked material:

- Checked material becomes Picked Up
- Unchecked material remains outstanding
- Unrelated material remains unchanged
- A partial pickup becomes Pickup in Progress
- A fully collected delivery becomes Picked Up
- A PO remains incomplete if any required material remains
- The full job becomes All Items Picked Up only when all required material has been collected

The technician clicks:

**Order Pickup Complete**

StageVerify then updates the dispatcher view.

Pickup recording must be:

- Server-owned
- Transactional
- Idempotent
- Safe against duplicate taps
- Safe against retries
- Safe against concurrent browser sessions

If only part of an assigned quantity is collected:

- The collected quantity becomes Picked Up
- The remaining quantity stays outstanding
- The location remains assigned if material is still there
- The job remains Pickup in Progress

The technician cannot mark the entire job complete by checking only one delivery, item, or location.

## If the Technician Forgets to Complete the Pickup

StageVerify should not automatically mark a pickup complete merely because the technician leaves the shop.

If the technician leaves the configured quarter-mile radius without pressing Order Pickup Complete, StageVerify may, where device and browser permissions support it:

- Display a reminder
- Prompt the technician to complete the pickup
- Flag the incomplete pickup for Gavin

Mobile browsers may not continue monitoring location after the page is closed, so this reminder cannot be guaranteed.

Leaving the shop does not prove that every item was collected.

Unchecked material must never be marked picked up automatically.

Pressing Order Pickup Complete submits the technician’s current selections. It does not mark unchecked material as picked up or force the entire job complete.

---

# 13. Dispatcher Sees the Pickup Update

After the technician submits the pickup checklist, Gavin sees the updated status on the dispatcher page.

The dispatcher can see:

- Vendor
- PO
- Delivery or order
- Item
- Quantity picked up
- Quantity remaining
- Location
- Pickup time
- Pickup status
- Pickup operation or session record
- Open issues
- Running-low shop-stock alerts

The technician does not need to see which vendor delivered the material.

The technician mainly needs to see:

- Job
- PO
- Item
- Quantity
- Pickup location
- Pickup status

Vendor information remains in StageVerify for dispatch, email matching, order tracking, and history.

Example:

- G2: Picked Up
- S1A: Pickup in Progress
- S6F Bin: Shop Stock — Awaiting Pickup
- G15–G17: Shop Stock — Awaiting Pickup
- Entire Job: Pickup in Progress

When everything required for the job has been collected:

- Entire Job: All Items Picked Up

## Making Temporary Staging Locations Available Again

When all material assigned to a temporary staging location has been picked up, StageVerify changes that location back to:

**Available**

Example:

- Before pickup: G2 — Assigned to Job 26-1042
- After all material is picked up: G2 — Available

A temporary staging location must stay assigned if:

- Material still remains there
- The pickup is still in progress
- Another delivery still uses the location
- Another job still uses the location
- An active stock assignment uses the location
- An open issue prevents the location from being cleared
- Dispatch has placed the location on hold

If a job uses more than one temporary staging location, StageVerify clears each location separately.

Example:

- G2: All assigned material picked up — Available
- S1A: Material still remains — Still Assigned
- Entire Job: Pickup in Progress

Before releasing a temporary staging location, StageVerify must confirm that no other active job, delivery, or stock assignment still uses it.

The release and availability update must be server-owned and concurrency-safe so the same location cannot be released and reassigned incorrectly by overlapping actions.

When the location becomes available:

- StageVerify marks the location Available
- The E-tag updates to show Available
- The old job, PO, and delivery information is removed from the E-tag
- The audit history keeps a record of the previous assignment

## Temporary Combination Locations

The combination group and all of its member locations must be released together through one server-owned, concurrency-safe operation.

A temporary delivery may use a combination of several staging spaces.

Example:

- Temporary combination location: G20–G22
- Member locations: G20, G21, G22

All member spaces stay reserved together until the entire temporary combination assignment is cleared.

When the full assignment is cleared:

- G20 becomes Available
- G21 becomes Available
- G22 becomes Available
- G20–G22 becomes Available

StageVerify must confirm that no other active assignment uses any member location before releasing the group.

## Permanent Shop-Stock Locations

Permanent shop-stock locations work differently.

Examples:

- S6F Bin — PVC fittings
- G15–G17 — Long PVC pipe storage

Picking up some shop stock does not make the stock location Available.

Instead, StageVerify updates the stock quantities, including:

- Quantity available
- Quantity assigned to a job
- Quantity picked up
- Quantity still assigned
- Quantity returned
- Quantity corrected or adjusted

The stock location remains assigned to that shop-stock item.

A permanent shop-stock location becomes available for another use only when Gavin or another authorized person deactivates or removes the stock-location mapping.

For a permanent combination stock area such as G15–G17:

- G15, G16, and G17 remain reserved together
- Picking up one piece of pipe does not release those locations
- The group remains active while it is still the mapped pipe-storage area

## Dispatcher Location View

The dispatcher view should clearly show:

- Assigned temporary staging locations
- Pickup in progress
- Available locations
- Locations on hold
- Temporary combination locations
- Permanent shop-stock locations
- Stock quantities and running-low alerts

This lets Gavin quickly see:

- Which material was collected
- What still remains
- Which temporary spaces can be used for the next delivery
- Which locations must stay reserved for permanent shop stock

---

# 14. The Simple StageVerify Flow

The basic StageVerify flow is:

1. Gavin or another dispatcher creates the job, delivery, and staging assignment.
2. The entry display tells the vendor where to go.
3. The vendor goes to the assigned location.
4. The vendor scans the delivery QR code.
5. The vendor enters the shared vendor PIN.
6. The vendor reports an issue, requests more space, or presses DELIVERED.
7. StageVerify records the physical delivery.
8. Vendor order emails are intentionally sent or CC’d to the configured StageVerify inbox.
9. The StageVerify bot evaluates vendor order-completeness evidence.
10. StageVerify applies the two-source readiness gate.
11. Gavin sees Ready for Pickup when all required evidence is satisfied.
12. Gavin schedules the technician in BuildOps.
13. Gavin marks the StageVerify job as Pickup Scheduled.
14. Gavin presses Copy Pickup Information.
15. StageVerify copies the site, job, locations, and pickup link.
16. Gavin pastes the complete information into BuildOps.
17. The technician taps the link with no login required.
18. The technician sees the pickup checklist and locations.
19. The technician collects and checks off the material.
20. The technician may report shop stock that is running low.
21. The technician presses Order Pickup Complete.
22. StageVerify records the pickup transaction.
23. Gavin sees what was picked up and what remains.
24. StageVerify shows All Items Picked Up when the entire job pickup is finished.
25. StageVerify releases each temporary staging location after all material assigned to that location has been picked up.
26. The E-tag changes to Available and clears the old job information.
27. Permanent shop-stock locations remain reserved while StageVerify updates their stock quantities.

---

# Product Principle

StageVerify should make the physical material workflow easier.

It should not become another complicated system that people avoid using.

StageVerify organizes evidence.

StageVerify's server-side rules make the final readiness decision.

No single actor:

- Vendor
- Dispatcher
- Technician
- Email parser
- AI component

can independently determine Ready for Pickup.

Ready for Pickup is determined only after StageVerify evaluates all available evidence.

The vendor experience should take only a few simple actions.

The technician should open one link and immediately know:

- Which job this is
- Which shop or site they are at
- What material to collect
- Where every item is located
- What still remains

The dispatcher should always know:

- What has been ordered
- What has arrived
- What has a problem
- What is actually ready
- What has been scheduled
- What has been picked up
- What remains outstanding
- Which shop-stock items may need to be reordered

StageVerify should remain:

- Fast to load
- Easy to understand
- Mobile-friendly
- Secure without unnecessary friction
- Accurate under retries and concurrent use
- Clear about what is ready, scheduled, picked up, or still outstanding
