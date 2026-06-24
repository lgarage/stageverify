# Readiness wiring audit — 2026-06-23

> Archive pointer from `MEMORY.md`. Shipped fixes in away-072/073 + follow-on commits.

## Riverside RCA (line vs unit, partial at qty=0)

- Demo seed **Riverside Medical Center** exposed list/drawer using **line counts** instead of **unit qty sums**.
- **Partial** displayed when **zero units received** — violates readiness model (partial requires anyReceived > 0).
- Fixes: `4cf65a8` unit-based counts + Pending Delivery label; `474f334` / `away-073` client + CF partial gate.

## away-072 drawer hierarchy

- **Issue Summary** panel top (status lines, color-coded issues, collapsible Received Items).
- **Action Required** deduped — high-level blockers + Recommended Actions only.
- Section order: Issue Summary → Action Required → Delivery Basics → Readiness Evidence → Material Issues → Vendor Communications.

## away-073 readiness model

- `partial` only when **anyReceived > 0** (client promotion + `deliveryReadiness` CF).
- List/filter/count must use **computed** readiness (`computeDeliveryDisplayState`), not stale persisted `delivery.status` alone.

## List filter fix (`5ba4e0f`)

- Dispatcher delivery list filter and status chips aligned to computed readiness (wiring audit).
- Demo matrix regression script (`test:demo-matrix`) guards ORD-004 partial seed + filter matrix.

## Stale status audit — top risks

| Risk | Notes |
| ---- | ----- |
| Staging assignment without recalc | Persisted status can lag computed readiness after assign — UI guard in list; CF recalc on assign TBD |
| Pickup portal vs list | Pickup queue uses ready-only filter; list uses broader computed states — intentional but easy to confuse |
| Stale `openBlockingIssueCount` | Live `materialIssues` must override denormalized blocker counts in display helpers |

## Pilot audit headline findings (brief)

- Treat **display helpers** as single source for list + drawer + filters.
- Always verify trio: `verify:delivery-consistency`, `test:readiness-two-source`, `test:demo-matrix` before ship.
- Do not ship partial-at-zero or line-count regressions — both failed pilot spot-checks pre-fix.
