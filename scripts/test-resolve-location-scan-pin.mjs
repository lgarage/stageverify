/**
 * resolveLocationScanPin CF — neutral location scan PIN (emulators).
 * Usage: npm run test:resolve-location-scan-pin
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createRequire } from "node:module";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { initializeApp } from "firebase/app";
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  setDoc,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

const PROJECT_ID = "stageverify-db";
const RULES_PATH = resolve(process.cwd(), "firestore.rules");
const STAGING_CODE = "G1";
const STAGING_ID = "loc-g1";

const require = createRequire(import.meta.url);
const { hashPinForStorage } = require(
  resolve(process.cwd(), "functions/lib/pinHashing.js"),
);

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    host: "127.0.0.1",
    port: 8080,
    rules: readFileSync(RULES_PATH, "utf8"),
  },
});

const clientApp = initializeApp({ projectId: PROJECT_ID });
const functions = getFunctions(clientApp, "us-central1");
connectFunctionsEmulator(functions, "127.0.0.1", 5001);

const resolvePin = httpsCallable(functions, "resolveLocationScanPin");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function seed(setup) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setup(ctx.firestore());
  });
}

async function sessionCount(collectionName) {
  let count = 0;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getCountFromServer(
      collection(ctx.firestore(), collectionName),
    );
    count = snap.data().count;
  });
  return count;
}

async function clearPinFixtures(db) {
  const ids = [
    ["technicians", "tech-resolve-1"],
    ["vendors", "vendor-resolve-1"],
    ["jobs", "job-resolve-1"],
    ["deliveries", "del-resolve-1"],
    ["managementPins", "mgmt-resolve-full"],
    ["managementPins", "mgmt-resolve-limited"],
    ["stagingLocations", STAGING_ID],
  ];
  for (const [col, id] of ids) {
    await setDoc(doc(db, col, id), { _deleted: true }, { merge: true });
  }
}

async function seedBase(db) {
  await setDoc(doc(db, "stagingLocations", STAGING_ID), {
    id: STAGING_ID,
    code: STAGING_CODE,
    active: true,
  });
  await setDoc(doc(db, "appSettings", "config"), {
    parcelIntakeEnabled: true,
    catchAllStagingLocationId: STAGING_ID,
    technicianSessionMinutes: 15,
    vendorSessionMinutes: 15,
    managementSessionMinutes: 30,
  });
}

try {
  console.log("\n=== resolveLocationScanPin CF ===\n");

  // Technician success
  await seed(async (db) => {
    await clearPinFixtures(db);
    await seedBase(db);
    await setDoc(doc(db, "technicians", "tech-resolve-1"), {
      id: "tech-resolve-1",
      name: "Tech Resolve",
      active: true,
      pinCode: "2468",
      permissions: { doorScan: true },
    });
  });

  try {
    const { data } = await resolvePin({
      pin: "2468",
      stagingLocationCode: STAGING_CODE,
    });
    if (
      data?.success === true &&
      data.accessType === "technician" &&
      data.technicianId === "tech-resolve-1" &&
      typeof data.sessionToken === "string"
    ) {
      pass("unique technician PIN → technician session");
    } else {
      fail("technician success", new Error(JSON.stringify(data)));
    }
  } catch (err) {
    fail("technician success should succeed", err);
  }

  // Vendor job success
  await seed(async (db) => {
    await setDoc(doc(db, "technicians", "tech-resolve-1"), {
      id: "tech-resolve-1",
      name: "Tech Resolve",
      active: true,
      pinCode: "9999",
    });
    await setDoc(doc(db, "jobs", "job-resolve-1"), {
      id: "job-resolve-1",
      name: "Job Resolve",
      pinCode: "1357",
    });
    await setDoc(doc(db, "vendors", "vendor-resolve-1"), {
      id: "vendor-resolve-1",
      name: "Vendor Resolve",
      active: true,
      companyWideSessionEnabled: true,
      pinCode: "8888",
    });
    await setDoc(doc(db, "deliveries", "del-resolve-1"), {
      id: "del-resolve-1",
      vendorId: "vendor-resolve-1",
      jobId: "job-resolve-1",
      orderNumber: "ORD-RESOLVE",
    });
  });

  await sleep(800);
  try {
    const { data } = await resolvePin({
      pin: "1357",
      stagingLocationCode: STAGING_CODE,
    });
    if (
      data?.success === true &&
      data.accessType === "vendor" &&
      data.sessionScope === "job" &&
      data.jobId === "job-resolve-1"
    ) {
      pass("unique vendor job PIN → job-scoped vendor session");
    } else {
      fail("vendor job success", new Error(JSON.stringify(data)));
    }
  } catch (err) {
    fail("vendor job success should succeed", err);
  }

  // Management success (enterPortalAnyQr)
  await seed(async (db) => {
    await setDoc(doc(db, "jobs", "job-resolve-1"), {
      id: "job-resolve-1",
      pinCode: "0000",
    });
    await setDoc(doc(db, "managementPins", "mgmt-resolve-full"), {
      id: "mgmt-resolve-full",
      label: "Office Full",
      active: true,
      pinHash: hashPinForStorage("1122"),
      permissions: {
        enterPortalAnyQr: true,
        catchAllCheckIn: true,
        viewWaitingParts: true,
        markOrFlagParcel: true,
      },
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
  });

  await sleep(800);
  try {
    const { data } = await resolvePin({
      pin: "1122",
      stagingLocationCode: STAGING_CODE,
    });
    if (
      data?.success === true &&
      data.accessType === "management" &&
      data.pinId === "mgmt-resolve-full" &&
      data.permissions?.enterPortalAnyQr === true
    ) {
      pass("management PIN with enterPortalAnyQr → management session");
    } else {
      fail("management success", new Error(JSON.stringify(data)));
    }
  } catch (err) {
    fail("management success should succeed", err);
  }

  // Management capability denied — no session mint
  await seed(async (db) => {
    await setDoc(doc(db, "managementPins", "mgmt-resolve-full"), {
      id: "mgmt-resolve-full",
      pinHash: hashPinForStorage("0000"),
    });
    await setDoc(doc(db, "managementPins", "mgmt-resolve-limited"), {
      id: "mgmt-resolve-limited",
      label: "Limited",
      active: true,
      pinHash: hashPinForStorage("3344"),
      permissions: {
        enterPortalAnyQr: false,
        catchAllCheckIn: true,
        viewWaitingParts: false,
        markOrFlagParcel: false,
      },
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
  });

  const mgmtBefore = await sessionCount("managementSessions");
  await sleep(800);
  try {
    const { data } = await resolvePin({
      pin: "3344",
      stagingLocationCode: STAGING_CODE,
    });
    const mgmtAfter = await sessionCount("managementSessions");
    if (
      data?.success === false &&
      data.message === "This PIN cannot open the office portal." &&
      mgmtAfter === mgmtBefore
    ) {
      pass("management without enterPortalAnyQr → capability message, no session");
    } else {
      fail(
        "management capability denied",
        new Error(JSON.stringify({ data, mgmtBefore, mgmtAfter })),
      );
    }
  } catch (err) {
    fail("management capability denied should return failure object", err);
  }

  // Collision fail-closed: same PIN on technician + vendor
  await seed(async (db) => {
    await setDoc(doc(db, "technicians", "tech-resolve-1"), {
      id: "tech-resolve-1",
      name: "Tech Collision",
      active: true,
      pinCode: "7777",
      permissions: { doorScan: true },
    });
    await setDoc(doc(db, "vendors", "vendor-resolve-1"), {
      id: "vendor-resolve-1",
      name: "Vendor Collision",
      active: true,
      companyWideSessionEnabled: true,
      pinCode: "7777",
    });
    await setDoc(doc(db, "managementPins", "mgmt-resolve-limited"), {
      pinHash: hashPinForStorage("0000"),
    });
  });

  const techBefore = await sessionCount("technicianSessions");
  const vendorBefore = await sessionCount("vendorSessions");
  await sleep(800);
  try {
    const { data } = await resolvePin({
      pin: "7777",
      stagingLocationCode: STAGING_CODE,
    });
    const techAfter = await sessionCount("technicianSessions");
    const vendorAfter = await sessionCount("vendorSessions");
    if (
      data?.success === false &&
      data.message === "Invalid code." &&
      techAfter === techBefore &&
      vendorAfter === vendorBefore
    ) {
      pass("tech+vendor PIN collision → Invalid code., no session");
    } else {
      fail(
        "collision fail-closed",
        new Error(JSON.stringify({ data, techBefore, techAfter, vendorBefore, vendorAfter })),
      );
    }
  } catch (err) {
    fail("collision should return failure object", err);
  }

  // Legacy vendor company PIN (pinCode on vendor) + companyWide → success
  await seed(async (db) => {
    await setDoc(doc(db, "technicians", "tech-resolve-1"), {
      id: "tech-resolve-1",
      pinCode: "0000",
      active: true,
    });
    await setDoc(doc(db, "jobs", "job-resolve-1"), {
      id: "job-resolve-1",
      pinCode: "0001",
    });
    await setDoc(doc(db, "vendors", "vendor-resolve-1"), {
      id: "vendor-resolve-1",
      name: "Legacy Company Vendor",
      active: true,
      companyWideSessionEnabled: true,
      pinCode: "4242",
      pinConfigured: true,
    });
    await setDoc(doc(db, "deliveries", "del-resolve-1"), {
      id: "del-resolve-1",
      vendorId: "vendor-resolve-1",
      jobId: "job-resolve-1",
      orderNumber: "ORD-LEGACY-CO",
    });
    await setDoc(doc(db, "managementPins", "mgmt-resolve-full"), {
      pinHash: hashPinForStorage("0000"),
    });
  });

  await sleep(800);
  try {
    const { data } = await resolvePin({
      pin: "4242",
      stagingLocationCode: STAGING_CODE,
    });
    if (
      data?.success === true &&
      data.accessType === "vendor" &&
      data.vendorId === "vendor-resolve-1" &&
      data.sessionScope === "vendor"
    ) {
      pass("legacy vendor company PIN + companyWide → vendor session");
    } else {
      fail("legacy vendor company PIN", new Error(JSON.stringify(data)));
    }
  } catch (err) {
    fail("legacy vendor company PIN should succeed", err);
  }

  // Same PIN without companyWide → Invalid (D-09 gate)
  await seed(async (db) => {
    await setDoc(doc(db, "vendors", "vendor-resolve-1"), {
      id: "vendor-resolve-1",
      name: "No Company Wide",
      active: true,
      companyWideSessionEnabled: false,
      pinCode: "4242",
      pinConfigured: true,
    });
  });

  const vendorBeforeGate = await sessionCount("vendorSessions");
  await sleep(800);
  try {
    const { data } = await resolvePin({
      pin: "4242",
      stagingLocationCode: STAGING_CODE,
    });
    const vendorAfterGate = await sessionCount("vendorSessions");
    if (
      data?.success === false &&
      data.message === "Invalid code." &&
      vendorAfterGate === vendorBeforeGate
    ) {
      pass("vendor PIN without companyWide → Invalid code. (D-09)");
    } else {
      fail(
        "companyWide gate",
        new Error(JSON.stringify({ data, vendorBeforeGate, vendorAfterGate })),
      );
    }
  } catch (err) {
    fail("companyWide gate should return failure object", err);
  }
} catch (err) {
  fail("unexpected test harness error", err);
} finally {
  await testEnv.cleanup();
}

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
