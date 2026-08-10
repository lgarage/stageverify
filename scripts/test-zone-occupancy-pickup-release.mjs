/**
 * Regression: after Complete Pickup / picked_up, shop map occupancy must
 * release planned + actual staging (incl. vendorInvoiceImport-linked rows).
 *
 * Why prior D-82 probes missed map failures: prod board filter drops rows
 * without vendorInvoiceImportId, and CF field clears alone do not prove map paint.
 */
import assert from "node:assert/strict";

let passed = 0;
function pass(msg) {
  passed += 1;
  console.log(`PASS: ${msg}`);
}

const now = new Date().toISOString();
const locations = [
  {
    id: "loc-g10",
    code: "G10",
    label: "G10",
    type: "ground",
    status: "Active",
    mapLayoutSlot: "G10",
  },
  {
    id: "loc-g6",
    code: "G6",
    label: "G6",
    type: "ground",
    status: "Active",
    mapLayoutSlot: "G6",
  },
  {
    id: "loc-g12",
    code: "G12",
    label: "G12",
    type: "ground",
    status: "Active",
    mapLayoutSlot: "G12",
  },
];

const { computeZoneOccupancyByCode } = await import(
  "../src/dispatcher/zoneOccupancyCompute.ts"
);
const { buildGloballyAssignedStagingLocationIds } = await import(
  "../src/dispatcher/stagingOccupancy.ts"
);
const { resolveSpotColor } = await import(
  "../src/dispatcher/resolveSpotColor.ts"
);

{
  // 1) Planned-only Assigned/Planned VDO (Dan-shaped) paints, then picked_up frees.
  const before = {
    id: "delivery-vii-page-1",
    orderNumber: "6169414",
    status: "arrived",
    updatedAt: now,
    invoiceFulfillmentMethod: "delivery",
    invoiceImportStatus: "pending",
    vendorInvoiceImportId: "vii-19fe2a7af7632590-page-1",
    vendorName: "Johnstone Supply",
    jobId: "job-1",
    stagingLocationId: "",
    additionalStagingLocationIds: [],
    plannedStagingLocationIds: ["loc-g10"],
  };
  const painted = computeZoneOccupancyByCode(locations, [before]);
  assert.equal(painted.G10?.deliveryId, "delivery-vii-page-1");
  assert.equal(painted.G10?.plannedOnly, true);
  assert.equal(resolveSpotColor("G10", painted, {}), "orange");
  pass("planned-only vii VDO paints Assigned/Planned (orange) on G10");

  const afterPickup = {
    ...before,
    status: "picked_up",
    readinessStatus: "picked_up",
    stagingLocationId: "",
    additionalStagingLocationIds: [],
    plannedStagingLocationIds: [],
    combinationMemberLocationIds: [],
    updatedAt: new Date(Date.now() + 1000).toISOString(),
  };
  const cleared = computeZoneOccupancyByCode(locations, [afterPickup]);
  assert.equal(cleared.G10, undefined);
  assert.equal(resolveSpotColor("G10", cleared, {}), "green");
  pass("picked_up + cleared planned → G10 free (green)");
}

{
  // 2) Actual stagingLocationId released on picked_up
  const staged = {
    id: "delivery-vii-actual",
    orderNumber: "ACT-1",
    status: "ready_for_pickup",
    updatedAt: now,
    invoiceFulfillmentMethod: "delivery",
    vendorInvoiceImportId: "vii-actual",
    vendorName: "Vendor",
    jobId: "job-a",
    stagingLocationId: "loc-g6",
    additionalStagingLocationIds: ["loc-g12"],
    plannedStagingLocationIds: ["loc-g6"],
  };
  const painted = computeZoneOccupancyByCode(locations, [staged]);
  assert.equal(painted.G6?.deliveryId, "delivery-vii-actual");
  assert.equal(painted.G12?.deliveryId, "delivery-vii-actual");
  const after = {
    ...staged,
    status: "picked_up",
    stagingLocationId: "",
    additionalStagingLocationIds: [],
    plannedStagingLocationIds: [],
  };
  const cleared = computeZoneOccupancyByCode(locations, [after]);
  assert.equal(cleared.G6, undefined);
  assert.equal(cleared.G12, undefined);
  pass("actual + additional staging release on picked_up");
}

{
  // 3) Stale planned left on picked_up must still not paint (ZONE_CLEARED)
  const stale = {
    id: "delivery-vii-stale",
    orderNumber: "STALE-1",
    status: "picked_up",
    updatedAt: now,
    invoiceFulfillmentMethod: "delivery",
    vendorInvoiceImportId: "vii-stale",
    stagingLocationId: "loc-g10",
    plannedStagingLocationIds: ["loc-g10", "loc-g6"],
  };
  const byCode = computeZoneOccupancyByCode(locations, [stale]);
  assert.equal(byCode.G10, undefined);
  assert.equal(byCode.G6, undefined);
  const blocked = buildGloballyAssignedStagingLocationIds([stale], "other");
  assert.equal(blocked.has("loc-g10"), false);
  assert.equal(blocked.has("loc-g6"), false);
  pass("ZONE_CLEARED skips stale planned/actual on picked_up");
}

{
  // 4) Sibling delivery must not keep spot when one page is picked_up
  const page1Picked = {
    id: "delivery-vii-p1",
    orderNumber: "6169414",
    status: "picked_up",
    updatedAt: now,
    invoiceFulfillmentMethod: "delivery",
    vendorInvoiceImportId: "vii-p1",
    stagingLocationId: "",
    plannedStagingLocationIds: [],
  };
  const page2Active = {
    id: "delivery-vii-p2",
    orderNumber: "6169474",
    status: "arrived",
    updatedAt: now,
    invoiceFulfillmentMethod: "delivery",
    vendorInvoiceImportId: "vii-p2",
    stagingLocationId: "",
    plannedStagingLocationIds: ["loc-g6"],
  };
  const byCode = computeZoneOccupancyByCode(locations, [
    page1Picked,
    page2Active,
  ]);
  assert.equal(byCode.G10, undefined);
  assert.equal(byCode.G6?.deliveryId, "delivery-vii-p2");
  pass("sibling page pickup does not free unrelated sibling planned spot");
}

console.log(`\n${passed} passed`);
