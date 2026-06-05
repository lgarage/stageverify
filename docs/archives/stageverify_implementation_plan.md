# StageVerify Implementation Plan

> **ARCHIVED 2026-06-04** — Superseded by `docs/roadmap.md` Phase 2+ deliverables and `docs/project_state.md` phase truth. Kept for historical reference only.


## Project Status

Current Phase: Architecture Validation

Last Verified Milestone:

- Dispatcher Dashboard Operational
- Staging Assignment Operational
- Pickup Workflow Operational
- QR Workflow Operational

Current Focus:
Transition from Staging System to Material Readiness System

Rule:
Do not begin the next phase until the current phase gate passes.

---

# Phase 1 - Stabilize Current Platform

## Goal

Freeze the current working StageVerify platform before major architectural changes.

## Deliverables

- Dispatcher dashboard stable
- Pickup workflow stable
- QR workflow stable
- Staging assignment stable
- Public deployment stable

## Testing

Verify:

- Dashboard loads
- Pickup page loads
- QR routes function
- Staging assignments save correctly
- Deployment works

## Gate

Must pass:

- Build successful
- Public deployment verified
- Manual testing completed
- Git checkpoint created

---

# Phase 2 - Material Readiness Data Model

## Goal

Add new business concepts without major UI changes.

## New Concepts

- Ordering
- Not Ready
- Ready For Pickup
- Picked Up
- Material Owner
- Expected Materials
- Shop Stock Items
- Material Issue
- Issue Resolution
- Vendor Email Event
- AI Confidence Score
- Human Review Required

## Deliverables

- New data structures
- Mock data updated
- Existing UI still operational

## Testing

Verify:

- Existing workflows continue working
- New fields appear correctly
- No broken routes
- No broken builds

## Gate

Must pass:

- Existing functionality preserved
- New structures operational
- Build passes

---

# Phase 3 - Technician Pickup Workflow

## Goal

Convert pickup workflow into material verification workflow.

## Technician View

Displays:

- Customer
- Address
- Job Number
- PO Number
- Pickup Location
- Expected Materials
- Shop Stock Items

## Actions

- Everything Present
- Report Issue

## Testing

Scenario A:

Everything Present

Expected:

- Status becomes Picked Up
- Timestamp recorded
- Technician recorded

Scenario B:

Report Issue

Expected:

- Material Issue created
- Issue appears in dashboard
- Material Owner assigned

## Gate

Must pass:

- Successful pickup workflow
- Successful issue creation
- No manual intervention required

---

# Phase 4 - Material Issue Resolution

## Goal

Close the loop on material problems.

## Resolution Types

- Found In Shop
- Pick Up At Supply House
- Vendor Will Redeliver
- Use Substitute
- Transfer From Another Shop
- Continue Without It
- Hold Job Not Ready
- Other

## Deliverables

Material Owner can:

- Open issue
- Select resolution
- Submit resolution

Technician can:

- View resolution

## Testing

Verify:

Issue Created

↓

Issue Assigned

↓

Issue Resolved

↓

Issue Closed

Test all resolution types.

## Gate

Must pass:

- End-to-end issue workflow operational
- Resolution history stored
- Status updates correctly

---

# Phase 5 - Vendor Email Parsing Prototype

## Goal

Teach StageVerify to understand vendor communications.

## Scope

No live email integration.

Use sample emails only.

## Extract

- Vendor
- PO Number
- Customer
- Delivered Items
- Missing Items
- Backordered Items
- Delivery Status

## Confidence Levels

High Confidence

- Automatic processing allowed

Low Confidence

- Human review required

## Testing

Use real samples from:

- Johnstone
- Ferguson
- First Supply

## Gate

Must pass:

- 95% extraction accuracy
- Low-confidence items routed to review

---

# Phase 6 - Vendor Email Monitoring

## Goal

Automate vendor communication processing.

## Deliverables

Monitor:

- Delivery confirmations
- Backorder notices
- Partial shipment notices
- Order confirmations

## Workflow

Vendor Email

↓

StageVerify Processes

↓

Readiness Updated

↓

Pickup Status Updated

## Testing

Verify:

- Complete delivery
- Partial shipment
- Backorder
- Unknown PO

## Gate

Must pass:

- No false Ready For Pickup events
- Unknown emails routed to review

---

# Phase 7 - E-Tag Automation

## Goal

Automatically update Minew tags.

## Deliverables

Tag displays:

- Job Name
- PO Number
- Assigned Location

StageVerify updates tags automatically.

## Testing

Verify:

Location Change

↓

Tag Updates

Ready For Pickup

↓

Tag Updates

Picked Up

↓

Tag Updates

## Gate

Must pass:

- Tag state matches StageVerify state
- No manual updates required

---

# Phase 8 - AI Learning & Correction Engine

## Goal

Create a controlled learning system.

The objective is not to make Gemini smarter.

The objective is to make StageVerify smarter.

## Core Principle

AI interpretations are never the source of truth.

Source of truth:

- Vendor emails
- Packing slips
- Delivery confirmations
- PO records
- Human-reviewed corrections

AI acts as an interpreter.

## Learning Workflow

Vendor Email Arrives

↓

AI Parses Email

↓

Confidence Score Assigned

↓

High Confidence

Automatic Processing

OR

Low Confidence

Human Review

↓

Human Correction

↓

Correction Stored

↓

Future Similar Cases Reference Historical Corrections

↓

Improved Accuracy

## Deliverables

### Vendor Knowledge Base

Store vendor-specific terminology.

Examples:

Johnstone

- Qty B/O = Backordered

Ferguson

- Open Qty = Remaining Quantity

First Supply

- Short Ship = Not Delivered

### Human Correction Database

Store:

- Original interpretation
- Human correction
- Reason
- Vendor
- Timestamp

### Confidence Tracking

Track:

- Parsing accuracy
- Correction frequency
- Human review rate
- Vendor accuracy

### Rule Generation

Repeated corrections create reusable rules.

Example:

Qty B/O > 0

↓

Not Ready

### Known Exception Library

Track:

- Unknown PO
- Missing packing slip
- Multi-job delivery
- Partial shipment
- Vendor format changes

## Testing

Test 1

Same mistake should not repeat.

Test 2

Vendor terminology retained.

Test 3

Confidence reduced for repeated mistakes.

Test 4

Rules automatically created from repeated corrections.

## Success Criteria

- 95% parsing accuracy
- No repeated known mistakes
- Vendor knowledge retained
- Corrections reusable

## Gate

Must pass:

- Stable correction storage
- Stable vendor knowledge base
- Stable confidence scoring
- Demonstrated learning from corrections

---

# Phase 9 - AI Recommendations

## Goal

Allow AI to recommend actions.

AI never owns decisions.

Humans retain authority.

## Potential Recommendations

- Staging location suggestions
- Delivery complexity scoring
- Vendor risk indicators
- Material issue recommendations

## Requirements

Minimum confidence:

90%

Recommendation must include:

- Confidence score
- Supporting history
- Explanation

## Testing

Track:

- Acceptance rate
- Override rate
- Accuracy rate

## Gate

Must pass:

- Recommendations explainable
- Human overrides logged
- Recommendations can be disabled

---

# AI Learning Principle

AI Observes First.

AI Suggests Second.

AI Automates Last.

Humans Own Decisions.

---

# Success Metric

The technician leaves the shop with everything required to successfully complete the job.

If StageVerify reduces:

- Missing materials
- Emergency supply runs
- Return trips
- Job delays
- Material confusion

Then StageVerify is succeeding.
