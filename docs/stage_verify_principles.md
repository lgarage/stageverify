# StageVerify Core Principles

## Mission

Ensure technicians and installers leave the shop with the correct materials needed to successfully complete the job.

The goal is to catch material problems before technicians leave the shop, not after they arrive at the job site.

---

StageVerify Non-Goals

StageVerify is not:

- An ERP system
- An accounting system
- A purchasing system
- A warehouse management system
- A dispatch platform
- An inventory management system

StageVerify exists to:

- Manage material readiness
- Direct deliveries to correct staging locations
- Verify technician pickup
- Surface material issues early
- Route material issues to the correct owner
- Learn from delivery and pickup outcomes

## Primary Workflow

Customer Approves Work

↓

PO Sent To Vendor

↓

Dispatcher Assigns Staging Location

↓

Vendor Emails Updates

↓

StageVerify Monitors Vendor Emails

↓

Ready / Not Ready Determination

↓

E-Tag Updated

↓

Technician Pickup

↓

Issue Resolution

↓

Historical Learning

---

## Guiding Principle

StageVerify should reduce administrative work.

If information already exists somewhere else:

- BuildOps
- Vendor emails
- Packing slips
- Delivery confirmations
- Technician verification

StageVerify should consume that information instead of requiring manual entry.

Humans manage exceptions.

StageVerify manages routine workflow.

---

## Status Definitions

Ordering

- PO sent to vendor.
- Waiting on vendor activity.

Not Ready

- Backordered items exist.
- Partial shipment exists.
- Open material issue exists.
- Order cannot be successfully executed.

Ready For Pickup

- Vendor indicates all required materials have been delivered.
- No known open issues.

Picked Up

- Technician confirms pickup.

---

## Technician Workflow

Technicians should only be shown orders that are Ready For Pickup.

Technicians should not need to determine whether orders are ready.

StageVerify should already know that.

Technician receives:

Customer
Address
Job #
PO #
Pickup Location

Example:

Oshkosh Middle School

PO: 12334456

Location: G2

Ready For Pickup

Technician scans QR code.

StageVerify displays:

Expected Materials

Shop Stock Pick List

Technician verifies materials.

If everything is present:

Picked Up

If something is wrong:

- Missing Material
- Wrong Material
- Damaged Material

Issue is created automatically.

---

## Material Owner Concept

Every job has a Material Owner.

Examples:

- Dispatcher
- Project Manager
- Lead Technician
- Service Manager

The Material Owner is responsible for resolving material issues.

The technician identifies problems.

The Material Owner determines the solution.

---

## Material Issue Resolution

StageVerify should close the loop on material problems.

Technicians report issues.

Material Owners resolve them.

Preferred resolution actions:

- Found in Shop
- Pick Up at Supply House
- Vendor Will Redeliver
- Use Substitute
- Transfer From Another Shop
- Continue Without It
- Hold Job / Not Ready
- Other

Each resolution should require only the minimum information needed.

Example:

Resolution:
Pick Up at Ferguson

Assigned To:
Mike

Address:
Ferguson Green Bay

Status:
Resolved

---

## Vendor Email Monitoring

Vendor emails are the primary automation source.

Examples:

- Order Confirmation
- Backorder Notice
- Partial Shipment
- Delivery Confirmation

StageVerify should monitor vendor emails and automatically update job readiness.

High-confidence matches should be automated.

Uncertain situations should be escalated for review.

---

## Staging Locations

Dispatchers assign staging locations.

AI does not choose staging locations.

Example:

Job:
Oshkosh Middle School

PO:
12334456

Location:
G2

Vendor receives instructions and delivers materials to the assigned location.

---

## AI Learning Principle

AI observes first.

AI suggests second.

AI automates last.

The system should collect data before making recommendations.

AI suggestions require high confidence.

Humans retain final authority.

---

## Future AI Learning Areas

Vendor Performance

- Missing item frequency
- Backorder frequency
- Delivery accuracy

Staging Intelligence

- Spot utilization
- Oversized deliveries
- Overflow events

Part Classification

- Motors
- Belts
- PVC
- Controls
- Filters
- Large Equipment
- Electrical
- Hardware

Material Issue Analytics

- Most common missing items
- Resolution frequency
- Resolution time

Delivery Complexity Scoring

- Estimated space requirements
- Staging recommendations

---

## Success Metric

The technician leaves the shop with everything needed to successfully complete the job.

If StageVerify prevents emergency supply runs, missed materials, return trips, and job-site surprises, it is succeeding.
