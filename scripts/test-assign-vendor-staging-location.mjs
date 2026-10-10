/**
 * Emulator tests for assignVendorStagingLocation CF (vendor session, occupancy).
 * Usage: cd functions && npm run build && cd .. && firebase emulators:exec --only firestore,functions "node scripts/test-assign-vendor-staging-location.mjs"
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { initializeApp } from "firebase/app";
import { doc, getDoc, setDoc } from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";
import {
  seedVendorSession,
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
  await seedLocation(db, "avsl-loc-free-1", "F1");
  await seedLocation(db, "avsl-loc-free-2", "F2");
  await seedLocation(db, "avsl-loc-conflict", "CF");
  await seedLocation(db, "avsl-loc-planned", "PL");
  await seedLocation(db, "avsl-loc-cleared", "CL");
  await seedLocation(db, "avsl-loc-page", "PG");
});

// 1. Happy path primary
await seed(async (db) => {
  await seedDelivery(db, "avsl-del-happy-primary", { stagingLocationId: "" });
  await seedVendorSession(db, "avsl-del-happy-primary");
});
try {
  const result = await assignPrimary("avsl-del-happy-primary", "avsl-loc-free-1");
  const after = await readDelivery("avsl-del-happy-primary");
  if (
    result.data?.stagingLocationId === "avsl-loc-free-1" &&
    after?.stagingLocationId === "avsl-loc-free-1"
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
  await seedDelivery(db, "avsl-del-happy-addl", {
    stagingLocationId: "avsl-loc-free-1",
  });
  await seedVendorSession(db, "avsl-del-happy-addl");
});
try {
  const result = await assignAdditional("avsl-del-happy-addl", "avsl-loc-free-2");
  const after = await readDelivery("avsl-del-happy-addl");
  const addl = after?.additionalStagingLocationIds ?? [];
  if (
    result.data?.mode === "additional" &&
    addl.includes("avsl-loc-free-2")
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
  await seedDelivery(db, "avsl-del-conflict-a", { stagingLocationId: "" });
  await seedDelivery(db, "avsl-del-conflict-b", {
    stagingLocationId: "avsl-loc-conflict",
  });
  await seedVendorSession(db, "avsl-del-conflict-a");
});
try {
  await assignPrimary("avsl-del-conflict-a", "avsl-loc-conflict");
  fail("conflict primary should reject");
} catch (err) {
  const after = await readDelivery("avsl-del-conflict-a");
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
  await seedDelivery(db, "avsl-del-conflict-addl-a", {
    stagingLocationId: "avsl-loc-free-1",
  });
  await seedDelivery(db, "avsl-del-conflict-addl-b", {
    stagingLocationId: "",
    additionalStagingLocationIds: ["avsl-loc-conflict"],
  });
  await seedVendorSession(db, "avsl-del-conflict-addl-a");
});
try {
  await assignAdditional("avsl-del-conflict-addl-a", "avsl-loc-conflict");
  fail("conflict additional should reject");
} catch (err) {
  const after = await readDelivery("avsl-del-conflict-addl-a");
  const addl = after?.additionalStagingLocationIds ?? [];
  if (
    /no longer available/i.test(msgOf(err)) &&
    !addl.includes("avsl-loc-conflict")
  ) {
    pass("conflict additional — A unchanged");
  } else {
    fail("conflict additional", err);
  }
}

// 5. Conflict planned (THE BUG)
await seed(async (db) => {
  await seedDelivery(db, "avsl-del-conflict-planned-a", { stagingLocationId: "" });
  await seedDelivery(db, "avsl-del-conflict-planned-b", {
    stagingLocationId: "",
    plannedStagingLocationIds: ["avsl-loc-planned"],
  });
  await seedVendorSession(db, "avsl-del-conflict-planned-a");
});
try {
  await assignPrimary("avsl-del-conflict-planned-a", "avsl-loc-planned");
  fail("conflict planned should reject");
} catch (err) {
  const after = await readDelivery("avsl-del-conflict-planned-a");
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
  await seedDelivery(db, "avsl-del-cleared-a", { stagingLocationId: "" });
  await seedDelivery(db, "avsl-del-cleared-b-picked", {
    stagingLocationId: "avsl-loc-cleared",
    status: "picked_up",
  });
  await seedDelivery(db, "avsl-del-cleared-b-installed", {
    stagingLocationId: "avsl-loc-cleared",
    status: "installed",
  });
  await seedVendorSession(db, "avsl-del-cleared-a");
});
try {
  const result = await assignPrimary("avsl-del-cleared-a", "avsl-loc-cleared");
  const after = await readDelivery("avsl-del-cleared-a");
  if (
    result.data?.stagingLocationId === "avsl-loc-cleared" &&
    after?.stagingLocationId === "avsl-loc-cleared"
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
  await seedDelivery(db, "avsl-del-self-noop", {
    stagingLocationId: "avsl-loc-free-1",
  });
  await seedVendorSession(db, "avsl-del-self-noop");
});
try {
  const result = await assignPrimary("avsl-del-self-noop", "avsl-loc-free-1");
  const after = await readDelivery("avsl-del-self-noop");
  if (
    result.data?.stagingLocationId === "avsl-loc-free-1" &&
    after?.stagingLocationId === "avsl-loc-free-1"
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
  ["avsl-del-picked", "picked_up"],
  ["avsl-del-installed", "installed"],
]) {
  await seed(async (db) => {
    await seedDelivery(db, id, { status, stagingLocationId: "" });
    await seedVendorSession(db, id);
  });
  try {
    await assignPrimary(id, "avsl-loc-free-2");
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
  await seedDelivery(db, "avsl-del-notfound-loc", { stagingLocationId: "" });
  await seedVendorSession(db, "avsl-del-notfound-loc");
});
try {
  await assignPrimary("avsl-del-notfound-loc", "avsl-loc-missing-xyz");
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
  await seedDelivery(db, "avsl-del-clear-slot", {
    stagingLocationId: "avsl-loc-free-1",
  });
  await seedDelivery(db, "avsl-del-occupies-free-1", {
    stagingLocationId: "avsl-loc-free-1",
  });
  await seedVendorSession(db, "avsl-del-clear-slot");
});
try {
  const result = await assignStaging({
    deliveryId: "avsl-del-clear-slot",
    sessionToken: vendorSessionTokenFor("avsl-del-clear-slot"),
    stagingLocationId: null,
    mode: "primary",
  });
  const after = await readDelivery("avsl-del-clear-slot");
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
  await seedDelivery(db, "avsl-del-page-src", { stagingLocationId: "" });
  for (let i = 0; i < 22; i += 1) {
    await seedDelivery(db, `avsl-del-cleared-page-${i}`, {
      stagingLocationId: "avsl-loc-page",
      status: "picked_up",
    });
  }
  await seedDelivery(db, "avsl-del-active-behind-page", {
    stagingLocationId: "avsl-loc-page",
    status: "arrived",
  });
  await seedVendorSession(db, "avsl-del-page-src");
});
try {
  await assignPrimary("avsl-del-page-src", "avsl-loc-page");
  fail("active occupant behind cleared page should reject");
} catch (err) {
  const after = await readDelivery("avsl-del-page-src");
  if (
    /no longer available/i.test(msgOf(err)) &&
    (after?.stagingLocationId ?? "") === ""
  ) {
    pass("paging — active occupant behind cleared docs rejects");
  } else {
    fail("paging occupant", err);
  }
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
await testEnv.cleanup();
process.exit(failed > 0 ? 1 : 0);
