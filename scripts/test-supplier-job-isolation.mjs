/**
 * Two suppliers (Ferguson + Johnstone) on one job — each sees only their deliveries.
 * Usage: npm run test:supplier-job-isolation
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { initializeApp } from "firebase/app";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { doc, setDoc } from "firebase/firestore";
import { createHash } from "crypto";

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

const JOB_ID = "supplier_job_iso_job1";
const FERGUSON_ID = "supplier_job_iso_ferguson";
const JOHNSTONE_ID = "supplier_job_iso_johnstone";
const FERGUSON_DEL = "supplier_job_iso_del_ferg";
const JOHNSTONE_DEL = "supplier_job_iso_del_john";

function sessionToken(vendorId) {
  return createHash("sha256").update(`job-session:${vendorId}`).digest("hex");
}

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    host: "127.0.0.1",
    port: 8080,
    rules: readFileSync(RULES_PATH, "utf8"),
  },
});

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "jobs", JOB_ID), {
    id: JOB_ID,
    jobNumber: "J-2",
    jobName: "Shared Job",
    status: "active",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  const common = {
    jobId: JOB_ID,
    status: "arrived",
    updatedAt: "2026-01-02T00:00:00Z",
    createdAt: "2026-01-01T00:00:00Z",
  };
  await setDoc(doc(db, "deliveries", FERGUSON_DEL), {
    id: FERGUSON_DEL,
    orderNumber: "FERG-ORD",
    vendorId: FERGUSON_ID,
    vendorName: "Ferguson",
    ...common,
  });
  await setDoc(doc(db, "deliveries", JOHNSTONE_DEL), {
    id: JOHNSTONE_DEL,
    orderNumber: "JOHN-ORD",
    vendorId: JOHNSTONE_ID,
    vendorName: "Johnstone Supply",
    ...common,
  });
  const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
  for (const [vendorId, deliveryId, name] of [
    [FERGUSON_ID, FERGUSON_DEL, "Ferguson"],
    [JOHNSTONE_ID, JOHNSTONE_DEL, "Johnstone Supply"],
  ]) {
    const token = sessionToken(vendorId);
    await setDoc(doc(db, "vendorSessions", token), {
      id: token,
      deliveryId,
      vendorId,
      vendorName: name,
      jobId: JOB_ID,
      sessionScope: "job",
      expiresAt,
    });
  }
});

const clientApp = initializeApp(firebaseConfig);
const functions = getFunctions(clientApp, "us-central1");
connectFunctionsEmulator(functions, "127.0.0.1", 5001);
const getJobVendorDeliveries = httpsCallable(functions, "getJobVendorDeliveries");

async function listFor(vendorId) {
  const res = await getJobVendorDeliveries({
    jobId: JOB_ID,
    sessionToken: sessionToken(vendorId),
  });
  return res.data?.deliveries ?? [];
}

const fergusonList = await listFor(FERGUSON_ID);
if (fergusonList.length !== 1 || fergusonList[0].deliveryId !== FERGUSON_DEL) {
  console.error("FAIL: Ferguson job list leaked or missed delivery", fergusonList);
  process.exit(1);
}

const johnstoneList = await listFor(JOHNSTONE_ID);
if (johnstoneList.length !== 1 || johnstoneList[0].deliveryId !== JOHNSTONE_DEL) {
  console.error("FAIL: Johnstone job list leaked or missed delivery", johnstoneList);
  process.exit(1);
}

const getVendorStagingOccupancy = httpsCallable(functions, "getVendorStagingOccupancy");
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "stagingLocations", "supplier_job_iso_loc1"), {
    id: "supplier_job_iso_loc1",
    code: "A1",
    name: "Bay A1",
  });
  await setDoc(doc(db, "deliveries", FERGUSON_DEL), {
    stagingLocationId: "supplier_job_iso_loc1",
  }, { merge: true });
  await setDoc(doc(db, "deliveries", JOHNSTONE_DEL), {
    stagingLocationId: "supplier_job_iso_loc2",
  }, { merge: true });
  await setDoc(doc(db, "stagingLocations", "supplier_job_iso_loc2"), {
    id: "supplier_job_iso_loc2",
    code: "B2",
    name: "Bay B2",
  });
});

const occRes = await getVendorStagingOccupancy({
  deliveryId: FERGUSON_DEL,
  sessionToken: sessionToken(FERGUSON_ID),
});
const johnOcc = occRes.data?.occupancy?.supplier_job_iso_loc2;
if (johnOcc?.orderNumber !== "Occupied" || johnOcc?.vendorName) {
  console.error("FAIL: Ferguson occupancy exposed Johnstone order details", johnOcc);
  process.exit(1);
}

console.log("test-supplier-job-isolation: PASS");
await testEnv.cleanup();