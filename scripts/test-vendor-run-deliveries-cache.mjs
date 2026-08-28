/**
 * Unit tests for vendor run deliveries localStorage cache (display-only).
 * Run: npx tsx scripts/test-vendor-run-deliveries-cache.mjs
 */
import assert from "node:assert/strict";
import {
  clearVendorRunDeliveriesCache,
  fingerprintVendorRunPin,
  LAST_VENDOR_KEY,
  linkVendorRunDeliveriesCachePin,
  readLastVendorRunDeliveriesCache,
  readVendorRunDeliveriesCache,
  readVendorRunDeliveriesCacheForSubmit,
  VENDOR_RUN_DELIVERIES_CACHE_STORAGE,
  VENDOR_RUN_DELIVERIES_CACHE_TTL_MS,
  VENDOR_RUN_DELIVERIES_PIN_ALIAS_PREFIX,
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
  key(index) {
    return [...store.keys()][index] ?? null;
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
const vendorIdB = "vendor-cache-test-b";
const stagingCode = "G2";
const pin = "9876";

store.clear();
assert.equal(VENDOR_RUN_DELIVERIES_CACHE_STORAGE, "localStorage");
assert.equal(VENDOR_RUN_DELIVERIES_CACHE_TTL_MS, 24 * 60 * 60_000);

assert.equal(readVendorRunDeliveriesCache(vendorId), null);

const wrote = writeVendorRunDeliveriesCache(vendorId, {
  deliveries: [sampleDelivery],
  scannedStagingLocationCode: stagingCode,
  vendorName: "Johnstone Supply",
});
assert.equal(wrote, true);

const key = `stageverify_vendor_run_list_${vendorId}`;
assert.ok(store.has(key), "cache written to localStorage");
assert.equal(store.get(LAST_VENDOR_KEY), vendorId, "last-vendor key updated");
assert.equal(sessionStorage.length, 0, "sessionStorage not used");

const roundTrip = readVendorRunDeliveriesCache(vendorId);
assert.ok(roundTrip);
assert.equal(roundTrip.scannedStagingLocationCode, stagingCode);
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

const lastVendor = readLastVendorRunDeliveriesCache();
assert.ok(lastVendor);
assert.equal(lastVendor.vendorId, vendorId);
assert.equal(lastVendor.deliveries.length, 1);

const fingerprint = await fingerprintVendorRunPin(pin, stagingCode);
assert.match(fingerprint, /^[0-9a-f]{64}$/, "pin fingerprint is SHA-256 hex");

linkVendorRunDeliveriesCachePin(fingerprint, vendorId);
assert.equal(
  store.get(`${VENDOR_RUN_DELIVERIES_PIN_ALIAS_PREFIX}${fingerprint}`),
  vendorId,
);

writeVendorRunDeliveriesCache(vendorIdB, {
  deliveries: [
    {
      ...sampleDelivery,
      deliveryId: "d-cache-b",
      jobName: "Other Vendor Job",
    },
  ],
  scannedStagingLocationCode: stagingCode,
  vendorName: "Other Vendor",
});
assert.equal(store.get(LAST_VENDOR_KEY), vendorIdB, "last-vendor follows latest write");

const forSubmitPinAlias = await readVendorRunDeliveriesCacheForSubmit({
  pin,
  stagingLocationCode: stagingCode,
});
assert.ok(forSubmitPinAlias);
assert.equal(
  forSubmitPinAlias.vendorId,
  vendorId,
  "ForSubmit prefers pin alias over last vendor",
);
assert.equal(forSubmitPinAlias.deliveries[0].deliveryId, "d-cache-1");

store.delete(`${VENDOR_RUN_DELIVERIES_PIN_ALIAS_PREFIX}${fingerprint}`);
const forSubmitLastVendor = await readVendorRunDeliveriesCacheForSubmit({
  pin: "0000",
  stagingLocationCode: stagingCode,
});
assert.ok(forSubmitLastVendor);
assert.equal(
  forSubmitLastVendor.vendorId,
  vendorIdB,
  "ForSubmit falls back to last vendor when pin alias missing",
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
    scannedStagingLocationCode: stagingCode,
    cachedAt: Date.now() - VENDOR_RUN_DELIVERIES_CACHE_TTL_MS - 1,
  }),
);
assert.equal(readVendorRunDeliveriesCache(vendorId), null, "TTL expiry");
assert.equal(store.has(key), false, "expired entry removed");
assert.equal(readLastVendorRunDeliveriesCache()?.vendorId, vendorIdB);

clearVendorRunDeliveriesCache(vendorId);
writeVendorRunDeliveriesCache(vendorId, {
  deliveries: [sampleDelivery],
  scannedStagingLocationCode: stagingCode,
});
assert.ok(readVendorRunDeliveriesCache(vendorId));
clearVendorRunDeliveriesCache(vendorId);
assert.equal(readVendorRunDeliveriesCache(vendorId), null);

let setCalls = 0;
const originalSetItem = localStorage.setItem.bind(localStorage);
localStorage.setItem = (k, v) => {
  setCalls += 1;
  if (k.startsWith("stageverify_vendor_run_list_") && setCalls === 2) {
    throw new Error("QuotaExceededError");
  }
  originalSetItem(k, v);
};
const retried = writeVendorRunDeliveriesCache("vendor-retry", {
  deliveries: [sampleDelivery],
  scannedStagingLocationCode: stagingCode,
});
assert.equal(retried, true);
assert.equal(setCalls, 3, "write retries once with empty items after last-vendor key");
const retryRead = readVendorRunDeliveriesCache("vendor-retry");
assert.ok(retryRead);
assert.deepEqual(retryRead.deliveries[0].items, []);

// Legacy scan: list key only — no LAST_VENDOR_KEY or pin alias
store.clear();
const legacyVendorId = "vendor-legacy";
const legacyKey = `stageverify_vendor_run_list_${legacyVendorId}`;
const legacyCachedAt = Date.now() - 60_000;
store.set(
  legacyKey,
  JSON.stringify({
    deliveries: [sampleDelivery],
    scannedStagingLocationCode: stagingCode,
    vendorName: "Legacy Vendor",
    cachedAt: legacyCachedAt,
  }),
);
assert.equal(store.has(LAST_VENDOR_KEY), false, "legacy fixture has no last-vendor key");

const legacyForSubmit = await readVendorRunDeliveriesCacheForSubmit({
  pin: "1111",
  stagingLocationCode: stagingCode,
});
assert.ok(legacyForSubmit, "ForSubmit finds legacy list cache without last-vendor or pin alias");
assert.equal(legacyForSubmit.vendorId, legacyVendorId);
assert.equal(legacyForSubmit.deliveries[0].deliveryId, "d-cache-1");
assert.equal(
  store.get(LAST_VENDOR_KEY),
  legacyVendorId,
  "legacy scan migrates LAST_VENDOR_KEY",
);

// Newest cachedAt wins among legacy keys
store.delete(LAST_VENDOR_KEY);
const olderVendorId = "vendor-legacy-older";
const newerVendorId = "vendor-legacy-newer";
store.set(
  `stageverify_vendor_run_list_${olderVendorId}`,
  JSON.stringify({
    deliveries: [{ ...sampleDelivery, deliveryId: "d-older", jobName: "Older Job" }],
    scannedStagingLocationCode: stagingCode,
    cachedAt: Date.now() - 120_000,
  }),
);
store.set(
  `stageverify_vendor_run_list_${newerVendorId}`,
  JSON.stringify({
    deliveries: [{ ...sampleDelivery, deliveryId: "d-newer", jobName: "Newer Job" }],
    scannedStagingLocationCode: stagingCode,
    cachedAt: Date.now() - 30_000,
  }),
);
const newestLegacy = readLastVendorRunDeliveriesCache();
assert.ok(newestLegacy);
assert.equal(newestLegacy.vendorId, newerVendorId, "newest cachedAt wins");
assert.equal(newestLegacy.deliveries[0].deliveryId, "d-newer");

// Expired / invalid legacy keys ignored
store.clear();
store.set(
  `stageverify_vendor_run_list_${legacyVendorId}-expired`,
  JSON.stringify({
    deliveries: [sampleDelivery],
    scannedStagingLocationCode: stagingCode,
    cachedAt: Date.now() - VENDOR_RUN_DELIVERIES_CACHE_TTL_MS - 1,
  }),
);
store.set(
  `stageverify_vendor_run_list_${legacyVendorId}-invalid`,
  JSON.stringify({
    deliveries: [{ deliveryId: "", jobName: "Bad", items: [] }],
    scannedStagingLocationCode: stagingCode,
    cachedAt: Date.now(),
  }),
);
assert.equal(readLastVendorRunDeliveriesCache(), null, "no valid legacy caches");
assert.equal(
  store.has(`stageverify_vendor_run_list_${legacyVendorId}-expired`),
  false,
  "expired legacy removed",
);
assert.equal(
  store.has(`stageverify_vendor_run_list_${legacyVendorId}-invalid`),
  false,
  "invalid legacy removed",
);

console.log("test:vendor-run-deliveries-cache — all assertions passed");
