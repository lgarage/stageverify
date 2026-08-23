/**
 * Lock visible map slot → canonical stagingLocations id resolution
 * and assign-mode occupancy vs board occupancy.
 */
import assert from "node:assert/strict";

const {
  resolveStagingLocationForLayoutSlot,
  indexZonesByLayoutKey,
} = await import("../src/dispatcher/resolveStagingLocationForSlot.ts");
const { computeZoneOccupancyByCode } = await import(
  "../src/dispatcher/zoneOccupancyCompute.ts"
);
const { resolveSpotColor } = await import("../src/dispatcher/resolveSpotColor.ts");
const { MAP_SLOT_PLACEHOLDER_ID_PREFIX } = await import(
  "../src/dispatcher/stagingMapSync.ts"
);

const now = new Date().toISOString();

function loc(id, code, patch = {}) {
  return {
    id,
    code,
    label: code,
    type: code.startsWith("G") ? "ground" : "shelf",
    status: "Active",
    mapLayoutSlot: code,
    ...patch,
  };
}

{
  const zones = [
    loc("loc-g2", "G2"),
    loc("loc-s1l", "S1-L", { mapLayoutSlot: "S1L" }),
    loc("loc-s2l", "S2-L"),
    loc("loc-s2k", "S2-K", { mapLayoutSlot: "S2-K" }),
    {
      id: `${MAP_SLOT_PLACEHOLDER_ID_PREFIX}S1L`,
      code: "S1-L",
      label: "placeholder",
      type: "shelf",
      status: "Planned",
      mapLayoutSlot: "S1-L",
    },
  ];

  assert.equal(resolveStagingLocationForLayoutSlot(zones, "G2")?.id, "loc-g2");
  assert.equal(resolveStagingLocationForLayoutSlot(zones, "S1-L")?.id, "loc-s1l");
  assert.equal(resolveStagingLocationForLayoutSlot(zones, "S1L")?.id, "loc-s1l");
  assert.equal(resolveStagingLocationForLayoutSlot(zones, "S2-L")?.id, "loc-s2l");
  assert.equal(resolveStagingLocationForLayoutSlot(zones, "S2K")?.id, "loc-s2k");
  assert.equal(
    resolveStagingLocationForLayoutSlot(zones, "S9-Z"),
    undefined,
    "missing geometry slot has no canonical record",
  );
  const indexed = indexZonesByLayoutKey(zones);
  assert.equal(indexed.S1L.id, "loc-s1l");
  assert.notEqual(indexed.S1L.id.startsWith(MAP_SLOT_PLACEHOLDER_ID_PREFIX), true);
  console.log("PASS: G / hyphenated S slots resolve to canonical Firestore ids");
}

{
  const stale = loc("stale-s1l", "S1-A", {
    status: "Planned",
    mapLayoutSlot: "S1-L",
  });
  const real = loc("real-s1l", "S1-L", { mapLayoutSlot: "S1-L" });
  const zones = [stale, real];
  assert.equal(
    resolveStagingLocationForLayoutSlot(zones, "S1-L")?.id,
    "real-s1l",
    "Active mapLayoutSlot match wins over inactive duplicate",
  );
  console.log("PASS: duplicate layout keys prefer Active canonical record");
}

{
  const locations = [loc("loc-g2", "G2"), loc("loc-s2l", "S2-L")];
  const seedOccupant = {
    id: "delivery-1",
    orderNumber: "ORD-001",
    status: "arrived",
    updatedAt: now,
    stagingLocationId: "loc-g2",
    plannedStagingLocationIds: ["loc-g2"],
  };
  const willCallOccupant = {
    id: "delivery-will-call",
    orderNumber: "WC-1",
    status: "arrived",
    updatedAt: now,
    invoiceFulfillmentMethod: "will_call_pickup",
    invoiceImportStatus: "pickup_at_vendor",
    createdFromInvoiceImport: true,
    vendorInvoiceImportId: "vii-wc",
    plannedStagingLocationIds: ["loc-s2l"],
  };
  const noInvoiceOccupant = {
    id: "delivery-unplanned",
    orderNumber: "UNP-1",
    status: "arrived",
    updatedAt: now,
    plannedStagingLocationIds: ["loc-s2l"],
  };

  const board = computeZoneOccupancyByCode(locations, [
    seedOccupant,
    willCallOccupant,
    noInvoiceOccupant,
  ]);
  const auth = computeZoneOccupancyByCode(
    locations,
    [seedOccupant, willCallOccupant, noInvoiceOccupant],
    "authoritative",
  );

  // board mode skips will-call leftovers; unplanned still paints in non-prod
  assert.equal(board.S2L?.deliveryId, "delivery-unplanned");
  assert.equal(auth.G2?.deliveryId, "delivery-1");
  assert.equal(auth.S2L?.deliveryId, "delivery-will-call");
  assert.equal(resolveSpotColor("G2", auth, {}), "orange");
  assert.equal(resolveSpotColor("S2-L", auth, {}), "orange");
  console.log("PASS: authoritative occupancy paints occupants Confirm would reject");
}

{
  const locations = [loc("loc-g2", "G2")];
  const cleared = {
    id: "delivery-picked",
    orderNumber: "PU-1",
    status: "picked_up",
    updatedAt: now,
    plannedStagingLocationIds: ["loc-g2"],
    stagingLocationId: "loc-g2",
  };
  const auth = computeZoneOccupancyByCode(locations, [cleared], "authoritative");
  assert.equal(auth.G2, undefined);
  assert.equal(resolveSpotColor("G2", auth, {}), "green");
  console.log("PASS: picked_up occupants do not block authoritative availability");
}

console.log("\nstaging-location-assign-resolve: all passed");
