import assert from "node:assert/strict";

const {
  computeZoneOccupancyByCode,
  countCatchAllAssignedDeliveries,
} = await import("../src/dispatcher/zoneOccupancyCompute.ts");

const now = new Date().toISOString();
const locations = [
  {
    id: "loc-ca-code",
    code: "CA",
    label: "Catch-all",
    type: "ground",
    status: "Active",
  },
  {
    id: "loc-ca-slot",
    code: "INTAKE",
    label: "Catch-all slot",
    type: "ground",
    status: "Active",
    mapLayoutSlot: "CA",
  },
  {
    id: "loc-ca-configured",
    code: "PARCEL",
    label: "Configured catch-all",
    type: "ground",
    status: "Active",
  },
  {
    id: "loc-g10",
    code: "G10",
    label: "G10",
    type: "ground",
    status: "Active",
    mapLayoutSlot: "G10",
  },
];

function delivery(id, patch = {}) {
  return {
    id,
    orderNumber: `ORDER-${id}`,
    vendorId: "vendor-1",
    deliveryDate: "2026-08-23",
    status: "arrived",
    createdAt: now,
    updatedAt: now,
    vendorInvoiceImportId: `vii-${id}`,
    invoiceFulfillmentMethod: "delivery",
    ...patch,
  };
}

const count = (deliveries) =>
  countCatchAllAssignedDeliveries(
    locations,
    deliveries,
    "loc-ca-configured",
  );

assert.equal(
  count([delivery("non-ca", { stagingLocationId: "loc-g10" })]),
  0,
  "zero relevant CA deliveries",
);

assert.equal(
  count([delivery("actual-one", { stagingLocationId: "loc-ca-code" })]),
  1,
  "one actual CA delivery",
);

assert.equal(
  count([
    delivery("planned-only", {
      plannedStagingLocationIds: ["loc-ca-code"],
    }),
  ]),
  1,
  "planned-only CA assignment counts as one delivery",
);

{
  const moving = delivery("moving", { stagingLocationId: "loc-g10" });
  assert.equal(count([moving]), 0, "before assign into CA → 0");
  const intoCa = {
    ...moving,
    stagingLocationId: "loc-ca-code",
    updatedAt: now,
  };
  assert.equal(count([intoCa]), 1, "after assign into CA → 1");
  const outOfCa = {
    ...intoCa,
    stagingLocationId: "loc-g10",
    plannedStagingLocationIds: [],
    updatedAt: now,
  };
  assert.equal(count([outOfCa]), 0, "after assign out of CA → 0");
}

assert.equal(
  count([
    delivery("actual-code", { stagingLocationId: "loc-ca-code" }),
    delivery("actual-slot", { stagingLocationId: "loc-ca-slot" }),
    delivery("actual-configured", {
      stagingLocationId: "loc-ca-configured",
    }),
  ]),
  3,
  "three actual CA deliveries across code, map slot, and configured id",
);

const actualAndPlanned = delivery("actual-and-planned", {
  stagingLocationId: "loc-ca-code",
  plannedStagingLocationIds: ["loc-ca-code"],
});
assert.equal(
  count([actualAndPlanned, { ...actualAndPlanned }]),
  1,
  "same delivery planned and actual CA counts once by delivery id",
);

for (const status of ["picked_up", "complete", "installed"]) {
  assert.equal(
    count([
      delivery(`cleared-${status}`, {
        status,
        stagingLocationId: "loc-ca-code",
      }),
    ]),
    0,
    `${status} CA delivery is excluded`,
  );
}

assert.equal(
  count([
    delivery("will-call", {
      stagingLocationId: "loc-ca-code",
      invoiceFulfillmentMethod: "will_call_pickup",
      invoiceImportStatus: "pickup_at_vendor",
    }),
  ]),
  0,
  "skipsShopStaging / will-call delivery is excluded",
);

assert.equal(
  count([
    delivery("qty-five", {
      stagingLocationId: "loc-ca-code",
      expectedMaterials: [
        { id: "item-1", description: "Five widgets", qty: 5 },
      ],
    }),
  ]),
  1,
  "item quantity five still counts as one delivery",
);

const caDelivery = delivery("ca-independent", {
  stagingLocationId: "loc-ca-code",
});
const g10Delivery = delivery("g10-independent", {
  stagingLocationId: "loc-g10",
});
assert.equal(count([caDelivery, g10Delivery]), 1);
assert.equal(
  computeZoneOccupancyByCode(locations, [caDelivery, g10Delivery]).G10
    ?.deliveryId,
  "g10-independent",
  "G10 occupancy still paints independently from Catch-all count",
);

const incrementCounterLookingSettings = {
  catchAllPendingCheckInCount: 99,
};
assert.equal(
  count([caDelivery]),
  1,
  `settings increment counter ${incrementCounterLookingSettings.catchAllPendingCheckInCount} is not an input to the helper`,
);

console.log("PASS: 0 relevant CA deliveries → 0");
console.log("PASS: actual CA deliveries count uniquely (1 and 3)");
console.log("PASS: planned + actual same delivery → 1");
console.log("PASS: picked_up / complete / installed excluded");
console.log("PASS: skipsShopStaging / will-call excluded");
console.log("PASS: item quantity does not inflate delivery count");
console.log("PASS: G10 occupancy paints independently");
console.log("PASS: increment-counter-looking settings field is irrelevant");
