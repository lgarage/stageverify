import assert from "node:assert/strict";
import { resolveSpotColor } from "../src/dispatcher/resolveSpotColor.ts";

const occ = (partial) => ({
  orderNumber: "1",
  vendorName: "V",
  jobId: "j",
  status: "arrived",
  readyForPickup: false,
  plannedOnly: false,
  ...partial,
});

const occupancy = {
  G1: occ({ deliveryId: "d1", readyForPickup: true }),
  G2: occ({ deliveryId: "d2", readyForPickup: false }),
};
const shop = {
  G2: {
    id: "s1",
    stockItemLabel: "Pipe",
    locationCode: "G2",
    qtyAvailable: 1,
    qtyAssigned: 0,
    qtyPickedUp: 0,
    active: true,
    createdAt: "",
    updatedAt: "",
  },
  G3: {
    id: "s2",
    stockItemLabel: "Valve",
    locationCode: "G3",
    qtyAvailable: 1,
    qtyAssigned: 0,
    qtyPickedUp: 0,
    active: true,
    createdAt: "",
    updatedAt: "",
  },
};

assert.equal(resolveSpotColor("G1", occupancy, shop), "red");
assert.equal(resolveSpotColor("G2", occupancy, shop), "orange");
assert.equal(resolveSpotColor("G3", occupancy, shop), "gray");
assert.equal(resolveSpotColor("G4", occupancy, shop), "green");
console.log("PASS: test-resolve-spot-color");
