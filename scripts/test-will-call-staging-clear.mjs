/**
 * Pure-logic tests for Will-Call active staging release helper.
 * No Firebase / emulator required.
 */
import assert from "node:assert/strict";
import {
  buildWillCallActiveStagingClearPatch,
  deliveryHasActiveShopStaging,
  WILL_CALL_STAGING_RELEASE_REASON,
} from "../src/dispatcher/willCallStagingRelease.ts";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log(`PASS: ${name}`);
}

const now = "2026-08-09T12:00:00.000Z";

{
  const clear = buildWillCallActiveStagingClearPatch(
    {
      plannedStagingLocationIds: ["loc-g12", "loc-g6"],
      stagingLocationId: "loc-g12",
      additionalStagingLocationIds: ["loc-extra"],
      combinationStagingGroupId: "combo-1",
      combinationMemberLocationIds: ["loc-g15", "loc-g16"],
    },
    { releasedBy: "dispatcher", releasedAt: now },
  );
  assert.deepEqual(clear.fields.plannedStagingLocationIds, []);
  assert.equal(clear.fields.stagingLocationId, "");
  assert.deepEqual(clear.fields.additionalStagingLocationIds, []);
  assert.equal(clear.fields.combinationStagingGroupId, "");
  assert.deepEqual(clear.fields.combinationMemberLocationIds, []);
  assert.equal(clear.releaseEntries.length, 2);
  assert.equal(clear.releaseEntries[0].locationId, "loc-g12");
  assert.equal(clear.releaseEntries[0].reason, WILL_CALL_STAGING_RELEASE_REASON);
  assert.equal(clear.releaseEntries[1].locationId, "loc-g6");
  pass("clears planned + actual + combination; audit for planned ids only");
}

{
  const empty = {
    plannedStagingLocationIds: [],
    stagingLocationId: "",
    additionalStagingLocationIds: [],
  };
  const clear = buildWillCallActiveStagingClearPatch(empty, {
    releasedBy: "dispatcher",
    releasedAt: now,
  });
  assert.equal(clear.releaseEntries.length, 0);
  assert.deepEqual(clear.fields.plannedStagingLocationIds, []);
  assert.equal(deliveryHasActiveShopStaging(empty), false);
  pass("idempotent re-clear when already empty");
}

{
  const withScan = {
    plannedStagingLocationIds: ["loc-g12"],
    stagingLocationId: "loc-g12",
    scannedStagingLocationId: "loc-scan-hist",
    scannedAt: now,
    shopStockLines: [{ id: "ssl-1", description: "pipe" }],
  };
  const clear = buildWillCallActiveStagingClearPatch(withScan, {
    releasedBy: "dispatcher",
    releasedAt: now,
  });
  assert.ok(!("scannedStagingLocationId" in clear.fields));
  assert.ok(!("shopStockLines" in clear.fields));
  assert.equal(withScan.scannedStagingLocationId, "loc-scan-hist");
  assert.equal(deliveryHasActiveShopStaging(withScan), true);
  pass("preserves scannedStagingLocationId / shop-stock (not in clear fields)");
}

{
  // Reverse path simulation: after clear, Drop-Off sees no active staging.
  const afterWillCall = {
    invoiceFulfillmentMethod: "delivery",
    invoiceImportStatus: "pending",
    plannedStagingLocationIds: [],
    stagingLocationId: "",
    additionalStagingLocationIds: [],
    combinationStagingGroupId: "",
    combinationMemberLocationIds: [],
  };
  assert.equal(deliveryHasActiveShopStaging(afterWillCall), false);
  pass("reverse Vendor Drop-Off does not auto-restore prior staging");
}

{
  const { computeZoneOccupancyByCode } = await import(
    "../src/dispatcher/zoneOccupancyCompute.ts"
  );
  const { buildGloballyAssignedStagingLocationIds } = await import(
    "../src/dispatcher/stagingOccupancy.ts"
  );
  const locations = [
    {
      id: "loc-g12",
      code: "G12",
      label: "G12",
      type: "zone",
      status: "Active",
    },
    {
      id: "loc-g6",
      code: "G6",
      label: "G6",
      type: "zone",
      status: "Active",
    },
  ];
  const willCallStale = {
    id: "d-will-call",
    orderNumber: "WC-1",
    status: "pending",
    updatedAt: now,
    invoiceFulfillmentMethod: "will_call_pickup",
    invoiceImportStatus: "pickup_at_vendor",
    vendorInvoiceImportId: "vii-1",
    plannedStagingLocationIds: ["loc-g12"],
    stagingLocationId: "loc-g12",
  };
  const dropOffOther = {
    id: "d-drop-off",
    orderNumber: "DO-1",
    status: "pending",
    updatedAt: now,
    invoiceFulfillmentMethod: "delivery",
    invoiceImportStatus: "pending",
    vendorInvoiceImportId: "vii-2",
    plannedStagingLocationIds: ["loc-g6"],
    stagingLocationId: "",
  };
  const byCode = computeZoneOccupancyByCode(locations, [
    willCallStale,
    dropOffOther,
  ]);
  assert.equal(byCode.G12, undefined, "will-call must not paint G12");
  assert.equal(byCode.G6?.deliveryId, "d-drop-off");
  const blocked = buildGloballyAssignedStagingLocationIds(
    [willCallStale, dropOffOther],
    "d-new",
  );
  assert.equal(blocked.has("loc-g12"), false);
  assert.equal(blocked.has("loc-g6"), true);
  pass("occupancy + global block skip Will-Call; unrelated G6 untouched");
}

console.log(`\n${passed} passed`);
