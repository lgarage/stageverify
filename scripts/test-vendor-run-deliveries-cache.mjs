/**
 * Unit tests for vendor run deliveries localStorage cache (display-only).
 * Run: npx tsx scripts/test-vendor-run-deliveries-cache.mjs
 */
import assert from "node:assert/strict";
import {
  clearVendorRunDeliveriesCache,
  readVendorRunDeliveriesCache,
  VENDOR_RUN_DELIVERIES_CACHE_STORAGE,
  VENDOR_RUN_DELIVERIES_CACHE_TTL_MS,
  writeVendorRunDeliveriesCache,
} from "../src/vendorRunDeliveriesCache.ts";

const store = new Map();

globalThis.localStorage = {
  getItem(key) {
    return store.has(key) ? store.get(key) ?? null : null;
  },
  setItem(key, value) {
    store.set(key, value);
  },
  removeItem(key) {
    store.delete(key);
  },
  clear() {
    store.clear();
  },
  key() {
    return null;
  },
  get length() {
    return store.size;
  },
};

globalThis.sessionStorage = {
  getItem() {
    return null;
  },
  setItem() {
    throw new Error("sessionStorage must not be used for vendor run cache");
  },
  removeItem() {},
  clear() {},
  key() {
    return null;
  },
  get length() {
    return 0;
  },
};

const sampleDelivery = {
  deliveryId: "d-cache-1",
  jobId: "job-1",
  jobName: "Riverside Medical",
  orderNumber: "ORD-1",
  vendorInvoiceNumber: "INV-1",
  poNumber: "PO-1",
  stagingLocationCodes: ["G2"],
  hasAssignableSpot: true,
  vendorPhysicalDropoffConfirmed: false,
  vendorPhysicalDropoffConfirmedAt: "2026-08-24T12:00:00.000Z",
  status: "open",
  items: [
    {
      id: "item-1",
      description: "Air handler",
      qtyOrdered: 2,
      qtyReceived: 0,
      qtyBackordered: 0,
      status: "pending",
    },
  ],
  extraUnknownField: "drop-me",
};

const vendorId = "vendor-cache-test";

store.clear();
assert.equal(VENDOR_RUN_DELIVERIES_CACHE_STORAGE, "localStorage");
assert.equal(VENDOR_RUN_DELIVERIES_CACHE_TTL_MS, 24 * 60 * 60_000);

assert.equal(readVendorRunDeliveriesCache(vendorId), null);

const wrote = writeVendorRunDeliveriesCache(vendorId, {
  deliveries: [sampleDelivery],
  scannedStagingLocationCode: "G2",
  vendorName: "Johnstone Supply",
});
assert.equal(wrote, true);

const key = `stageverify_vendor_run_list_${vendorId}`;
assert.ok(store.has(key), "cache written to localStorage");
assert.equal(sessionStorage.length, 0, "sessionStorage not used");

const roundTrip = readVendorRunDeliveriesCache(vendorId);
assert.ok(roundTrip);
assert.equal(roundTrip.scannedStagingLocationCode, "G2");
assert.equal(roundTrip.vendorName, "Johnstone Supply");
assert.equal(roundTrip.deliveries.length, 1);
assert.equal(roundTrip.deliveries[0].deliveryId, "d-cache-1");
assert.equal(roundTrip.deliveries[0].jobName, "Riverside Medical");
assert.equal(roundTrip.deliveries[0].items[0].description, "Air handler");
assert.equal(
  roundTrip.deliveries[0].extraUnknownField,
  undefined,
  "unknown delivery fields stripped on write",
);

const rawPayload = JSON.parse(store.get(key) ?? "{}");
assert.equal(rawPayload.cachedAt > 0, true);
assert.equal(rawPayload.deliveries[0].extraUnknownField, undefined);

store.set(
  key,
  JSON.stringify({
    deliveries: [{ deliveryId: "", jobName: "Bad", items: [] }],
    scannedStagingLocationCode: "G1",
    cachedAt: Date.now(),
  }),
);
assert.equal(readVendorRunDeliveriesCache(vendorId), null, "reject empty deliveryId");
assert.equal(store.has(key), false, "garbage entry removed");

store.set(
  key,
  JSON.stringify({
    deliveries: [{ deliveryId: "x", jobName: "", items: [] }],
    scannedStagingLocationCode: "G1",
    cachedAt: Date.now(),
  }),
);
assert.equal(readVendorRunDeliveriesCache(vendorId), null, "reject empty jobName");

store.set(
  key,
  JSON.stringify({
    deliveries: [sampleDelivery],
    scannedStagingLocationCode: "G2",
    cachedAt: Date.now() - VENDOR_RUN_DELIVERIES_CACHE_TTL_MS - 1,
  }),
);
assert.equal(readVendorRunDeliveriesCache(vendorId), null, "TTL expiry");
assert.equal(store.has(key), false, "expired entry removed");

clearVendorRunDeliveriesCache(vendorId);
writeVendorRunDeliveriesCache(vendorId, {
  deliveries: [sampleDelivery],
  scannedStagingLocationCode: "G2",
});
assert.ok(readVendorRunDeliveriesCache(vendorId));
clearVendorRunDeliveriesCache(vendorId);
assert.equal(readVendorRunDeliveriesCache(vendorId), null);

let setCalls = 0;
const originalSetItem = localStorage.setItem.bind(localStorage);
localStorage.setItem = (k, v) => {
  setCalls += 1;
  if (setCalls === 1) {
    throw new Error("QuotaExceededError");
  }
  originalSetItem(k, v);
};
const retried = writeVendorRunDeliveriesCache("vendor-retry", {
  deliveries: [sampleDelivery],
  scannedStagingLocationCode: "G2",
});
assert.equal(retried, true);
assert.equal(setCalls, 2, "write retries once with empty items");
const retryRead = readVendorRunDeliveriesCache("vendor-retry");
assert.ok(retryRead);
assert.deepEqual(retryRead.deliveries[0].items, []);

console.log("test:vendor-run-deliveries-cache — all assertions passed");
