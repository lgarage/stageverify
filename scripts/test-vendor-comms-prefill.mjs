/**
 * Unit tests for vendor comms prefill helpers.
 *   npx tsx scripts/test-vendor-comms-prefill.mjs
 */
import assert from "node:assert/strict";
import {
  mergeVendorIntoList,
  resolveVendorForComms,
} from "../src/dispatcher/drawer/vendorCommsPrefillHelpers.ts";

const portalVendor = {
  id: "vendor-1",
  name: "Johnstone Supply",
  email: "",
  createdAt: "2026-01-01T00:00:00Z",
};

const deliveryVendor = {
  id: "vendor-1",
  name: "Johnstone Supply",
  email: "dispatch@johnstone.com",
  createdAt: "2026-01-01T00:00:00Z",
};

const merged = mergeVendorIntoList([portalVendor], deliveryVendor);
assert.equal(merged.length, 1);
assert.equal(merged[0].email, "dispatch@johnstone.com");

const appended = mergeVendorIntoList([], deliveryVendor);
assert.equal(appended.length, 1);
assert.equal(appended[0].id, "vendor-1");

const resolvedById = resolveVendorForComms({
  vendors: merged,
  initialVendorId: "vendor-1",
  vendorNameHint: "Johnstone Supply",
});
assert.equal(resolvedById?.email, "dispatch@johnstone.com");

const orphanedResolved = resolveVendorForComms({
  vendors: merged,
  initialVendorId: "orphaned-vendor-id",
  vendorNameHint: "Johnstone Supply",
});
assert.equal(orphanedResolved?.id, "vendor-1");

const ambiguous = resolveVendorForComms({
  vendors: [
    { id: "a", name: "Acme", createdAt: "2026-01-01T00:00:00Z" },
    { id: "b", name: "acme", createdAt: "2026-01-01T00:00:00Z" },
  ],
  vendorNameHint: "Acme",
});
assert.equal(ambiguous, null);

console.log("test-vendor-comms-prefill PASS");
