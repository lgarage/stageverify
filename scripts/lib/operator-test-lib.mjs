/**
 * Shared emulator guard + helpers for operator console tests.
 */
import { createRequire } from "node:module";
import { initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
} from "firebase/auth";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

const require = createRequire(import.meta.url);
export const admin = require("../../functions/node_modules/firebase-admin");

export const PROJECT_ID = "stageverify-db";
export const PASSWORD = "StageVerifyTest1!";

export function requireFirestoreEmulatorEnv() {
  if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080") {
    console.error("FIRESTORE_EMULATOR_HOST must be 127.0.0.1:8080");
    process.exit(1);
  }
  if (process.env.GCLOUD_PROJECT !== PROJECT_ID) {
    console.error(`GCLOUD_PROJECT must be ${PROJECT_ID}`);
    process.exit(1);
  }
}

export function requireEmulatorEnv() {
  requireFirestoreEmulatorEnv();
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099") {
    console.error("FIREBASE_AUTH_EMULATOR_HOST must be 127.0.0.1:9099");
    process.exit(1);
  }
}

export function initAdminFirestoreOnly() {
  requireFirestoreEmulatorEnv();
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
  }
  return admin.firestore();
}

export function initAdmin() {
  requireEmulatorEnv();
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
  }
  return admin.firestore();
}

const firebaseConfig = {
  apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
  authDomain: "stageverify-db.firebaseapp.com",
  projectId: PROJECT_ID,
  storageBucket: "stageverify-db.firebasestorage.app",
  messagingSenderId: "784751243681",
  appId: "1:784751243681:web:31fa71762b94f878fd1be0",
};

export function createTestClient(label) {
  const app = initializeApp(firebaseConfig, `operator-test-${label}-${Date.now()}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const functions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return { app, auth, functions };
}

export async function createAuthUser(auth, email) {
  const cred = await createUserWithEmailAndPassword(auth, email, PASSWORD);
  return cred.user.uid;
}

export async function signIn(auth, email) {
  await signInWithEmailAndPassword(auth, email, PASSWORD);
}

export function callable(functions, name) {
  return httpsCallable(functions, name);
}

export async function seedOperator(uid, displayName = "Test Operator") {
  const now = new Date().toISOString();
  await admin.firestore().collection("operatorAccounts").doc(uid).set({
    active: true,
    displayName,
    createdAt: now,
    updatedAt: now,
  });
}

export function addr(suffix = "") {
  return {
    line1: `100 Main St${suffix}`,
    line2: "",
    city: "Springfield",
    region: "IL",
    postalCode: "62701",
    country: "US",
  };
}

export function sampleCreatePayload(companyName = "Acme Test Co") {
  return {
    companyName,
    primaryContactName: "Pat",
    primaryContactEmail: "pat@acme.test",
    primaryContactPhone: "555-0100",
    locations: [
      {
        locationName: "HQ",
        physicalAddress: addr(),
        billingSameAsPhysical: true,
        billingContactName: "Billing",
        billingEmail: "billing@acme.test",
        billingPhone: "555-0101",
        groundSpotCount: 2,
        shelfSpotCount: 1,
      },
    ],
    users: [],
    clientOperationId: `op_test_${Date.now()}`,
  };
}

export async function expectHttpsError(label, fn, code, pass, fail) {
  try {
    await fn();
    fail(`${label} — expected ${code}`);
  } catch (err) {
    const got = err?.code || "";
    if (String(got).includes(code)) {
      pass(label);
    } else {
      fail(`${label} — expected ${code}, got ${got}: ${err?.message}`);
    }
  }
}
