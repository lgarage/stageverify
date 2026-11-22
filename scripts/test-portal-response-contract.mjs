/**
 * Portal CF responses must not include job PINs, internal notes, or unknown fields.
 * Usage: npm run test:portal-response-contract
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { initializeApp } from "firebase/app";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { doc, setDoc } from "firebase/firestore";
import {
  seedVendorSession,
  vendorSessionTokenFor,
} from "./test-vendor-session-helper.mjs";

const PROJECT_ID = "stageverify-db";
const RULES_PATH = resolve(process.cwd(), "firestore.rules");

const firebaseConfig = {
  apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
  authDomain: "stageverify-db.firebaseapp.com",
  projectId: PROJECT_ID,
  storageBucket: "stageverify-db.firebasestorage.app",
  messagingSenderId: "784751243681",
  appId: "1:784751243681:web:31fa71762b94f878fd1be0",
};

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    host: "127.0.0.1",
    port: 8080,
    rules: readFileSync(RULES_PATH, "utf8"),
  },
});

const clientApp = initializeApp(firebaseConfig);
const functions = getFunctions(clientApp, "us-central1");
connectFunctionsEmulator(functions, "127.0.0.1", 5001);
const getVendorReceiveDetails = httpsCallable(functions, "getVendorReceiveDetails");

const DELIVERY_ID = "portal_response_del_1";
const JOB_ID = "portal_response_job_1";
const VENDOR_ID = "portal_response_vendor_1";

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "jobs", JOB_ID), {
    id: JOB_ID,
    jobNumber: "J-SENTINEL",
    jobName: "Sentinel Job",
    status: "active",
    pinCode: "9999",
    pinHash: "salt:deadbeef",
    internalRolloutNote: "must-not-leak",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  await setDoc(doc(db, "deliveries", DELIVERY_ID), {
    id: DELIVERY_ID,
    orderNumber: "ORD-1",
    status: "arrived",
    vendorId: VENDOR_ID,
    vendorName: "Test Vendor",
    jobId: JOB_ID,
    notes: "dispatcher-secret",
    vendorPinVerifier: "hidden",
    mysteryField: "unknown",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  await setDoc(doc(db, "items", "portal_response_item_1"), {
    id: "portal_response_item_1",
    deliveryOrderId: DELIVERY_ID,
    description: "Coil",
    qtyOrdered: 1,
    qtyReceived: 0,
    status: "pending",
    internalCost: 500,
    itemNotes: "secret",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
});

const sessionToken = vendorSessionTokenFor(DELIVERY_ID);
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "vendorSessions", sessionToken), {
    id: sessionToken,
    deliveryId: DELIVERY_ID,
    vendorId: VENDOR_ID,
    vendorName: "Test Vendor",
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    sessionScope: "delivery",
  });
});

const { data } = await getVendorReceiveDetails({
  deliveryId: DELIVERY_ID,
  sessionToken,
});

function assertAbsent(obj, key, label) {
  if (obj && Object.prototype.hasOwnProperty.call(obj, key)) {
    console.error(`FAIL: ${label} leaked ${key}`);
    process.exit(1);
  }
}

assertAbsent(data.job, "pinCode", "job");
assertAbsent(data.job, "pinHash", "job");
assertAbsent(data.job, "internalRolloutNote", "job");
assertAbsent(data.delivery, "notes", "delivery");
assertAbsent(data.delivery, "vendorPinVerifier", "delivery");
assertAbsent(data.delivery, "mysteryField", "delivery");
assertAbsent(data.items?.[0], "internalCost", "item");
assertAbsent(data.items?.[0], "itemNotes", "item");

if (!data.job?.jobName || data.job.jobNumber !== "J-SENTINEL") {
  console.error("FAIL: expected allowlisted job fields missing");
  process.exit(1);
}

console.log("test-portal-response-contract: PASS");
await testEnv.cleanup();