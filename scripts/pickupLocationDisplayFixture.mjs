/**
 * Harness-only: set delivery-3 location display fields for Slice 2 Playwright proof.
 * Uses authenticated Firestore writes (same pattern as seed-vendor-demo-deliveries.mjs).
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  deleteField,
  doc,
  getFirestore,
  setDoc,
  updateDoc,
} from "firebase/firestore";

const VERIFY_STAGING_G4 = "verify-staging-g4";
const VERIFY_STAGING_G5 = "verify-staging-g5";
const PRIMARY_STAGING_ID = "staging-1";

const firebaseConfig = {
  apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
  authDomain: "stageverify-db.firebaseapp.com",
  projectId: "stageverify-db",
  storageBucket: "stageverify-db.firebasestorage.app",
  messagingSenderId: "784751243681",
  appId: "1:784751243681:web:31fa71762b94f878fd1be0",
};

let dbPromise;

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

async function getDb() {
  if (!dbPromise) {
    loadEnvLocal();
    const email = process.env.STAGEVERIFY_TEST_EMAIL;
    const password = process.env.STAGEVERIFY_TEST_PASSWORD;
    if (!email || !password) {
      throw new Error(
        "Missing STAGEVERIFY_TEST_EMAIL / STAGEVERIFY_TEST_PASSWORD in .env.local",
      );
    }
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    await signInWithEmailAndPassword(auth, email, password);
    dbPromise = getFirestore(app);
  }
  return dbPromise;
}

async function ensureVerifyStagingZones() {
  const db = await getDb();
  const now = new Date().toISOString();
  for (const [id, code, label] of [
    [VERIFY_STAGING_G4, "G4", "Verify Ground 4"],
    [VERIFY_STAGING_G5, "G5", "Verify Ground 5"],
  ]) {
    await setDoc(
      doc(db, "stagingLocations", id),
      {
        id,
        code,
        label,
        type: "ground",
        status: "Active",
        sortOrder: 90,
        widthFt: 4,
        depthFt: 4,
        updatedAt: now,
      },
      { merge: true },
    );
  }
}

/** Full Slice 2 display: primary G1 + Also check G4,G5 + Find it at + Shop stock. */
export async function applyFullLocationDisplay(deliveryId) {
  await ensureVerifyStagingZones();
  const db = await getDb();
  const now = new Date().toISOString();
  await updateDoc(doc(db, "deliveries", deliveryId), {
    stagingLocationId: PRIMARY_STAGING_ID,
    additionalStagingLocationIds: [VERIFY_STAGING_G4, VERIFY_STAGING_G5],
    currentLocationNote: "Receiving dock",
    shopStockLocationNote: "Main stock room",
    shopStockPickListItems: ["Verify shop stock item A"],
    updatedAt: now,
  });
}

/** Minimal display: primary only — no extras, blank notes. */
export async function applyMinimalLocationDisplay(deliveryId) {
  const db = await getDb();
  const now = new Date().toISOString();
  await updateDoc(doc(db, "deliveries", deliveryId), {
    stagingLocationId: PRIMARY_STAGING_ID,
    additionalStagingLocationIds: [],
    currentLocationNote: deleteField(),
    shopStockLocationNote: deleteField(),
    updatedAt: now,
  });
}
