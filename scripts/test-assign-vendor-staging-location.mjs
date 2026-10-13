/**
 * Emulator tests for assignVendorStagingLocation CF (vendor session, occupancy).
 * Usage: cd functions && npm run build && cd .. && firebase emulators:exec --only firestore,functions "node scripts/test-assign-vendor-staging-location.mjs"
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { initializeApp } from "firebase/app";
import { doc, getDoc, setDoc, writeBatch } from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";
import {
  seedExpiredVendorSession,
  seedVendorScopedSession,
  seedVendorSession,
  vendorScopedSessionTokenFor,
  vendorSessionTokenFor,
} from "./test-vendor-session-helper.mjs";

const PROJECT_ID = "stageverify-db";
const RULES_PATH = resolve(process.cwd(), "firestore.rules");

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

function codeOf(err) {
  return String(err?.code ?? "");
}

function msgOf(err) {
  return String(err?.message ?? "");
}

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    host: "127.0.0.1",
    port: 8080,
    rules: readFileSync(RULES_PATH, "utf8"),
  },
});

const clientApp = initializeApp({ projectId: PROJECT_ID }, "assign-vendor-staging");
const functions = getFunctions(clientApp, "us-central1");
connectFunctionsEmulator(functions, "127.0.0.1", 5001);
const assignStaging = httpsCallable(functions, "assignVendorStagingLocation");

async function seed(setup) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setup(ctx.firestore());
  });
}

async function readDelivery(id) {
  let data = null;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore(), "deliveries", id));
    data = snap.exists() ? snap.data() : null;
  });
  return data;
}

async function seedLocation(db, id, code, status = "Active") {
  await setDoc(doc(db, "stagingLocations", id), {
    id,
    code,
    label: `Bay ${code}`,
    type: "ground",
    status,
    active: status === "Active",
  });
}

async function seedDelivery(db, id, extra = {}) {
  await setDoc(doc(db, "deliveries", id), {
    id,
    orderNumber: `ORD-${id}`,
    jobId: "job-avsl",
    vendorId: "vendor-avsl",
    status: "arrived",
    stagingLocationId: "",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...extra,
  });
}

const CLEARED_DELIVERY_BASE = {
  jobId: "job-avsl",
  vendorId: "vendor-avsl",
  status: "picked_up",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

/** Seed many ZONE_CLEARED deliveries on one primary staging location (batched). */
async function seedClearedPrimaryOnLocation(db, locationId, count, idPrefix) {
  const CHUNK = 400;
  let written = 0;
  while (written < count) {
    const batch = writeBatch(db);
    const chunkSize = Math.min(CHUNK, count - written);
    for (let i = 0; i < chunkSize; i += 1) {
      const idx = written + i;
      const id = `${idPrefix}-${idx}`;
      batch.set(doc(db, "deliveries", id), {
        ...CLEARED_DELIVERY_BASE,
        id,
        orderNumber: `ORD-${id}`,
        stagingLocationId: locationId,
      });
    }
    await batch.commit();
    written += chunkSize;
  }
}

async function assignPrimary(deliveryId, stagingLocationId) {
  return assignStaging({
    deliveryId,
    sessionToken: vendorSessionTokenFor(deliveryId),
    stagingLocationId,
    mode: "primary",
  });
}

async function assignAdditional(deliveryId, stagingLocationId) {
  return assignStaging({
    deliveryId,
    sessionToken: vendorSessionTokenFor(deliveryId),
    stagingLocationId,
    mode: "additional",
  });
}

console.log("\n=== assignVendorStagingLocation CF ===\n");

// Seed shared locations
await seed(async (db) => {
  await setDoc(doc(db, "appSettings", "config"), {
    vendorDeliveryMode: "exception_only",
  });
  await seedLocation(db, "assign-vendor-staging-location_avsl-loc-free-1", "F1");
  await seedLocation(db, "assign-vendor-staging-location_avsl-loc-free-2", "F2");
  await seedLocation(db, "assign-vendor-staging-location_avsl-loc-conflict", "CF");
  await seedLocation(db, "assign-vendor-staging-location_avsl-loc-planned", "PL");
  await seedLocation(db, "assign-vendor-staging-location_avsl-loc-cleared", "CL");
  await seedLocation(db, "assign-vendor-staging-location_avsl-loc-page", "PG");
  await seedLocation(db, "assign-vendor-staging-location_avsl-loc-cap-over", "CO");
  await seedLocation(db, "assign-vendor-staging-location_avsl-loc-cap-exact", "CE");
});

// 1. Happy path primary
await seed(async (db) => {
  await seedDelivery(db, "assign-vendor-staging-location_avsl-del-happy-primary", { stagingLocationId: "" });
  await seedVendorSession(db, "assign-vendor-staging-location_avsl-del-happy-primary");
});
try {
  const result = await assignPrimary("assign-vendor-staging-location_avsl-del-happy-primary", "assign-vendor-staging-location_avsl-loc-free-1");
  const after = await readDelivery("assign-vendor-staging-location_avsl-del-happy-primary");
  if (
    result.data?.stagingLocationId === "assign-vendor-staging-location_avsl-loc-free-1" &&
    after?.stagingLocationId === "assign-vendor-staging-location_avsl-loc-free-1"
  ) {
    pass("happy path primary — free loc assigned");
  } else {
    fail("happy path primary", JSON.stringify({ d: result.data, after }));
  }
} catch (err) {
  fail("happy path primary", err);
}

// 2. Happy path additional
await seed(async (db) => {
  await seedDelivery(db, "assign-vendor-staging-location_avsl-del-happy-addl", {
    stagingLocationId: "assign-vendor-staging-location_avsl-loc-free-1",
  });
  await seedVendorSession(db, "assign-vendor-staging-location_avsl-del-happy-addl");
});
try {
  const result = await assignAdditional("assign-vendor-staging-location_avsl-del-happy-addl", "assign-vendor-staging-location_avsl-loc-free-2");
  const after = await readDelivery("assign-vendor-staging-location_avsl-del-happy-addl");
  const addl = after?.additionalStagingLocationIds ?? [];
  if (
    result.data?.mode === "additional" &&
    addl.includes("assign-vendor-staging-location_avsl-loc-free-2")
  ) {
    pass("happy path additional — arrayUnion extra loc");
  } else {
    fail("happy path additional", JSON.stringify({ d: result.data, after }));
  }
} catch (err) {
  fail("happy path additional", err);
}

// 3. Conflict actual primary
await seed(async (db) => {
  await seedDelivery(db, "assign-vendor-staging-location_avsl-del-conflict-a", { stagingLocationId: "" });
  await seedDelivery(db, "assign-vendor-staging-location_avsl-del-conflict-b", {
    stagingLocationId: "assign-vendor-staging-location_avsl-loc-conflict",
  });
  await seedVendorSession(db, "assign-vendor-staging-location_avsl-del-conflict-a");
});
try {
  await assignPrimary("assign-vendor-staging-location_avsl-del-conflict-a", "assign-vendor-staging-location_avsl-loc-conflict");
  fail("conflict primary should reject");
} catch (err) {
  const after = await readDelivery("assign-vendor-staging-location_avsl-del-conflict-a");
  if (
    /no longer available/i.test(msgOf(err)) &&
    (after?.stagingLocationId ?? "") === ""
  ) {
    pass("conflict actual primary — A unchanged");
  } else {
    fail("conflict actual primary", err);
  }
}

// 4. Conflict additional on other delivery
await seed(async (db) => {
  await seedDelivery(db, "assign-vendor-staging-location_avsl-del-conflict-addl-a", {
    stagingLocationId: "assign-vendor-staging-location_avsl-loc-free-1",
  });
  await seedDelivery(db, "assign-vendor-staging-location_avsl-del-conflict-addl-b", {
    stagingLocationId: "",
    additionalStagingLocationIds: ["assign-vendor-staging-location_avsl-loc-conflict"],
  });
  await seedVendorSession(db, "assign-vendor-staging-location_avsl-del-conflict-addl-a");
});
try {
  await assignAdditional("assign-vendor-staging-location_avsl-del-conflict-addl-a", "assign-vendor-staging-location_avsl-loc-conflict");
  fail("conflict additional should reject");
} catch (err) {
  const after = await readDelivery("assign-vendor-staging-location_avsl-del-conflict-addl-a");
  const addl = after?.additionalStagingLocationIds ?? [];
  if (
    /no longer available/i.test(msgOf(err)) &&
    !addl.includes("assign-vendor-staging-location_avsl-loc-conflict")
  ) {
    pass("conflict additional — A unchanged");
  } else {
    fail("conflict additional", err);
  }
}

// 5. Conflict planned (THE BUG)
await seed(async (db) => {
  await seedDelivery(db, "assign-vendor-staging-location_avsl-del-conflict-planned-a", { stagingLocationId: "" });
  await seedDelivery(db, "assign-vendor-staging-location_avsl-del-conflict-planned-b", {
    stagingLocationId: "",
    plannedStagingLocationIds: ["assign-vendor-staging-location_avsl-loc-planned"],
  });
  await seedVendorSession(db, "assign-vendor-staging-location_avsl-del-conflict-planned-a");
});
try {
  await assignPrimary("assign-vendor-staging-location_avsl-del-conflict-planned-a", "assign-vendor-staging-location_avsl-loc-planned");
  fail("conflict planned should reject");
} catch (err) {
  const after = await readDelivery("assign-vendor-staging-location_avsl-del-conflict-planned-a");
  if (
    /no longer available/i.test(msgOf(err)) &&
    (after?.stagingLocationId ?? "") === ""
  ) {
    pass("conflict planned only on B — A unchanged");
  } else {
    fail("conflict planned", err);
  }
}

// 6. ZONE_CLEARED — picked_up/installed holder ignored
await seed(async (db) => {
  await seedDelivery(db, "assign-vendor-staging-location_avsl-del-cleared-a", { stagingLocationId: "" });
  await seedDelivery(db, "assign-vendor-staging-location_avsl-del-cleared-b-picked", {
    stagingLocationId: "assign-vendor-staging-location_avsl-loc-cleared",
    status: "picked_up",
  });
  await seedDelivery(db, "assign-vendor-staging-location_avsl-del-cleared-b-installed", {
    stagingLocationId: "assign-vendor-staging-location_avsl-loc-cleared",
    status: "installed",
  });
  await seedVendorSession(db, "assign-vendor-staging-location_avsl-del-cleared-a");
});
try {
  const result = await assignPrimary("assign-vendor-staging-location_avsl-del-cleared-a", "assign-vendor-staging-location_avsl-loc-cleared");
  const after = await readDelivery("assign-vendor-staging-location_avsl-del-cleared-a");
  if (
    result.data?.stagingLocationId === "assign-vendor-staging-location_avsl-loc-cleared" &&
    after?.stagingLocationId === "assign-vendor-staging-location_avsl-loc-cleared"
  ) {
    pass("ZONE_CLEARED — assign succeeds over picked_up/installed holders");
  } else {
    fail("ZONE_CLEARED", JSON.stringify({ d: result.data, after }));
  }
} catch (err) {
  fail("ZONE_CLEARED", err);
}

// 7. Self-reassign no-op
await seed(async (db) => {
  await seedDelivery(db, "assign-vendor-staging-location_avsl-del-self-noop", {
    stagingLocationId: "assign-vendor-staging-location_avsl-loc-free-1",
  });
  await seedVendorSession(db, "assign-vendor-staging-location_avsl-del-self-noop");
});
try {
  const result = await assignPrimary("assign-vendor-staging-location_avsl-del-self-noop", "assign-vendor-staging-location_avsl-loc-free-1");
  const after = await readDelivery("assign-vendor-staging-location_avsl-del-self-noop");
  if (
    result.data?.stagingLocationId === "assign-vendor-staging-location_avsl-loc-free-1" &&
    after?.stagingLocationId === "assign-vendor-staging-location_avsl-loc-free-1"
  ) {
    pass("self-reassign no-op — same primary succeeds");
  } else {
    fail("self-reassign no-op", JSON.stringify({ d: result.data, after }));
  }
} catch (err) {
  fail("self-reassign no-op", err);
}

// 8. picked_up / installed delivery rejects assign
for (const [id, status] of [
  ["assign-vendor-staging-location_avsl-del-picked", "picked_up"],
  ["assign-vendor-staging-location_avsl-del-installed", "installed"],
]) {
  await seed(async (db) => {
    await seedDelivery(db, id, { status, stagingLocationId: "" });
    await seedVendorSession(db, id);
  });
  try {
    await assignPrimary(id, "assign-vendor-staging-location_avsl-loc-free-2");
    fail(`${status} delivery should reject assign`);
  } catch (err) {
    if (
      codeOf(err).includes("failed-precondition") &&
      /no longer active/i.test(msgOf(err))
    ) {
      pass(`${status} delivery rejected`);
    } else {
      fail(`${status} delivery rejected`, err);
    }
  }
}

// 9. Not-found location
await seed(async (db) => {
  await seedDelivery(db, "assign-vendor-staging-location_avsl-del-notfound-loc", { stagingLocationId: "" });
  await seedVendorSession(db, "assign-vendor-staging-location_avsl-del-notfound-loc");
});
try {
  await assignPrimary("assign-vendor-staging-location_avsl-del-notfound-loc", "assign-vendor-staging-location_avsl-loc-missing-xyz");
  fail("missing location should reject");
} catch (err) {
  if (codeOf(err).includes("not-found") || /not found/i.test(msgOf(err))) {
    pass("not-found staging location rejected");
  } else {
    fail("not-found staging location", err);
  }
}

// 10. Clear primary slot (null / empty) — no occupancy check
await seed(async (db) => {
  await seedDelivery(db, "assign-vendor-staging-location_avsl-del-clear-slot", {
    stagingLocationId: "assign-vendor-staging-location_avsl-loc-free-1",
  });
  await seedDelivery(db, "assign-vendor-staging-location_avsl-del-occupies-free-1", {
    stagingLocationId: "assign-vendor-staging-location_avsl-loc-free-1",
  });
  await seedVendorSession(db, "assign-vendor-staging-location_avsl-del-clear-slot");
});
try {
  const result = await assignStaging({
    deliveryId: "assign-vendor-staging-location_avsl-del-clear-slot",
    sessionToken: vendorSessionTokenFor("assign-vendor-staging-location_avsl-del-clear-slot"),
    stagingLocationId: null,
    mode: "primary",
  });
  const after = await readDelivery("assign-vendor-staging-location_avsl-del-clear-slot");
  if (result.data?.stagingLocationId === null && after?.stagingLocationId === "") {
    pass("clear primary slot succeeds without occupancy guard");
  } else {
    fail("clear primary slot", JSON.stringify({ d: result.data, after }));
  }
} catch (err) {
  fail("clear primary slot", err);
}

// 11. Active occupant behind >20 cleared docs (paging)
await seed(async (db) => {
  await seedDelivery(db, "assign-vendor-staging-location_avsl-del-page-src", { stagingLocationId: "" });
  for (let i = 0; i < 22; i += 1) {
    await seedDelivery(db, `assign-vendor-staging-location_avsl-del-cleared-page-${i}`, {
      stagingLocationId: "assign-vendor-staging-location_avsl-loc-page",
      status: "picked_up",
    });
  }
  await seedDelivery(db, "assign-vendor-staging-location_avsl-del-active-behind-page", {
    stagingLocationId: "assign-vendor-staging-location_avsl-loc-page",
    status: "arrived",
  });
  await seedVendorSession(db, "assign-vendor-staging-location_avsl-del-page-src");
});
try {
  await assignPrimary("assign-vendor-staging-location_avsl-del-page-src", "assign-vendor-staging-location_avsl-loc-page");
  fail("active occupant behind cleared page should reject");
} catch (err) {
  const after = await readDelivery("assign-vendor-staging-location_avsl-del-page-src");
  if (
    /no longer available/i.test(msgOf(err)) &&
    (after?.stagingLocationId ?? "") === ""
  ) {
    pass("paging — active occupant behind cleared docs rejects");
  } else {
    fail("paging occupant", err);
  }
}

// 12. Occupancy cap — >25 full pages fails closed (520 cleared)
await seed(async (db) => {
  await seedDelivery(db, "assign-vendor-staging-location_avsl-del-cap-over-src", { stagingLocationId: "" });
  await seedClearedPrimaryOnLocation(
    db,
    "assign-vendor-staging-location_avsl-loc-cap-over",
    520,
    "assign-vendor-staging-location_avsl-del-cap-over-fill",
  );
  await seedVendorSession(db, "assign-vendor-staging-location_avsl-del-cap-over-src");
});
try {
  await assignPrimary(
    "assign-vendor-staging-location_avsl-del-cap-over-src",
    "assign-vendor-staging-location_avsl-loc-cap-over",
  );
  fail("cap over — assign should reject with safety cap");
} catch (err) {
  const after = await readDelivery("assign-vendor-staging-location_avsl-del-cap-over-src");
  if (
    /safety cap/i.test(msgOf(err)) &&
    (after?.stagingLocationId ?? "") === ""
  ) {
    pass("cap over — safety cap rejects, assignee unchanged");
  } else {
    fail("cap over", err);
  }
}

// 13. Occupancy cap — exactly 25 full pages (500 cleared) succeeds
await seed(async (db) => {
  await seedDelivery(db, "assign-vendor-staging-location_avsl-del-cap-exact-src", { stagingLocationId: "" });
  await seedClearedPrimaryOnLocation(
    db,
    "assign-vendor-staging-location_avsl-loc-cap-exact",
    500,
    "assign-vendor-staging-location_avsl-del-cap-exact-fill",
  );
  await seedVendorSession(db, "assign-vendor-staging-location_avsl-del-cap-exact-src");
});
try {
  const result = await assignPrimary(
    "assign-vendor-staging-location_avsl-del-cap-exact-src",
    "assign-vendor-staging-location_avsl-loc-cap-exact",
  );
  const after = await readDelivery("assign-vendor-staging-location_avsl-del-cap-exact-src");
  if (
    result.data?.stagingLocationId === "assign-vendor-staging-location_avsl-loc-cap-exact" &&
    after?.stagingLocationId === "assign-vendor-staging-location_avsl-loc-cap-exact"
  ) {
    pass("cap exact — 500 cleared, assign succeeds without safety cap");
  } else {
    fail("cap exact", JSON.stringify({ d: result.data, after }));
  }
} catch (err) {
  fail("cap exact — should not throw safety cap", err);
}

// 14. No session token
await seed(async (db) => {
  await seedDelivery(db, "assign-vendor-staging-location_avsl-del-no-session", { stagingLocationId: "" });
  await seedVendorSession(db, "assign-vendor-staging-location_avsl-del-no-session");
});
try {
  await assignStaging({
    deliveryId: "assign-vendor-staging-location_avsl-del-no-session",
    stagingLocationId: "assign-vendor-staging-location_avsl-loc-free-1",
    mode: "primary",
  });
  fail("no session should reject");
} catch (err) {
  const after = await readDelivery("assign-vendor-staging-location_avsl-del-no-session");
  if (
    (codeOf(err).includes("invalid-argument") ||
      /invalid session/i.test(msgOf(err))) &&
    (after?.stagingLocationId ?? "") === ""
  ) {
    pass("no session — rejected, delivery unchanged");
  } else {
    fail("no session", err);
  }
}

// 15. Bad vendor token (unknown 64-hex)
await seed(async (db) => {
  await seedDelivery(db, "assign-vendor-staging-location_avsl-del-bad-token", { stagingLocationId: "" });
  await seedVendorSession(db, "assign-vendor-staging-location_avsl-del-bad-token");
});
try {
  await assignStaging({
    deliveryId: "assign-vendor-staging-location_avsl-del-bad-token",
    sessionToken: "a".repeat(64),
    stagingLocationId: "assign-vendor-staging-location_avsl-loc-free-1",
    mode: "primary",
  });
  fail("bad vendor token should reject");
} catch (err) {
  const after = await readDelivery("assign-vendor-staging-location_avsl-del-bad-token");
  if (
    (codeOf(err).includes("permission-denied") ||
      /session expired/i.test(msgOf(err))) &&
    (after?.stagingLocationId ?? "") === ""
  ) {
    pass("bad vendor token — rejected, delivery unchanged");
  } else {
    fail("bad vendor token", err);
  }
}

// 16. Expired vendor session
await seed(async (db) => {
  await seedDelivery(db, "assign-vendor-staging-location_avsl-del-expired", { stagingLocationId: "" });
  await seedExpiredVendorSession(db, "assign-vendor-staging-location_avsl-del-expired");
});
try {
  await assignPrimary(
    "assign-vendor-staging-location_avsl-del-expired",
    "assign-vendor-staging-location_avsl-loc-free-1",
  );
  fail("expired session should reject");
} catch (err) {
  const after = await readDelivery("assign-vendor-staging-location_avsl-del-expired");
  if (
    (codeOf(err).includes("permission-denied") ||
      /session expired/i.test(msgOf(err))) &&
    (after?.stagingLocationId ?? "") === ""
  ) {
    pass("expired vendor session — rejected, delivery unchanged");
  } else {
    fail("expired vendor session", err);
  }
}

// 17. Vendor-scoped session on another vendor's delivery
await seed(async (db) => {
  await seedDelivery(db, "assign-vendor-staging-location_avsl-del-other-vendor", {
    stagingLocationId: "",
    vendorId: "vendor-b",
  });
  await seedVendorScopedSession(db, "vendor-a");
});
try {
  await assignStaging({
    deliveryId: "assign-vendor-staging-location_avsl-del-other-vendor",
    sessionToken: vendorScopedSessionTokenFor("vendor-a"),
    stagingLocationId: "assign-vendor-staging-location_avsl-loc-free-2",
    mode: "primary",
  });
  fail("other vendor delivery should reject");
} catch (err) {
  const after = await readDelivery("assign-vendor-staging-location_avsl-del-other-vendor");
  if (
    (codeOf(err).includes("permission-denied") ||
      /not valid for this delivery/i.test(msgOf(err))) &&
    (after?.stagingLocationId ?? "") === ""
  ) {
    pass("vendor on other vendor delivery — rejected, delivery unchanged");
  } else {
    fail("vendor on other vendor delivery", err);
  }
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
await testEnv.cleanup();
process.exit(failed > 0 ? 1 : 0);
