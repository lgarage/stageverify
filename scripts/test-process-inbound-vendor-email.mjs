/**
 * Phase 5 vendor email write path — CF auth gate + conflict logic (emulators).
 * Usage: npm run test:process-inbound-vendor-email
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { createRequire } from "module";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { initializeApp } from "firebase/app";
import { connectFirestoreEmulator, doc, getDoc, getFirestore, setDoc } from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";
import { hasVendorOrderCompleteApplyConflict } from "../src/dispatcher/email/emailApplyConflicts.ts";
import { buildVendorOrderCompletePatch } from "../src/dispatcher/email/processEmailMessage.ts";

const require = createRequire(import.meta.url);
const PROJECT_ID = "stageverify-db";
const RULES_PATH = resolve(process.cwd(), "firestore.rules");
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

const COMPLETE_EMAIL = {
  sourceMessageId: "msg-vendor-complete-test-001",
  threadId: "thread-test",
  senderEmail: "dispatch@johnstone.com",
  recipientEmails: ["monitor@configured-inbox.example"],
  subject: "Order complete PO-45821",
  bodyText:
    "All items on PO-45821 ORD-1007 for job 26-1042 have shipped. No remaining items. Order complete.",
  receivedAt: "2026-06-11T16:00:00Z",
};

let passed = 0;
let failed = 0;

function pass(msg) {
  passed++;
  console.log(`  ✓ ${msg}`);
}

function fail(msg, err) {
  failed++;
  console.error(`  ✗ ${msg}`);
  if (err) console.error(`    ${err?.message ?? err}`);
}

console.log("\n=== Unit: conflict + patch shape ===\n");

const patch = buildVendorOrderCompletePatch("2026-06-11T16:00:00Z", 95);
if (
  patch.vendorOrderComplete === true &&
  patch.vendorOrderCompleteSource === "vendor_email" &&
  !("status" in patch) &&
  !("readinessStatus" in patch) &&
  !("physicalDropoffComplete" in patch)
) {
  pass("buildVendorOrderCompletePatch sets Condition 1 only");
} else {
  fail("buildVendorOrderCompletePatch must not set readiness/status/physical fields", patch);
}

const conflictBackorder = hasVendorOrderCompleteApplyConflict(
  { vendorPhysicalDropoffConfirmed: false },
  [{ qtyOrdered: 10, qtyReceived: 10, qtyMissing: 0, qtyDamaged: 0, qtyBackordered: 2 }],
  {
    classification: "vendor_order_complete",
    poNumbers: [],
    orderNumbers: [],
    jobNumbers: [],
    itemLines: [],
    vendorOrderCompleteClaim: true,
  },
);
if (conflictBackorder === "unresolved_backorder_on_items") {
  pass("backorder blocks auto-apply");
} else {
  fail("expected backorder conflict", conflictBackorder);
}

const conflictPhysical = hasVendorOrderCompleteApplyConflict(
  { vendorPhysicalDropoffConfirmed: true },
  [{ qtyOrdered: 10, qtyReceived: 5, qtyMissing: 0, qtyDamaged: 0, qtyBackordered: 0 }],
  {
    classification: "vendor_order_complete",
    poNumbers: [],
    orderNumbers: [],
    jobNumbers: [],
    itemLines: [],
    vendorOrderCompleteClaim: true,
  },
);
if (conflictPhysical === "conflicting_physical_evidence") {
  pass("physical vs email complete blocks auto-apply");
} else {
  fail("expected physical conflict", conflictPhysical);
}

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    host: "127.0.0.1",
    port: 8080,
    rules: readFileSync(RULES_PATH, "utf8"),
  },
});

const clientApp = initializeApp({ projectId: PROJECT_ID });
const db = getFirestore(clientApp);
connectFirestoreEmulator(db, "127.0.0.1", 8080);
const functions = getFunctions(clientApp, "us-central1");
connectFunctionsEmulator(functions, "127.0.0.1", 5001);
const processEmail = httpsCallable(functions, "processInboundVendorEmail");

console.log("\n=== CF: auth gate (emulators) ===\n");

try {
  await processEmail({ message: COMPLETE_EMAIL });
  fail("unauthenticated processInboundVendorEmail should be denied");
} catch (err) {
  const code = err?.code ?? err?.details?.code;
  if (String(code).includes("permission-denied") || String(err?.message).includes("permission")) {
    pass("unauthenticated call denied");
  } else {
    fail("expected permission-denied", err);
  }
}

console.log("\n=== Seed + admin apply simulation ===\n");

const deliveryId = "del-email-write-test";
const itemId = "item-email-write-test";

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "vendors", "vendor-johnstone"), {
    id: "vendor-johnstone",
    name: "Johnstone Supply",
    email: "dispatch@johnstone.com",
    createdAt: "2026-01-01T00:00:00Z",
  });
  await setDoc(doc(db, "jobs", "job-261042"), {
    id: "job-261042",
    jobNumber: "26-1042",
    jobName: "Email write test",
    status: "active",
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
  });
  await setDoc(doc(db, "purchaseOrders", "po-johnstone-45821"), {
    id: "po-johnstone-45821",
    poNumber: "PO-45821",
    jobId: "job-261042",
    vendorId: "vendor-johnstone",
    status: "open",
  });
  await setDoc(doc(db, "deliveries", deliveryId), {
    id: deliveryId,
    orderNumber: "ORD-1007",
    jobId: "job-261042",
    vendorId: "vendor-johnstone",
    purchaseOrderId: "po-johnstone-45821",
    status: "partial",
    stagingLocationId: "loc-g2",
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
  });
  await setDoc(doc(db, "items", itemId), {
    id: itemId,
    deliveryOrderId: deliveryId,
    jobId: "job-261042",
    description: "Duct section",
    qtyOrdered: 4,
    qtyReceived: 0,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "pending",
  });
});

const adminPath = resolve(process.cwd(), "functions/node_modules/firebase-admin");
if (!existsSync(adminPath)) {
  fail("functions/node_modules/firebase-admin missing — run cd functions && npm install");
} else {
  const admin = require(adminPath);
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
  }
  const adminDb = admin.firestore();
  const now = new Date().toISOString();
  await adminDb.collection("deliveries").doc(deliveryId).update({
    ...patch,
    updatedAt: now,
  });
  const after = await getDoc(doc(db, "deliveries", deliveryId));
  const data = after.data();
  if (data?.vendorOrderComplete === true && data?.vendorOrderCompleteSource === "vendor_email") {
    pass("admin Condition 1 patch persisted");
  } else {
    fail("admin patch not persisted", data);
  }
  if (data?.status !== "ready_for_pickup" && data?.readinessStatus !== "ready_for_pickup") {
    pass("email path did not forge ready_for_pickup on delivery doc");
  } else {
    fail("ready_for_pickup must not be set by Condition 1 patch alone", data);
  }
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
await testEnv.cleanup();

if (failed > 0) process.exit(1);
console.log("test:process-inbound-vendor-email PASS");
