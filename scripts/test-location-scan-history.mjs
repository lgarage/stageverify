/**
 * Location-scan history helpers: view URLs + hash replace (no extra Back stop).
 * Run: npx tsx scripts/test-location-scan-history.mjs
 */
import assert from "node:assert/strict";
import {
  canonicalLocationScanHash,
  isLeftoverReceiveHash,
  locationScanHistoryHash,
  locationScanHistoryPath,
  locationScanHistoryViewsEqual,
  readLocationScanHistoryView,
  shouldCollapseLeftoverReceiveToLocationScan,
} from "../src/locationScanHistory.ts";

const pin = readLocationScanHistoryView(new URLSearchParams("loc=G2"));
assert.equal(pin.kind, "pin");
assert.equal(locationScanHistoryPath("G2", pin), "/s?loc=G2");

const list = readLocationScanHistoryView(
  new URLSearchParams("loc=G2&view=deliveries"),
);
assert.equal(list.kind, "deliveries");
assert.equal(locationScanHistoryPath("G2", list), "/s?loc=G2&view=deliveries");

const hub = readLocationScanHistoryView(
  new URLSearchParams("loc=G2&view=delivery&d=delivery-1"),
);
assert.deepEqual(hub, { kind: "delivery", deliveryId: "delivery-1" });
assert.equal(
  locationScanHistoryPath("G2", hub),
  "/s?loc=G2&view=delivery&d=delivery-1",
);

assert.equal(
  locationScanHistoryViewsEqual(
    { kind: "delivery", deliveryId: "a" },
    { kind: "delivery", deliveryId: "a" },
  ),
  true,
);
assert.equal(
  locationScanHistoryViewsEqual(
    { kind: "delivery", deliveryId: "a" },
    { kind: "delivery", deliveryId: "b" },
  ),
  false,
);

assert.equal(canonicalLocationScanHash("#/s?l=G2"), "#/s?loc=G2");
assert.equal(
  canonicalLocationScanHash("#/s?loc=G2&view=deliveries"),
  "#/s?loc=G2&view=deliveries",
);
assert.equal(
  canonicalLocationScanHash("#/s?loc=G2&view=delivery&d=delivery-1"),
  locationScanHistoryHash("G2", {
    kind: "delivery",
    deliveryId: "delivery-1",
  }),
);
assert.equal(canonicalLocationScanHash("#/receive?zone=G2"), null);
assert.equal(
  canonicalLocationScanHash("#/s?loc=G1&svdebug=1"),
  "#/s?loc=G1&svdebug=1",
);
assert.equal(
  canonicalLocationScanHash("#/s?loc=G1&foo=bar&svdebug=1"),
  "#/s?loc=G1&svdebug=1",
);
assert.equal(canonicalLocationScanHash("#/s?loc=G1&svdebug=0"), "#/s?loc=G1");
assert.equal(
  locationScanHistoryPath(
    "G1",
    pin,
    new URLSearchParams("loc=G1&svdebug=1"),
  ),
  "/s?loc=G1&svdebug=1",
);

assert.equal(isLeftoverReceiveHash("#/receive"), true);
assert.equal(isLeftoverReceiveHash("#/receive?"), true);
assert.equal(isLeftoverReceiveHash("#/receive?id=delivery-1"), false);
assert.equal(isLeftoverReceiveHash("#/receive?zone=G2"), false);
assert.equal(
  shouldCollapseLeftoverReceiveToLocationScan("#/receive", "#/s?loc=G2"),
  true,
);
assert.equal(
  shouldCollapseLeftoverReceiveToLocationScan(
    "#/receive",
    "#/s?loc=G2&view=deliveries",
  ),
  true,
);
assert.equal(
  shouldCollapseLeftoverReceiveToLocationScan("#/receive?id=d1", "#/s?loc=G2"),
  false,
);

let assignedHash = 0;
let replaceCount = 0;
let currentHash = "#/receive?zone=G2";
globalThis.window = {
  location: {
    get hash() {
      return currentHash;
    },
    set hash(next) {
      assignedHash += 1;
      currentHash = next;
    },
    pathname: "/stageverify/",
    search: "",
  },
  history: {
    state: null,
    replaceState(_state, _title, url) {
      replaceCount += 1;
      const idx = String(url).indexOf("#");
      currentHash = idx >= 0 ? String(url).slice(idx) : "";
    },
  },
  dispatchEvent() {
    return true;
  },
};
const sessionMem = new Map();
globalThis.sessionStorage = {
  getItem(key) {
    return sessionMem.has(key) ? sessionMem.get(key) : null;
  },
  setItem(key, value) {
    sessionMem.set(key, String(value));
  },
  removeItem(key) {
    sessionMem.delete(key);
  },
};

const { replaceAppHash, normalizeReceiveHash, normalizeLocationScanHash } =
  await import("../src/receiveQrUrls.ts");

assert.equal(replaceAppHash("#/s?loc=G2"), true);
assert.equal(currentHash, "#/s?loc=G2");
assert.equal(replaceCount, 1);
assert.equal(assignedHash, 0);
assert.equal(replaceAppHash("#/s?loc=G2"), false);

currentHash = "#/receive?zone=G2";
normalizeReceiveHash();
assert.equal(currentHash, "#/s?loc=G2");
assert.equal(assignedHash, 0, "zone redirect must replace, not assign location.hash");

currentHash = "#/s?l=G1&view=deliveries";
normalizeLocationScanHash();
assert.equal(currentHash, "#/s?loc=G1&view=deliveries");

currentHash = "#/s?loc=G1&svdebug=1";
normalizeLocationScanHash();
assert.equal(currentHash, "#/s?loc=G1&svdebug=1");

console.log("test-location-scan-history: PASS");
