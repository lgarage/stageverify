/**
 * Sets appSettings.vendorDeliveryMode for vendor E2E scripts.
 *
 * Usage:
 *   node scripts/set-vendor-delivery-mode.mjs full_checkin
 *   node scripts/set-vendor-delivery-mode.mjs exception_only
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

const mode = process.argv[2];
if (mode !== "full_checkin" && mode !== "exception_only") {
  console.error("Usage: node scripts/set-vendor-delivery-mode.mjs <full_checkin|exception_only>");
  process.exit(1);
}

const email = process.env.STAGEVERIFY_TEST_EMAIL;
const password = process.env.STAGEVERIFY_TEST_PASSWORD;
if (!email || !password) {
  console.error("Missing STAGEVERIFY_TEST_EMAIL / STAGEVERIFY_TEST_PASSWORD");
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

await signInWithEmailAndPassword(auth, email, password);
await setDoc(
  doc(db, "appSettings", "config"),
  { vendorDeliveryMode: mode },
  { merge: true },
);
console.log(`appSettings.vendorDeliveryMode = ${mode}`);
process.exit(0);
