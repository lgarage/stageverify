import assert from "node:assert/strict";
import { reduceVendorCompleteConfirm } from "../src/dispatcher/vendorCompleteConfirm.ts";

assert.deepEqual(
  reduceVendorCompleteConfirm(null, "tap-complete", "delivery-a"),
  { next: "delivery-a" },
);
assert.deepEqual(reduceVendorCompleteConfirm("delivery-a", "cancel"), {
  next: null,
});
assert.deepEqual(reduceVendorCompleteConfirm("delivery-a", "confirm"), {
  next: null,
  fire: "delivery-a",
});
assert.deepEqual(
  reduceVendorCompleteConfirm(null, "tap-complete", "delivery-b", {
    locked: true,
  }),
  { next: null },
);
assert.deepEqual(
  reduceVendorCompleteConfirm("delivery-a", "tap-complete", "delivery-b"),
  { next: "delivery-a" },
);

console.log("PASS: test-vendor-complete-confirm (5 cases)");
