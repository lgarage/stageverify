/**
 * Staging assignment save guards — finished deliveries write nothing;
 * occupied planned spots are refused.
 */
import assert from "node:assert/strict";
import {
  ALREADY_PICKED_UP_STAGING_MESSAGE,
  StagingLocationOccupiedError,
  activeOccupancyLocationIds,
  assertDeliveryAcceptsStagingAssignment,
  buildGloballyAssignedStagingLocationIds,
} from "../src/dispatcher/stagingOccupancy.ts";

let passed = 0;
function pass(msg) {
  passed += 1;
  console.log(`PASS: ${msg}`);
}

function expectThrow(label, fn, message) {
  try {
    fn();
    throw new Error(`${label} did not throw`);
  } catch (err) {
    assert.equal(err instanceof Error ? err.message : "", message);
    pass(label);
  }
}

expectThrow(
  "picked_up save refused",
  () => assertDeliveryAcceptsStagingAssignment({ status: "picked_up" }),
  ALREADY_PICKED_UP_STAGING_MESSAGE,
);
expectThrow(
  "complete save refused",
  () => assertDeliveryAcceptsStagingAssignment({ status: "complete" }),
  ALREADY_PICKED_UP_STAGING_MESSAGE,
);
expectThrow(
  "installed save refused",
  () => assertDeliveryAcceptsStagingAssignment({ status: "installed" }),
  ALREADY_PICKED_UP_STAGING_MESSAGE,
);

assert.doesNotThrow(() =>
  assertDeliveryAcceptsStagingAssignment({ status: "arrived" }),
);
pass("arrived delivery may receive a staging assignment");

{
  const picked = {
    id: "d-picked",
    status: "picked_up",
    stagingLocationId: "",
    plannedStagingLocationIds: ["loc-s1e"],
    pickedUpStagingLocationIds: ["loc-g5"],
  };
  assert.deepEqual(activeOccupancyLocationIds(picked), []);
  const blocked = buildGloballyAssignedStagingLocationIds([picked], "other");
  assert.equal(blocked.has("loc-s1e"), false);
  assert.equal(blocked.has("loc-g5"), false);
  pass("finished delivery write-guard + occupancy skip leftover planned");
}

{
  const occupant = {
    id: "d-occ",
    status: "arrived",
    stagingLocationId: "",
    plannedStagingLocationIds: ["loc-g11"],
  };
  const blocked = buildGloballyAssignedStagingLocationIds([occupant], "assigning");
  assert.equal(blocked.has("loc-g11"), true);
  const err = new StagingLocationOccupiedError("G11", "6169474");
  assert.match(err.message, /G11/);
  assert.equal(err.locationCode, "G11");
  pass("planned save onto an occupied spot is refused");
}

{
  const picked = {
    id: "d-done",
    status: "picked_up",
    stagingLocationId: "loc-g5",
    pickedUpStagingLocationIds: ["loc-g5"],
  };
  const next = {
    id: "d-next",
    status: "pending",
    stagingLocationId: "",
    plannedStagingLocationIds: [],
  };
  const blocked = buildGloballyAssignedStagingLocationIds(
    [picked, next],
    next.id,
  );
  assert.equal(blocked.has("loc-g5"), false);
  pass("guard occupancy treats picked-up history as free");
}

console.log(`\n${passed} passed`);
