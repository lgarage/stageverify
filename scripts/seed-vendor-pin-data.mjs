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
import { computeVendorPinVerifier } from "./vendorPinVerifier.mjs";

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
  { id: "vendor-1", pinCode: "1234", active: true },
  { id: "vendor-2", pinCode: "2345", active: true },
  { id: "vendor-3", pinCode: "3456", active: true },
];

const deliveries = [
  { id: "delivery-1", vendorName: "Johnstone Supply", pin: "1234" },
  { id: "delivery-2", vendorName: "First Supply", pin: "2345" },
  { id: "delivery-3", vendorName: "Ferguson HVAC", pin: "3456" },
  { id: "delivery-demo-vendor-1", vendorName: "Johnstone Supply", pin: "1234" },
  { id: "delivery-demo-vendor-2", vendorName: "Ferguson HVAC", pin: "3456" },
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

for (const delivery of deliveries) {
  await setDoc(
    doc(db, "deliveries", delivery.id),
    {
      vendorName: delivery.vendorName,
      vendorPinVerifier: computeVendorPinVerifier(delivery.id, delivery.pin),
      updatedAt: now,
    },
    { merge: true },
  );
  console.log(`Patched delivery ${delivery.id}`);
}

console.log("Vendor PIN seed complete.");
process.exit(0);
