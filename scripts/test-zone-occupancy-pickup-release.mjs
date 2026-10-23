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

{
  // 5) Prod 6169474 PO 2205 EARLY: picked_up VDO, no shop receipt, planned S1-E
  const s1e = {
    id: "zone-s1e",
    code: "S1-E",
    label: "Shelf 1 — E",
    type: "shelf",
    status: "Active",
    mapLayoutSlot: "S1-E",
  };
  const g11 = {
    id: "zone-g11",
    code: "G11",
    label: "G11",
    type: "ground",
    status: "Active",
    mapLayoutSlot: "G11",
  };
  const early = {
    id: "delivery-vii-2205-early",
    orderNumber: "6169474",
    status: "picked_up",
    readinessStatus: "picked_up",
    updatedAt: now,
    invoiceFulfillmentMethod: "delivery",
    invoiceImportStatus: "pending",
    vendorInvoiceImportId: "vii-2205-early",
    vendorName: "Johnstone Supply",
    jobId: "job-6169474",
    stagingLocationId: "",
    additionalStagingLocationIds: [],
    plannedStagingLocationIds: ["zone-s1e"],
    physicalDropoffComplete: false,
  };
  const truck = {
    id: "delivery-vii-truck-stock",
    orderNumber: "6169474",
    status: "arrived",
    updatedAt: now,
    invoiceFulfillmentMethod: "delivery",
    invoiceImportStatus: "pending",
    vendorInvoiceImportId: "vii-truck-stock",
    vendorName: "Johnstone Supply",
    jobId: "job-6169474",
    stagingLocationId: "",
    plannedStagingLocationIds: ["zone-g11"],
    physicalDropoffComplete: false,
  };
  const painted = computeZoneOccupancyByCode(
    [...locations, s1e, g11],
    [early, truck],
    "authoritative",
  );
  assert.equal(painted.S1E?.deliveryId, "delivery-vii-2205-early");
  assert.equal(painted.S1E?.plannedOnly, true);
  assert.equal(resolveSpotColor("S1-E", painted, {}), "orange");
  assert.equal(painted.G11?.deliveryId, "delivery-vii-truck-stock");
  assert.equal(resolveSpotColor("G11", painted, {}), "orange");
  pass("two-delivery job: picked_up VDO no-receipt paints S1-E; sibling arrived paints G11");

  const leftoverPickup = {
    ...early,
    physicalDropoffComplete: true,
  };
  const leftoverPaint = computeZoneOccupancyByCode(
    [...locations, s1e, g11],
    [leftoverPickup, truck],
    "authoritative",
  );
  assert.equal(leftoverPaint.S1E, undefined);
  assert.equal(resolveSpotColor("S1-E", leftoverPaint, {}), "green");
  assert.equal(leftoverPaint.G11?.deliveryId, "delivery-vii-truck-stock");
  pass("real shop pickup leftover (physicalDropoffComplete true) does not paint S1-E");
}

{
  // 6) Inactive spot + duplicate code/mapLayoutSlot
  const active = {
    id: "zone-s1e-active",
    code: "S1-E",
    label: "Shelf 1 — E",
    type: "shelf",
    status: "Active",
    mapLayoutSlot: "S1-E",
  };
  const inactive = {
    id: "zone-s1e-inactive",
    code: "S1-E",
    label: "Shelf 1 — E (old)",
    type: "shelf",
    status: "Inactive",
    mapLayoutSlot: "S1-E",
  };
  const onInactive = {
    id: "delivery-inactive-ref",
    orderNumber: "DUP-1",
    status: "arrived",
    updatedAt: now,
    invoiceFulfillmentMethod: "delivery",
    vendorInvoiceImportId: "vii-dup-1",
    vendorName: "Vendor",
    jobId: "job-dup",
    stagingLocationId: "zone-s1e-inactive",
    plannedStagingLocationIds: [],
  };
  const onActive = {
    ...onInactive,
    id: "delivery-active-ref",
    stagingLocationId: "zone-s1e-active",
  };
  const inactivePaint = computeZoneOccupancyByCode(
    [active, inactive],
    [onInactive],
    "authoritative",
  );
  assert.equal(inactivePaint.S1E, undefined);
  pass("assignment to inactive duplicate S1-E does not paint the map tile");

  const activePaint = computeZoneOccupancyByCode(
    [active, inactive],
    [onActive],
    "authoritative",
  );
  assert.equal(activePaint.S1E?.deliveryId, "delivery-active-ref");
  pass("assignment to Active S1-E paints despite inactive duplicate code/slot");
}

{
  const early = {
    id: "delivery-vii-2205-early",
    orderNumber: "6169474",
    status: "picked_up",
    invoiceFulfillmentMethod: "delivery",
    invoiceImportStatus: "pending",
    vendorInvoiceImportId: "vii-2205-early",
    stagingLocationId: "",
    plannedStagingLocationIds: ["zone-s1e"],
    physicalDropoffComplete: false,
  };
  const blocked = buildGloballyAssignedStagingLocationIds([early], "other");
  assert.equal(blocked.has("zone-s1e"), true);
  pass("double-book guard holds S1-E for picked_up VDO no-receipt assignment");
}

console.log(`\n${passed} passed`);
