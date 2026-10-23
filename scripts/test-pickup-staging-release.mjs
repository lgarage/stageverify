/**
 * Pure pickup staging release — history kept, picked spots leave live fields.
 */
import assert from "node:assert/strict";
import { buildPickupLiveStagingPatch } from "../functions/src/pickupStagingRelease.ts";

let passed = 0;
function pass(msg) {
  passed += 1;
  console.log(`PASS: ${msg}`);
}

{
  const delivery = {
    stagingLocationId: "loc-g5",
    additionalStagingLocationIds: ["loc-g11"],
    plannedStagingLocationIds: ["loc-g5"],
    combinationStagingGroupId: "combo-1",
    combinationMemberLocationIds: ["loc-g5", "loc-combo"],
  };
  const partial = buildPickupLiveStagingPatch(delivery, ["loc-g5"], false);
  assert.equal(partial.stagingLocationId, "");
  assert.deepEqual(partial.additionalStagingLocationIds, ["loc-g11"]);
  assert.deepEqual(partial.plannedStagingLocationIds, []);
  assert.deepEqual(partial.combinationMemberLocationIds, ["loc-combo"]);
  assert.equal(partial.combinationStagingGroupId, "combo-1");
  assert.deepEqual(partial.pickedUpStagingLocationIds, ["loc-g5"]);
  pass("partial pickup keeps leftover spots and records G5 history");
}

{
  const delivery = {
    stagingLocationId: "loc-g5",
    additionalStagingLocationIds: [],
    plannedStagingLocationIds: ["loc-g5"],
    combinationStagingGroupId: "combo-1",
    combinationMemberLocationIds: ["loc-g5"],
  };
  const full = buildPickupLiveStagingPatch(delivery, ["loc-g5"], true);
  assert.equal(full.stagingLocationId, "");
  assert.deepEqual(full.additionalStagingLocationIds, []);
  assert.deepEqual(full.plannedStagingLocationIds, []);
  assert.equal(full.combinationStagingGroupId, "");
  assert.deepEqual(full.combinationMemberLocationIds, []);
  assert.deepEqual(full.pickedUpStagingLocationIds, ["loc-g5"]);
  pass("full pickup clears live fields and preserves picked-up history");
}

{
  const immediate = buildPickupLiveStagingPatch(
    {
      stagingLocationId: "",
      plannedStagingLocationIds: [],
    },
    ["loc-g5"],
    true,
  );
  assert.deepEqual(immediate.pickedUpStagingLocationIds, ["loc-g5"]);
  pass("immediate full pickup keeps prior picked-up history");
}

console.log(`\n${passed} passed`);
