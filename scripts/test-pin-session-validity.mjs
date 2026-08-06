/**
 * Asserts client PIN session validity uses token + expiresAt only (no inactivity).
 * Run: npx tsx scripts/test-pin-session-validity.mjs
 */
import assert from "node:assert/strict";
import * as vendor from "../src/vendorPinSession.ts";
import * as tech from "../src/technicianPinSession.ts";
import * as mgmt from "../src/managementPinSession.ts";

const future = new Date(Date.now() + 60 * 60_000).toISOString();
const past = new Date(Date.now() - 60_000).toISOString();

function mockSessionStorage() {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  };
}

mockSessionStorage();

// Vendor delivery session — valid with token + future expiresAt
vendor.setPinSession("d1", "v1", "Vendor A", {
  sessionToken: "tok",
  expiresAt: future,
});
assert.equal(vendor.isPinSessionValid("d1"), true);

// Expired by expiresAt even if stored JSON had stale lastActivityAt
sessionStorage.setItem(
  "sv-vendor-pin:d2",
  JSON.stringify({
    deliveryId: "d2",
    vendorId: "v1",
    vendorName: "Vendor A",
    sessionToken: "tok",
    expiresAt: past,
    lastActivityAt: Date.now(),
  }),
);
assert.equal(vendor.isPinSessionValid("d2"), false);

// Missing token → invalid
sessionStorage.setItem(
  "sv-vendor-pin:d3",
  JSON.stringify({
    deliveryId: "d3",
    vendorId: "v1",
    vendorName: "Vendor A",
    expiresAt: future,
  }),
);
assert.equal(vendor.isPinSessionValid("d3"), false);

// Technician — no inactivity extension
tech.setTechnicianPinSession("tech-1", "Tech One", {
  sessionToken: "ttok",
  expiresAt: future,
  sessionMinutes: 15,
});
assert.equal(tech.isTechnicianPinSessionValid("tech-1"), true);

sessionStorage.setItem(
  "stageverify_technician_pin_session",
  JSON.stringify({
    "tech-old": {
      technicianId: "tech-old",
      technicianName: "Old",
      sessionToken: "ttok",
      expiresAt: future,
      sessionMinutes: 15,
      lastActivityAt: Date.now() - 999_999_999,
    },
  }),
);
assert.equal(tech.isTechnicianPinSessionValid("tech-old"), true);

tech.setTechnicianPinSession("tech-exp", "Exp", {
  sessionToken: "ttok",
  expiresAt: past,
  sessionMinutes: 15,
});
assert.equal(tech.isTechnicianPinSessionValid("tech-exp"), false);

// Management — expiresAt only
mgmt.setManagementPinSession({
  sessionToken: "mtok",
  expiresAt: future,
  sessionMinutes: 30,
});
assert.equal(mgmt.isManagementPinSessionValid(), true);

sessionStorage.setItem(
  "stageverify_management_pin_session",
  JSON.stringify({
    sessionToken: "mtok",
    expiresAt: past,
    sessionMinutes: 30,
    lastActivityAt: Date.now(),
  }),
);
assert.equal(mgmt.isManagementPinSessionValid(), false);

console.log("test-pin-session-validity: PASS");
