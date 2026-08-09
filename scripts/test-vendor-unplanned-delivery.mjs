/**
 * Vendor unplanned-delivery fallback CF + session gates (emulators).
 * Usage: npm run test:vendor-unplanned-delivery
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

const PROJECT_ID = "stageverify-db";
const RULES_PATH = resolve(process.cwd(), "firestore.rules");

const UNPLANNED_SESSION = "a".repeat(64);
const VENDOR_RUN_SESSION = "b".repeat(64);
const WRONG_PIN = "0000";

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

const verifyPin = httpsCallable(functions, "verifyVendorPin");
const matchUnplanned = httpsCallable(functions, "matchUnplannedVendorDelivery");
const createUnplanned = httpsCallable(functions, "createUnplannedVendorDelivery");
const confirmUnplanned = httpsCallable(
  functions,
  "confirmUnplannedVendorDeliveryMatch",
);
const markDelivered = httpsCallable(functions, "markVendorDelivered");
const assignStaging = httpsCallable(functions, "assignVendorStagingLocation");

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

async function readDelivery(id) {
  let data = null;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore(), "deliveries", id));
    data = snap.exists() ? snap.data() : null;
  });
  return data;
}

const future = new Date(Date.now() + 3_600_000).toISOString();

await seed(async (db) => {
  await setDoc(doc(db, "appSettings", "config"), {
    vendorDeliveryMode: "exception_only",
    vendorSessionMinutes: 15,
  });
  await setDoc(doc(db, "stagingLocations", "loc-unpl"), {
    id: "loc-unpl",
    code: "U1",
    label: "Unplanned Bay",
    type: "ground",
    status: "Active",
    widthFt: 4,
    depthFt: 4,
  });
  await setDoc(doc(db, "vendors", "vendor-unpl"), {
    id: "vendor-unpl",
    name: "Unplanned Vendor",
    pinCode: "4321",
    active: true,
    companyWideSessionEnabled: true,
    createdAt: "2026-01-01T00:00:00Z",
  });
  await setDoc(doc(db, "vendors", "vendor-no-del"), {
    id: "vendor-no-del",
    name: "No Delivery Vendor",
    pinCode: "5555",
    active: true,
    companyWideSessionEnabled: true,
    createdAt: "2026-01-01T00:00:00Z",
  });
  await setDoc(doc(db, "jobs", "job-unpl"), {
    id: "job-unpl",
    jobNumber: "J-UNPL",
    jobName: "Unplanned Job",
    status: "active",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  await setDoc(doc(db, "purchaseOrders", "po-unpl"), {
    id: "po-unpl",
    poNumber: "PO-UNPL-99",
    jobId: "job-unpl",
    vendorId: "vendor-unpl",
    status: "open",
  });
  await setDoc(doc(db, "deliveries", "del-unpl-match"), {
    id: "del-unpl-match",
    orderNumber: "ORD-UNPL-1",
    jobId: "job-unpl",
    vendorId: "vendor-unpl",
    vendorName: "Unplanned Vendor",
    purchaseOrderId: "po-unpl",
    vendorInvoiceNumber: "INV-MATCH-001",
    deliveryDate: "2026-08-01",
    status: "shipped",
    stagingLocationId: "loc-unpl",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  await setDoc(doc(db, "items", "item-unpl-1"), {
    id: "item-unpl-1",
    deliveryOrderId: "del-unpl-match",
    description: "Test item",
    qtyOrdered: 1,
    qtyReceived: 0,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "pending",
  });
  await setDoc(doc(db, "vendorSessions", UNPLANNED_SESSION), {
    id: UNPLANNED_SESSION,
    deliveryId: "",
    vendorId: "vendor-unpl",
    vendorName: "Unplanned Vendor",
    expiresAt: future,
    createdAt: new Date().toISOString(),
    sessionScope: "vendor_unplanned",
    scannedStagingLocationId: "loc-unpl",
    scannedStagingLocationCode: "U1",
    unplannedEligible: true,
  });
  await setDoc(doc(db, "vendorSessions", VENDOR_RUN_SESSION), {
    id: VENDOR_RUN_SESSION,
    deliveryId: "del-unpl-match",
    vendorId: "vendor-unpl",
    vendorName: "Unplanned Vendor",
    expiresAt: future,
    createdAt: new Date().toISOString(),
    sessionScope: "vendor",
  });
});

try {
  console.log("\n=== verifyVendorPin no-anchor → vendor_unplanned ===\n");

  await new Promise((r) => setTimeout(r, 800));

  try {
    const res = await verifyPin({
      stagingLocationCode: "U1",
      pin: WRONG_PIN,
    });
    if (res.data?.success === false) {
      pass("wrong PIN → Invalid code (not unplanned session)");
    } else {
      fail("wrong PIN should fail", new Error(JSON.stringify(res.data)));
    }
  } catch (err) {
    if (String(err?.message ?? err).includes("Invalid")) {
      pass("wrong PIN rejected");
    } else {
      fail("wrong PIN", err);
    }
  }

  await new Promise((r) => setTimeout(r, 800));

  try {
    const res = await verifyPin({
      stagingLocationCode: "U1",
      pin: "5555",
    });
    const data = res.data;
    if (
      data?.success === true &&
      data.sessionScope === "vendor_unplanned" &&
      data.noExpectedDelivery === true &&
      data.sessionToken
    ) {
      pass("company PIN with zero deliveries → vendor_unplanned session");
    } else {
      fail("no-anchor PIN path", new Error(JSON.stringify(data)));
    }
  } catch (err) {
    fail("no-anchor PIN path", err);
  }

  console.log("\n=== matchUnplannedVendorDelivery outcomes ===\n");

  try {
    const res = await matchUnplanned({
      sessionToken: UNPLANNED_SESSION,
      reference: "INV-MATCH-001",
    });
    const data = res.data;
    if (
      data?.outcome === "strong_match" &&
      data.candidate?.deliveryId === "del-unpl-match"
    ) {
      pass("strong_match for exact invoice reference");
    } else {
      fail("strong_match", new Error(JSON.stringify(data)));
    }
  } catch (err) {
    fail("strong_match", err);
  }

  try {
    const res = await matchUnplanned({
      sessionToken: UNPLANNED_SESSION,
      reference: "ZZZ-NO-SUCH-REF",
    });
    if (res.data?.outcome === "no_match") {
      pass("no_match for unknown reference");
    } else {
      fail("no_match", new Error(JSON.stringify(res.data)));
    }
  } catch (err) {
    fail("no_match", err);
  }

  console.log("\n=== createUnplannedVendorDelivery idempotent ===\n");

  const createRef = "UNPL-IDEM-REF-42";
  let firstDeliveryId;
  try {
    const res = await createUnplanned({
      sessionToken: UNPLANNED_SESSION,
      reference: createRef,
      spaceTier: "ground",
    });
    const data = res.data;
    if (data?.success === true && data.deliveryId && data.sessionToken) {
      firstDeliveryId = data.deliveryId;
      pass("create shell succeeds with upgraded vendor session");
    } else {
      fail("create shell", new Error(JSON.stringify(data)));
    }
  } catch (err) {
    fail("create shell", err);
  }

  try {
    const res = await createUnplanned({
      sessionToken: UNPLANNED_SESSION,
      reference: createRef,
      spaceTier: "ground",
    });
    const replayId =
      res.data?.deliveryId ??
      (res.data?.outcome === "strong_match_found"
        ? res.data?.candidate?.deliveryId
        : undefined);
    if (replayId === firstDeliveryId) {
      pass("create idempotent replay returns same delivery");
    } else {
      fail("create idempotent", new Error(JSON.stringify(res.data)));
    }
  } catch (err) {
    fail("create idempotent", err);
  }

  const created = await readDelivery(firstDeliveryId);
  if (created?.unplanned === true) {
    pass("created delivery marked unplanned");
  } else {
    fail("created delivery flags", new Error(JSON.stringify(created)));
  }

  console.log("\n=== confirmUnplannedVendorDeliveryMatch re-match ===\n");

  try {
    const res = await confirmUnplanned({
      sessionToken: UNPLANNED_SESSION,
      reference: "INV-MATCH-001",
      deliveryId: "del-unpl-match",
      spaceTier: "ground",
    });
    if (res.data?.success === true && res.data.deliveryId === "del-unpl-match") {
      pass("confirm strong match succeeds");
    } else {
      fail("confirm strong match", new Error(JSON.stringify(res.data)));
    }
  } catch (err) {
    fail("confirm strong match", err);
  }

  try {
    await confirmUnplanned({
      sessionToken: UNPLANNED_SESSION,
      reference: "INV-MATCH-001",
      deliveryId: "del-wrong-id",
      spaceTier: "ground",
    });
    fail("confirm with stale deliveryId should fail");
  } catch (err) {
    if (String(err?.message ?? err).includes("no longer valid")) {
      pass("confirm re-match rejects stale deliveryId");
    } else {
      fail("confirm stale deliveryId wrong error", err);
    }
  }

  console.log("\n=== delivery-bound CFs reject vendor_unplanned ===\n");

  try {
    await markDelivered({
      deliveryId: "del-unpl-match",
      sessionToken: UNPLANNED_SESSION,
    });
    fail("markVendorDelivered should reject vendor_unplanned session");
  } catch (err) {
    if (String(err?.message ?? err).includes("not valid for this delivery")) {
      pass("markVendorDelivered rejects vendor_unplanned token");
    } else {
      fail("markVendorDelivered rejection", err);
    }
  }

  try {
    await assignStaging({
      deliveryId: "del-unpl-match",
      sessionToken: UNPLANNED_SESSION,
      stagingLocationId: "loc-unpl",
    });
    fail("assignVendorStagingLocation should reject vendor_unplanned session");
  } catch (err) {
    if (String(err?.message ?? err).includes("not valid for this delivery")) {
      pass("assignVendorStagingLocation rejects vendor_unplanned token");
    } else {
      fail("assignVendorStagingLocation rejection", err);
    }
  }

  try {
    await markDelivered({
      deliveryId: "del-unpl-match",
      sessionToken: VENDOR_RUN_SESSION,
    });
    pass("vendor session works on delivery-bound CF");
  } catch (err) {
    fail("vendor session markVendorDelivered", err);
  }

  console.log("\n=== second unplanned via vendor session (prior shell exists) ===\n");

  const secondRef = "UNPL-SECOND-REF-77";
  let secondDeliveryId;
  try {
    const res = await createUnplanned({
      sessionToken: VENDOR_RUN_SESSION,
      reference: secondRef,
      spaceTier: "shelf",
    });
    const data = res.data;
    if (
      data?.success === true &&
      data.deliveryId &&
      data.deliveryId !== firstDeliveryId
    ) {
      secondDeliveryId = data.deliveryId;
      pass("vendor session creates second different unplanned shell");
    } else {
      fail("second unplanned create", new Error(JSON.stringify(data)));
    }
  } catch (err) {
    fail("second unplanned create", err);
  }

  const second = secondDeliveryId ? await readDelivery(secondDeliveryId) : null;
  if (second?.unplanned === true && second?.unplannedSubmittedReference === secondRef) {
    pass("second shell is separate Unplanned record");
  } else {
    fail("second shell flags", new Error(JSON.stringify(second)));
  }

  try {
    const res = await createUnplanned({
      sessionToken: VENDOR_RUN_SESSION,
      reference: secondRef,
      spaceTier: "shelf",
    });
    const replayId =
      res.data?.deliveryId ??
      (res.data?.outcome === "strong_match_found"
        ? res.data?.candidate?.deliveryId
        : undefined);
    if (replayId === secondDeliveryId) {
      pass("second-ref idempotent replay returns same delivery");
    } else {
      fail("second-ref idempotent", new Error(JSON.stringify(res.data)));
    }
  } catch (err) {
    fail("second-ref idempotent", err);
  }
} finally {
  console.log(`\nvendor-unplanned-delivery: ${passed} passed, ${failed} failed`);
  await testEnv.cleanup();
  if (failed > 0) process.exit(1);
}
