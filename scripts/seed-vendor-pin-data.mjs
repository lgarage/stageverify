/**
 * Patches Firestore vendors with demo PINs and deliveries with vendorName.
 * Requires STAGEVERIFY_TEST_EMAIL / STAGEVERIFY_TEST_PASSWORD in .env.local.
 *
 * Usage: node scripts/seed-vendor-pin-data.mjs
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, setDoc } from "firebase/firestore";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    const val = m[2].trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvLocal();

const email = process.env.STAGEVERIFY_TEST_EMAIL;
const password = process.env.STAGEVERIFY_TEST_PASSWORD;
if (!email || !password) {
  console.error("Missing STAGEVERIFY_TEST_EMAIL / STAGEVERIFY_TEST_PASSWORD in .env.local");
  process.exit(1);
}

const app = initializeApp({
  apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
  authDomain: "stageverify-db.firebaseapp.com",
  projectId: "stageverify-db",
  storageBucket: "stageverify-db.firebasestorage.app",
  messagingSenderId: "784751243681",
  appId: "1:784751243681:web:31fa71762b94f878fd1be0",
});

const auth = getAuth(app);
const db = getFirestore(app);

const vendors = [
  {
    id: "vendor-1",
    pinCode: "1234",
    active: true,
    companyWideSessionEnabled: true,
  },
  { id: "vendor-2", pinCode: "2345", active: true },
  { id: "vendor-3", pinCode: "3456", active: true },
];

const jobs = [
  { id: "job-1", pinCode: "1234" },
  { id: "job-2", pinCode: "5678" },
];

const stagingLocations = [
  { id: "staging-1", code: "G1", label: "Ground Spot 1", type: "ground", status: "Active", sortOrder: 1 },
  { id: "staging-2", code: "G2", label: "Ground Spot 2", type: "ground", status: "Active", sortOrder: 2 },
  { id: "staging-3", code: "S1-A", label: "Shelf 1 - Bin A", type: "shelf", status: "Active", sortOrder: 3 },
];

const deliveries = [
  { id: "delivery-1", vendorName: "Johnstone Supply" },
  { id: "delivery-2", vendorName: "Johnstone Supply" },
  { id: "delivery-3", vendorName: "Johnstone Supply" },
  {
    id: "delivery-demo-vendor-1",
    vendorName: "Johnstone Supply",
    stagingLocationId: "staging-1",
    plannedStagingLocationIds: ["staging-1", "staging-2", "staging-3"],
    status: "pending",
  },
  { id: "delivery-demo-vendor-2", vendorName: "Johnstone Supply", status: "shipped" },
  {
    id: "delivery-cross-vendor-1",
    orderNumber: "ORD-007",
    jobId: "job-3",
    vendorId: "vendor-3",
    vendorName: "Ferguson HVAC",
    purchaseOrderId: "po-3",
    deliveryDate: "2026-06-02",
    stagingLocationId: "staging-2",
    plannedStagingLocationIds: ["staging-2"],
    status: "pending",
    issueSummary: "",
    notes: "Ferguson cross-vendor fixture — must stay absent for job-1 PIN (D14).",
  },
];

const now = new Date().toISOString();

await signInWithEmailAndPassword(auth, email, password);

for (const vendor of vendors) {
  await setDoc(
    doc(db, "vendors", vendor.id),
    { pinCode: vendor.pinCode, active: vendor.active, updatedAt: now },
    { merge: true },
  );
  console.log(`Patched vendor ${vendor.id}`);
}

for (const job of jobs) {
  await setDoc(
    doc(db, "jobs", job.id),
    { pinCode: job.pinCode, updatedAt: now },
    { merge: true },
  );
  console.log(`Patched job ${job.id} pinCode`);
}

for (const loc of stagingLocations) {
  await setDoc(
    doc(db, "stagingLocations", loc.id),
    { ...loc, updatedAt: now },
    { merge: true },
  );
  console.log(`Patched staging location ${loc.code}`);
}

for (const delivery of deliveries) {
  const { id, ...fields } = delivery;
  await setDoc(
    doc(db, "deliveries", id),
    {
      ...fields,
      updatedAt: now,
    },
    { merge: true },
  );
  console.log(`Patched delivery ${id}`);
}

console.log("Vendor PIN seed complete.");
process.exit(0);
