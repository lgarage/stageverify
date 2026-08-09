/**
 * Emulator tests: verifyVendorPin legacy bootstrap + locationFirst omit.
 * Usage: npm run test:vendor-pin-bootstrap
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

await seed(async (db) => {
  await setDoc(doc(db, "appSettings", "config"), {
    vendorDeliveryMode: "exception_only",
    vendorSessionMinutes: 15,
  });
  await setDoc(doc(db, "vendors", "vendor-boot"), {
    id: "vendor-boot",
    name: "Bootstrap Vendor",
    pinCode: "1234",
    active: true,
    companyWideSessionEnabled: true,
    createdAt: "2026-01-01T00:00:00Z",
  });
  await setDoc(doc(db, "jobs", "job-boot"), {
    id: "job-boot",
    jobNumber: "J-BOOT",
    jobName: "Bootstrap Job",
    status: "active",
    pinCode: "567890",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  await setDoc(doc(db, "stagingLocations", "loc-boot"), {
    id: "loc-boot",
    code: "B1",
    label: "Bay 1",
    type: "ground",
    status: "Active",
  });
  await setDoc(doc(db, "purchaseOrders", "po-boot"), {
    id: "po-boot",
    poNumber: "PO-BOOT",
    jobId: "job-boot",
    vendorId: "vendor-boot",
    status: "open",
  });
  await setDoc(doc(db, "deliveries", "delivery-boot"), {
    id: "delivery-boot",
    orderNumber: "ORD-BOOT",
    jobId: "job-boot",
    vendorId: "vendor-boot",
    vendorName: "Bootstrap Vendor",
    purchaseOrderId: "po-boot",
    deliveryDate: "2026-08-01",
    status: "shipped",
    stagingLocationId: "loc-boot",
    plannedStagingLocationIds: ["loc-boot"],
    vendorInvoiceNumber: "INV-BOOT",
    invoiceFulfillmentMethod: "delivery",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  await setDoc(doc(db, "items", "item-boot-1"), {
    id: "item-boot-1",
    deliveryOrderId: "delivery-boot",
    description: "Filter",
    qtyOrdered: 2,
    qtyReceived: 0,
    status: "pending",
  });
  await setDoc(doc(db, "items", "item-boot-2"), {
    id: "item-boot-2",
    deliveryOrderId: "delivery-boot",
    description: "Coil",
    qtyOrdered: 1,
    qtyReceived: 0,
    status: "pending",
  });
});

// 1) Invalid PIN — no bootstrap / opaque
try {
  const res = await verifyPin({
    deliveryId: "delivery-boot",
    pin: "0000",
  });
  const data = res.data;
  assertNoBootstrapOnFailure(data);
  pass("invalid 4-digit PIN → no bootstrap");
} catch (err) {
  // Some paths throw HttpsError
  if (String(err?.message ?? err).includes("Invalid") || err?.code) {
    pass("invalid PIN rejected (thrown)");
  } else {
    fail("invalid PIN", err);
  }
}

function assertNoBootstrapOnFailure(data) {
  if (data?.success === false) {
    if (data.bootstrap) throw new Error("bootstrap leaked on failure");
    return;
  }
  throw new Error("expected success:false");
}

await new Promise((r) => setTimeout(r, 800)); // rate-limit interval

// 2) Valid 4-digit vendor PIN → bootstrap present (legacy)
try {
  const res = await verifyPin({
    deliveryId: "delivery-boot",
    pin: "1234",
  });
  const data = res.data;
  if (!data.success) throw new Error(JSON.stringify(data));
  if (!data.bootstrap) throw new Error("missing bootstrap on legacy success");
  if (data.bootstrap.orderNumber !== "ORD-BOOT") {
    throw new Error("bad orderNumber");
  }
  if (data.bootstrap.vendorName !== "Bootstrap Vendor") {
    throw new Error("bad vendorName");
  }
  if (data.bootstrap.jobName !== "Bootstrap Job") {
    throw new Error("bad jobName");
  }
  if (data.bootstrap.stagingLocationCode !== "B1") {
    throw new Error("bad staging code");
  }
  if (data.bootstrap.poNumber !== "PO-BOOT") {
    throw new Error("bad poNumber");
  }
  if (data.bootstrap.itemCount !== 2) {
    throw new Error(`bad itemCount ${data.bootstrap.itemCount}`);
  }
  if (data.bootstrap.notes != null) throw new Error("notes leaked");
  if (!data.sessionToken) throw new Error("missing sessionToken");
  pass("legacy 4-digit PIN returns allowlisted bootstrap");
} catch (err) {
  fail("legacy 4-digit PIN returns allowlisted bootstrap", err);
}

await new Promise((r) => setTimeout(r, 800));

// 3) Valid 6-digit job PIN on same delivery
try {
  const res = await verifyPin({
    deliveryId: "delivery-boot",
    pin: "567890",
  });
  const data = res.data;
  if (!data.success) throw new Error(JSON.stringify(data));
  if (!data.bootstrap) throw new Error("missing bootstrap for 6-digit job pin");
  if (data.sessionScope !== "job") throw new Error("expected job scope");
  pass("legacy 6-digit job PIN returns bootstrap");
} catch (err) {
  fail("legacy 6-digit job PIN returns bootstrap", err);
}

await new Promise((r) => setTimeout(r, 800));

// 4) locationFirst vendor PIN — no bootstrap field
try {
  const res = await verifyPin({
    stagingLocationCode: "B1",
    pin: "1234",
  });
  const data = res.data;
  if (!data.success) throw new Error(JSON.stringify(data));
  if (data.bootstrap) {
    throw new Error("locationFirst must not attach bootstrap");
  }
  pass("locationFirst success omits bootstrap");
} catch (err) {
  fail("locationFirst success omits bootstrap", err);
}

console.log(`\nvendor-pin-bootstrap: ${passed} passed, ${failed} failed`);
await testEnv.cleanup();
if (failed > 0) process.exit(1);
