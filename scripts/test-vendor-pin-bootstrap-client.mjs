/**
 * Client helper + PIN UX contract tests (no emulator).
 * Usage: npm run test:vendor-pin-bootstrap-client
 */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const { deliveryDetailsFromVendorPinBootstrap } = await import(
  pathToFileURL(
    resolve(process.cwd(), "src/dispatcher/vendorPinBootstrap.ts"),
  ).href
);
const { shouldReinitItemQtys } = await import(
  pathToFileURL(resolve(process.cwd(), "src/dispatcher/itemQtyInit.ts")).href
);

let passed = 0;
let failed = 0;
function pass(msg) {
  passed += 1;
  console.log(`  ✓ ${msg}`);
}
function fail(msg, err) {
  failed += 1;
  console.error(`  ✗ ${msg}`);
  if (err) console.error(`    ${err?.message ?? err}`);
}

const bootstrap = {
  deliveryId: "d1",
  orderNumber: "ORD-1",
  vendorInvoiceNumber: "INV-1",
  status: "shipped",
  invoiceFulfillmentMethod: "delivery",
  vendorId: "v1",
  vendorName: "Vendor Co",
  jobId: "j1",
  jobName: "Site A",
  purchaseOrderId: "p1",
  poNumber: "PO-1",
  stagingLocationId: "s1",
  stagingLocationCode: "A1",
  plannedStagingLocationIds: ["s1"],
  itemCount: 3,
  deliveryDate: "2026-08-01",
};

try {
  const details = deliveryDetailsFromVendorPinBootstrap(bootstrap);
  assert.equal(details.delivery.id, "d1");
  assert.equal(details.delivery.orderNumber, "ORD-1");
  assert.equal(details.vendor.name, "Vendor Co");
  assert.equal(details.job?.jobName, "Site A");
  assert.equal(details.stagingLocation?.code, "A1");
  assert.equal(details.purchaseOrder?.poNumber, "PO-1");
  assert.equal(details.items.length, 0);
  assert.equal(details.statusHistory.length, 0);
  pass("bootstrap → DeliveryDetails shell (empty items)");
} catch (err) {
  fail("bootstrap → DeliveryDetails shell (empty items)", err);
}

try {
  const details = deliveryDetailsFromVendorPinBootstrap({
    ...bootstrap,
    status: "not-a-real-status",
  });
  assert.equal(details.delivery.status, "pending");
  pass("unknown status falls back to pending");
} catch (err) {
  fail("unknown status falls back to pending", err);
}

// PIN length UX contract (mirrors VendorPinGate constants)
const MIN = 4;
const MAX = 6;
function canVerify(len, locked = false) {
  return len >= MIN && len <= MAX && !locked;
}
function autoSubmit(len) {
  return len === MAX;
}

try {
  assert.equal(canVerify(3), false);
  assert.equal(canVerify(4), true);
  assert.equal(canVerify(5), true);
  assert.equal(canVerify(6), true);
  assert.equal(autoSubmit(4), false);
  assert.equal(autoSubmit(5), false);
  assert.equal(autoSubmit(6), true);
  pass("4/5 enable Verify; only 6 auto-submits (no length oracle)");
} catch (err) {
  fail("4/5 enable Verify; only 6 auto-submits (no length oracle)", err);
}

try {
  assert.equal(shouldReinitItemQtys(null, "d1", 0), true);
  assert.equal(shouldReinitItemQtys({ deliveryId: "d1", itemCount: 0 }, "d1", 0), false);
  assert.equal(shouldReinitItemQtys({ deliveryId: "d1", itemCount: 0 }, "d1", 3), true);
  assert.equal(shouldReinitItemQtys({ deliveryId: "d1", itemCount: 3 }, "d1", 3), false);
  assert.equal(shouldReinitItemQtys({ deliveryId: "d1", itemCount: 3 }, "d2", 2), true);
  pass("shell→hydrate re-inits itemQtys; same-id with items does not clobber");
} catch (err) {
  fail("shell→hydrate re-inits itemQtys; same-id with items does not clobber", err);
}

console.log(
  `\nvendor-pin-bootstrap-client: ${passed} passed, ${failed} failed`,
);
if (failed > 0) process.exit(1);
