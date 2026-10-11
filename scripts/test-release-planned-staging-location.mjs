/**
 * Emulator tests for releasePlannedStagingLocation CF (vendor session, occupancy).
 * Usage: cd functions && npm run build && cd .. && firebase emulators:exec --only firestore,functions "node scripts/test-release-planned-staging-location.mjs"
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

const clientApp = initializeApp({ projectId: PROJECT_ID }, "release-planned-staging");
const functions = getFunctions(clientApp, "us-central1");
connectFunctionsEmulator(functions, "127.0.0.1", 5001);
const releasePlanned = httpsCallable(functions, "releasePlannedStagingLocation");

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
    jobId: "job-rpsl",
    vendorId: "vendor-rpsl",
    status: "arrived",
    stagingLocationId: "",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...extra,
  });
}

async function callRelease(deliveryId, locationId, placed) {
  return releasePlanned({
    deliveryId,
    sessionToken: vendorSessionTokenFor(deliveryId),
    locationId,
    placed,
  });
}

console.log("\n=== releasePlannedStagingLocation CF ===\n");

await seed(async (db) => {
  await setDoc(doc(db, "appSettings", "config"), {
    vendorDeliveryMode: "exception_only",
  });
  await seedLocation(db, "rpsl-loc-free", "RF");
  await seedLocation(db, "rpsl-loc-conflict", "RC");
  await seedLocation(db, "rpsl-loc-addl", "RA");
  await seedLocation(db, "rpsl-loc-planned", "RP");
  await seedLocation(db, "rpsl-loc-cleared", "RCL");
  await seedLocation(db, "rpsl-loc-page", "RPG");
  await seedLocation(db, "rpsl-loc-inactive", "RIN", "Inactive");
});

// 1. placed=true happy path — free planned spot
await seed(async (db) => {
  await seedDelivery(db, "rpsl-del-happy", {
    plannedStagingLocationIds: ["rpsl-loc-free"],
  });
  await seedVendorSession(db, "rpsl-del-happy");
});
try {
  const result = await callRelease("rpsl-del-happy", "rpsl-loc-free", true);
  const after = await readDelivery("rpsl-del-happy");
  if (
    result.data?.placed === true &&
    after?.stagingLocationId === "rpsl-loc-free" &&
    (after?.plannedStagingLocationIds ?? []).includes("rpsl-loc-free")
  ) {
    pass("placed=true happy — stagingLocationId set; planned retained");
  } else {
    fail("placed=true happy", JSON.stringify({ d: result.data, after }));
  }
} catch (err) {
  fail("placed=true happy", err);
}

// 2a. Conflict primary on other delivery
await seed(async (db) => {
  await seedDelivery(db, "rpsl-del-conflict-primary-a", {
    plannedStagingLocationIds: ["rpsl-loc-conflict"],
  });
  await seedDelivery(db, "rpsl-del-conflict-primary-b", {
    stagingLocationId: "rpsl-loc-conflict",
  });
  await seedVendorSession(db, "rpsl-del-conflict-primary-a");
});
try {
  await callRelease("rpsl-del-conflict-primary-a", "rpsl-loc-conflict", true);
  fail("placed=true conflict primary should reject");
} catch (err) {
  const after = await readDelivery("rpsl-del-conflict-primary-a");
  if (
    /no longer available/i.test(msgOf(err)) &&
    (after?.stagingLocationId ?? "") === "" &&
    (after?.plannedStagingLocationIds ?? []).includes("rpsl-loc-conflict")
  ) {
    pass("placed=true rejected — other primary occupant; acting still planned");
  } else {
    fail("placed=true conflict primary", err);
  }
}

// 2b. Conflict additional on other delivery
await seed(async (db) => {
  await seedDelivery(db, "rpsl-del-conflict-addl-a", {
    plannedStagingLocationIds: ["rpsl-loc-addl"],
  });
  await seedDelivery(db, "rpsl-del-conflict-addl-b", {
    additionalStagingLocationIds: ["rpsl-loc-addl"],
  });
  await seedVendorSession(db, "rpsl-del-conflict-addl-a");
});
try {
  await callRelease("rpsl-del-conflict-addl-a", "rpsl-loc-addl", true);
  fail("placed=true conflict additional should reject");
} catch (err) {
  const after = await readDelivery("rpsl-del-conflict-addl-a");
  if (
    /no longer available/i.test(msgOf(err)) &&
    (after?.stagingLocationId ?? "") === ""
  ) {
    pass("placed=true rejected — other additional occupant");
  } else {
    fail("placed=true conflict additional", err);
  }
}

// 2c. Conflict planned-only on other delivery
await seed(async (db) => {
  await seedDelivery(db, "rpsl-del-conflict-planned-a", {
    plannedStagingLocationIds: ["rpsl-loc-planned"],
  });
  await seedDelivery(db, "rpsl-del-conflict-planned-b", {
    plannedStagingLocationIds: ["rpsl-loc-planned"],
  });
  await seedVendorSession(db, "rpsl-del-conflict-planned-a");
});
try {
  await callRelease("rpsl-del-conflict-planned-a", "rpsl-loc-planned", true);
  fail("placed=true conflict planned-only should reject");
} catch (err) {
  const after = await readDelivery("rpsl-del-conflict-planned-a");
  if (
    /no longer available/i.test(msgOf(err)) &&
    (after?.stagingLocationId ?? "") === ""
  ) {
    pass("placed=true rejected — other planned-only occupant");
  } else {
    fail("placed=true conflict planned-only", err);
  }
}

// 3. ZONE_CLEARED — succeeds over picked_up / installed
await seed(async (db) => {
  await seedDelivery(db, "rpsl-del-cleared-a", {
    plannedStagingLocationIds: ["rpsl-loc-cleared"],
  });
  await seedDelivery(db, "rpsl-del-cleared-b-picked", {
    stagingLocationId: "rpsl-loc-cleared",
    status: "picked_up",
  });
  await seedDelivery(db, "rpsl-del-cleared-b-installed", {
    stagingLocationId: "rpsl-loc-cleared",
    status: "installed",
  });
  await seedVendorSession(db, "rpsl-del-cleared-a");
});
try {
  const result = await callRelease("rpsl-del-cleared-a", "rpsl-loc-cleared", true);
  const after = await readDelivery("rpsl-del-cleared-a");
  if (
    result.data?.placed === true &&
    after?.stagingLocationId === "rpsl-loc-cleared"
  ) {
    pass("placed=true succeeds over picked_up/installed holders");
  } else {
    fail("placed=true ZONE_CLEARED", JSON.stringify({ d: result.data, after }));
  }
} catch (err) {
  fail("placed=true ZONE_CLEARED", err);
}

// 4. Already actual on same delivery — skip
await seed(async (db) => {
  await seedDelivery(db, "rpsl-del-already-actual", {
    stagingLocationId: "rpsl-loc-free",
    plannedStagingLocationIds: ["rpsl-loc-free"],
  });
  await seedVendorSession(db, "rpsl-del-already-actual");
});
try {
  const result = await callRelease("rpsl-del-already-actual", "rpsl-loc-free", true);
  if (result.data?.skipped === true) {
    pass("placed=true skipped when delivery already uses spot");
  } else {
    fail("already actual skip", JSON.stringify(result.data));
  }
} catch (err) {
  fail("already actual skip", err);
}

// 5. placed=false releases planned without occupancy check
await seed(async (db) => {
  await seedDelivery(db, "rpsl-del-release-no-check", {
    plannedStagingLocationIds: ["rpsl-loc-conflict"],
  });
  await seedDelivery(db, "rpsl-del-occupies-for-release", {
    stagingLocationId: "rpsl-loc-conflict",
  });
  await seedVendorSession(db, "rpsl-del-release-no-check");
});
try {
  const result = await callRelease(
    "rpsl-del-release-no-check",
    "rpsl-loc-conflict",
    false,
  );
  const after = await readDelivery("rpsl-del-release-no-check");
  const planned = after?.plannedStagingLocationIds ?? [];
  if (
    result.data?.released === true &&
    !planned.includes("rpsl-loc-conflict")
  ) {
    pass("placed=false releases planned without occupancy guard");
  } else {
    fail("placed=false release", JSON.stringify({ d: result.data, after }));
  }
} catch (err) {
  fail("placed=false release", err);
}

// 6a. Inactive location on placed=true
await seed(async (db) => {
  await seedDelivery(db, "rpsl-del-inactive", {
    plannedStagingLocationIds: ["rpsl-loc-inactive"],
  });
  await seedVendorSession(db, "rpsl-del-inactive");
});
try {
  await callRelease("rpsl-del-inactive", "rpsl-loc-inactive", true);
  fail("inactive location should reject placed=true");
} catch (err) {
  if (/no longer available/i.test(msgOf(err))) {
    pass("placed=true rejected — inactive location");
  } else {
    fail("inactive location", err);
  }
}

// 6b. Missing location on placed=true
await seed(async (db) => {
  await seedDelivery(db, "rpsl-del-missing-loc", {
    plannedStagingLocationIds: ["rpsl-loc-missing-xyz"],
  });
  await seedVendorSession(db, "rpsl-del-missing-loc");
});
try {
  await callRelease("rpsl-del-missing-loc", "rpsl-loc-missing-xyz", true);
  fail("missing location should reject placed=true");
} catch (err) {
  if (codeOf(err).includes("not-found") || /not found/i.test(msgOf(err))) {
    pass("placed=true rejected — missing location");
  } else {
    fail("missing location", err);
  }
}

// 7. Paging — active occupant behind >20 picked_up docs
await seed(async (db) => {
  await seedDelivery(db, "rpsl-del-page-src", {
    plannedStagingLocationIds: ["rpsl-loc-page"],
  });
  for (let i = 0; i < 22; i += 1) {
    await seedDelivery(db, `rpsl-del-cleared-page-${i}`, {
      stagingLocationId: "rpsl-loc-page",
      status: "picked_up",
    });
  }
  await seedDelivery(db, "rpsl-del-active-behind-page", {
    stagingLocationId: "rpsl-loc-page",
    status: "arrived",
  });
  await seedVendorSession(db, "rpsl-del-page-src");
});
try {
  await callRelease("rpsl-del-page-src", "rpsl-loc-page", true);
  fail("paging occupant should reject placed=true");
} catch (err) {
  const after = await readDelivery("rpsl-del-page-src");
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
