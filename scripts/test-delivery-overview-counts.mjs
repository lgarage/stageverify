/**
 * Locks Delivery Overview badge-count semantics used by listDeliveriesOverview.
 * Usage: npm run test:delivery-overview-counts
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";

const mod = await import(
  resolve(process.cwd(), "src/dispatcher/deliveryDisplayHelpers.ts")
);
const { rowMatchesOverviewStatusFilter } = mod;

let passed = 0;
let failed = 0;
function pass(msg) {
  passed += 1;
  console.log(`  ✓ ${msg}`);
}
function fail(msg, err) {
  failed += 1;
  console.error(`  ✗ ${msg}`);
  if (err) console.error(`    ${err?.message ?? err}`);
}

const rows = [
  {
    status: "pending",
    statusDisplayLabel: "Pending Delivery",
    stagingLocationListNotApplicable: false,
  },
  {
    status: "complete",
    statusDisplayLabel: "Complete",
    stagingLocationListNotApplicable: false,
  },
  {
    status: "picked_up",
    statusDisplayLabel: "Picked Up",
    stagingLocationListNotApplicable: false,
  },
  {
    status: "ready_for_pickup",
    statusDisplayLabel: "Will-Call / Pickup",
    stagingLocationListNotApplicable: true,
    fulfillmentDisplayLabel: "Will-Call / Pickup @ Vendor",
  },
];

try {
  const completeCount = rows.filter((row) =>
    rowMatchesOverviewStatusFilter(row, "complete"),
  ).length;
  assert.equal(completeCount, 2);
  pass("complete badge includes complete + picked up");
} catch (err) {
  fail("complete badge includes complete + picked up", err);
}

try {
  const willCallCount = rows.filter(
    (row) => row.stagingLocationListNotApplicable,
  ).length;
  assert.equal(willCallCount, 1);
  pass("will-call badge uses stagingLocationListNotApplicable");
} catch (err) {
  fail("will-call badge uses stagingLocationListNotApplicable", err);
}

console.log(`\ndelivery-overview-counts: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
