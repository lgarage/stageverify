/**
 * getVendorRunDeliveries CF — company-wide vendor session + batched enrichment.
 * Usage: npm run test:get-vendor-run-deliveries
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { initializeApp } from "firebase/app";
import { doc, setDoc } from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

const PROJECT_ID = "stageverify-db";
const RULES_PATH = resolve(process.cwd(), "firestore.rules");
const STAGING_CODE = "G1";
const STAGING_ID = "loc-g1";
const SHARED_LOC_ID = "loc-shared-run";

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
const getRunDeliveries = httpsCallable(functions, "getVendorRunDeliveries");

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

try {
  console.log("\n=== getVendorRunDeliveries CF ===\n");

  await seed(async (db) => {
    await setDoc(doc(db, "stagingLocations", STAGING_ID), {
      id: STAGING_ID,
      code: STAGING_CODE,
      active: true,
    });
    await setDoc(doc(db, "stagingLocations", SHARED_LOC_ID), {
      id: SHARED_LOC_ID,
      code: "S1",
      active: true,
    });
    await setDoc(doc(db, "appSettings", "config"), {
      parcelIntakeEnabled: true,
      catchAllStagingLocationId: STAGING_ID,
      vendorSessionMinutes: 15,
    });

    // Vendor A — company-wide
    await setDoc(doc(db, "vendors", "vendor-run-a"), {
      id: "vendor-run-a",
      name: "Run Vendor A",
      active: true,
      companyWideSessionEnabled: true,
      pinCode: "8080",
      pinConfigured: true,
    });

    // Vendor B — must not appear for vendor A session
    await setDoc(doc(db, "vendors", "vendor-run-b"), {
      id: "vendor-run-b",
      name: "Run Vendor B",
      active: true,
      companyWideSessionEnabled: true,
      pinCode: "9090",
    });

    await setDoc(doc(db, "jobs", "job-run-alpha"), {
      id: "job-run-alpha",
      jobName: "Alpha Job",
      pinCode: "111111",
    });
    await setDoc(doc(db, "jobs", "job-run-beta"), {
      id: "job-run-beta",
      jobName: "Beta Job",
      pinCode: "222222",
    });

    await setDoc(doc(db, "purchaseOrders", "po-run-1"), {
      id: "po-run-1",
      poNumber: "PO-RUN-1",
      jobId: "job-run-alpha",
      vendorId: "vendor-run-a",
    });

    // Active delivery on job alpha — primary anchor
    await setDoc(doc(db, "deliveries", "del-run-alpha"), {
      id: "del-run-alpha",
      vendorId: "vendor-run-a",
      jobId: "job-run-alpha",
      orderNumber: "ORD-A1",
      purchaseOrderId: "po-run-1",
      status: "shipped",
      stagingLocationId: STAGING_ID,
      plannedStagingLocationIds: [STAGING_ID, SHARED_LOC_ID],
      vendorInvoiceNumber: "INV-A1",
    });

    // Active delivery on job beta — shared staging location
    await setDoc(doc(db, "deliveries", "del-run-beta"), {
      id: "del-run-beta",
      vendorId: "vendor-run-a",
      jobId: "job-run-beta",
      orderNumber: "ORD-B1",
      status: "arrived",
      stagingLocationId: SHARED_LOC_ID,
      plannedStagingLocationIds: [SHARED_LOC_ID],
    });

    // Blocked — ready_for_pickup (filtered by isActiveVendorDelivery)
    await setDoc(doc(db, "deliveries", "del-run-blocked"), {
      id: "del-run-blocked",
      vendorId: "vendor-run-a",
      jobId: "job-run-alpha",
      orderNumber: "ORD-BLOCKED",
      status: "ready_for_pickup",
    });

    // Vendor B delivery — must not appear
    await setDoc(doc(db, "deliveries", "del-run-vendor-b"), {
      id: "del-run-vendor-b",
      vendorId: "vendor-run-b",
      jobId: "job-run-beta",
      orderNumber: "ORD-B-OTHER",
      status: "shipped",
    });

    await setDoc(doc(db, "items", "item-run-a1"), {
      id: "item-run-a1",
      deliveryOrderId: "del-run-alpha",
      description: "Alpha Widget",
      qtyOrdered: 3,
      qtyReceived: 3,
      qtyBackordered: 0,
      status: "received",
    });
    await setDoc(doc(db, "items", "item-run-a2"), {
      id: "item-run-a2",
      deliveryOrderId: "del-run-alpha",
      description: "Alpha Gasket",
      qtyOrdered: 1,
    });
    await setDoc(doc(db, "items", "item-run-b1"), {
      id: "item-run-b1",
      deliveryOrderId: "del-run-beta",
      description: "Beta Part",
      qtyOrdered: 2,
    });
  });

  await sleep(800);

  // Create company-wide vendor session via resolveLocationScanPin
  let sessionToken;
  try {
    const { data } = await resolvePin({
      pin: "8080",
      stagingLocationCode: STAGING_CODE,
    });
    if (
      data?.success !== true ||
      data.sessionScope !== "vendor" ||
      data.vendorId !== "vendor-run-a" ||
      typeof data.sessionToken !== "string"
    ) {
      throw new Error(JSON.stringify(data));
    }
    sessionToken = data.sessionToken;
    pass("company PIN → vendor-scoped session for getVendorRunDeliveries");
  } catch (err) {
    fail("company PIN session bootstrap", err);
    throw err;
  }

  await sleep(800);

  // Happy path — batched enrichment
  try {
    const { data } = await getRunDeliveries({ sessionToken });
    if (data?.vendorId !== "vendor-run-a") {
      throw new Error(`bad vendorId ${data?.vendorId}`);
    }
    if (!Array.isArray(data.deliveries)) {
      throw new Error("missing deliveries array");
    }
    if (data.deliveries.length !== 2) {
      throw new Error(
        `expected 2 active deliveries, got ${data.deliveries.length}: ${JSON.stringify(data.deliveries.map((d) => d.deliveryId))}`,
      );
    }

    const ids = data.deliveries.map((d) => d.deliveryId).sort();
    if (ids.join(",") !== "del-run-alpha,del-run-beta") {
      throw new Error(`unexpected delivery ids ${ids.join(",")}`);
    }

    const alpha = data.deliveries.find((d) => d.deliveryId === "del-run-alpha");
    const beta = data.deliveries.find((d) => d.deliveryId === "del-run-beta");

    if (!alpha || !beta) throw new Error("missing expected delivery summaries");

    if (alpha.jobName !== "Alpha Job") throw new Error("bad alpha jobName");
    if (beta.jobName !== "Beta Job") throw new Error("bad beta jobName");
    if (alpha.poNumber !== "PO-RUN-1") throw new Error("bad poNumber");
    if (alpha.vendorInvoiceNumber !== "INV-A1") {
      throw new Error("bad vendorInvoiceNumber");
    }

    // Order must match collectLocationIds serial output: stagingLocationId first, then planned extras
    const expectedAlphaCodes = [STAGING_CODE, "S1"];
    if (JSON.stringify(alpha.stagingLocationCodes) !== JSON.stringify(expectedAlphaCodes)) {
      throw new Error(
        `bad stagingLocationCodes order ${JSON.stringify(alpha.stagingLocationCodes)}`,
      );
    }
    if (JSON.stringify(beta.stagingLocationCodes) !== JSON.stringify(["S1"])) {
      throw new Error("bad beta stagingLocationCodes");
    }

    if (alpha.items.length !== 2) throw new Error("bad alpha item count");
    if (beta.items.length !== 1) throw new Error("bad beta item count");

    const alphaItemIds = alpha.items.map((i) => i.id).sort();
    if (alphaItemIds.join(",") !== "item-run-a1,item-run-a2") {
      throw new Error("bad alpha items");
    }

    const alphaItemA1 = alpha.items.find((i) => i.id === "item-run-a1");
    const alphaItemA2 = alpha.items.find((i) => i.id === "item-run-a2");
    if (!alphaItemA1 || !alphaItemA2) {
      throw new Error("missing alpha item fixtures");
    }
    if (alphaItemA1.qtyReceived !== 3) {
      throw new Error(`bad item-run-a1 qtyReceived ${alphaItemA1.qtyReceived}`);
    }
    if (alphaItemA1.status !== "received") {
      throw new Error(`bad item-run-a1 status ${alphaItemA1.status}`);
    }
    if (alphaItemA2.qtyReceived !== undefined) {
      throw new Error(
        `item-run-a2 qtyReceived should be omitted, got ${alphaItemA2.qtyReceived}`,
      );
    }
    if (alpha.status !== "shipped") {
      throw new Error(`bad alpha delivery status ${alpha.status}`);
    }

    // Sort: jobName then orderNumber — Alpha before Beta
    if (data.deliveries[0].jobName !== "Alpha Job") {
      throw new Error("sort order wrong — Alpha should be first");
    }
    if (data.deliveries[1].jobName !== "Beta Job") {
      throw new Error("sort order wrong — Beta should be second");
    }

    if (data.scannedStagingLocationCode !== STAGING_CODE) {
      throw new Error("bad scannedStagingLocationCode");
    }

    pass("getVendorRunDeliveries returns enriched, sorted, filtered deliveries");
  } catch (err) {
    fail("getVendorRunDeliveries happy path", err);
  }

  // Invalid session rejected
  await sleep(800);
  try {
    await getRunDeliveries({ sessionToken: "not-a-real-session-token" });
    fail("invalid session should throw", new Error("expected HttpsError"));
  } catch (err) {
    const msg = String(err?.message ?? err);
    if (msg.includes("Session expired") || msg.includes("Invalid session")) {
      pass("invalid/expired session rejected");
    } else {
      fail("invalid session rejection", err);
    }
  }
} catch (err) {
  fail("unexpected test harness error", err);
} finally {
  await testEnv.cleanup();
}

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
