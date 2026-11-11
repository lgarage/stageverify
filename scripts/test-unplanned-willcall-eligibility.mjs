/**
 * Offline eligibility / occupancy for jobless unplanned pickup and clear.
 * Usage: npm run test:unplanned-willcall-eligibility
 */

import assert from "node:assert/strict";
import {
  isJoblessUnplannedClearEligible,
  isJoblessUnplannedDelivery,
  isJoblessUnplannedPickupEligible,
} from "../src/dispatcher/unplannedWillCallEligibility.ts";
import { isDispatcherPickupEligible } from "../src/dispatcher/readiness.ts";
import { activeOccupancyLocationIds } from "../src/dispatcher/stagingOccupancy.ts";
import { VALID_TRANSITIONS } from "../src/dispatcher/service.ts";
import { ZONE_CLEARED_DELIVERY_STATUSES } from "../src/dispatcher/models.ts";
import { deliveryReadinessDisplayLabel } from "../src/dispatcher/jobReadinessDisplay.ts";
import { computeDeliveryReadiness } from "../src/dispatcher/readiness.ts";

const stagedUnplanned = {
  id: "del-unplanned-staged",
  orderNumber: "UNPL-1",
  unplanned: true,
  status: "pending",
  stagingLocationId: "loc-a",
  additionalStagingLocationIds: [],
  plannedStagingLocationIds: [],
};

assert.equal(isJoblessUnplannedDelivery(stagedUnplanned), true);
assert.equal(isJoblessUnplannedPickupEligible(stagedUnplanned), true);
assert.equal(isJoblessUnplannedClearEligible(stagedUnplanned), true);
assert.equal(
  isDispatcherPickupEligible(stagedUnplanned, []).eligible,
  true,
);
assert.deepEqual(activeOccupancyLocationIds(stagedUnplanned), ["loc-a"]);

const jobLinked = {
  ...stagedUnplanned,
  unplanned: true,
  jobId: "job-1",
};
assert.equal(isJoblessUnplannedDelivery(jobLinked), false);
assert.equal(isJoblessUnplannedPickupEligible(jobLinked), false);

const pickedUp = {
  ...stagedUnplanned,
  status: "picked_up",
  stagingLocationId: "loc-a",
};
assert.equal(isJoblessUnplannedPickupEligible(pickedUp), false);
assert.deepEqual(activeOccupancyLocationIds(pickedUp), []);
assert.equal(ZONE_CLEARED_DELIVERY_STATUSES.has("picked_up"), true);

const cancelled = {
  ...stagedUnplanned,
  status: "cancelled",
  stagingLocationId: "loc-a",
  clearReason: "Wrong truck",
};
assert.equal(isJoblessUnplannedPickupEligible(cancelled), false);
assert.equal(isJoblessUnplannedClearEligible(cancelled), false);
assert.equal(isDispatcherPickupEligible(cancelled, []).eligible, false);
assert.equal(isDispatcherPickupEligible(cancelled, []).reason, "delivery_cancelled");
assert.deepEqual(activeOccupancyLocationIds(cancelled), []);
assert.equal(ZONE_CLEARED_DELIVERY_STATUSES.has("cancelled"), true);
assert.deepEqual(VALID_TRANSITIONS.cancelled, []);
assert.equal(
  deliveryReadinessDisplayLabel(
    cancelled,
    computeDeliveryReadiness(cancelled, []),
    [],
  ),
  "Cancelled",
);

const installed = { ...stagedUnplanned, status: "installed" };
assert.equal(isJoblessUnplannedPickupEligible(installed), false);
assert.deepEqual(activeOccupancyLocationIds(installed), []);

console.log("PASS unplanned will-call eligibility / occupancy");
