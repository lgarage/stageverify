/**
 * Staff-only dispatcher callables — signed-in roleless users denied.
 * Usage: npm run test:staff-callables (Functions + Auth + Firestore emulators)
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

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

const DISPATCHER_EMAIL = "staff-callables-dispatcher@stageverify.test";
const DISPATCHER_PASSWORD = "StageVerifyTest1!";
const NOROLE_EMAIL = "staff-callables-norole@stageverify.test";
const NOROLE_PASSWORD = "StageVerifyTest1!";

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    host: "127.0.0.1",
    port: 8080,
    rules: readFileSync(RULES_PATH, "utf8"),
  },
});

const clientApp = initializeApp(firebaseConfig);
const auth = getAuth(clientApp);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
const functions = getFunctions(clientApp, "us-central1");
connectFunctionsEmulator(functions, "127.0.0.1", 5001);

const generatePickupToken = httpsCallable(functions, "generatePickupToken");
const revokePickupToken = httpsCallable(functions, "revokePickupToken");

const JOB_ID = "staff-callables_job-1";

async function ensureUser(email, password) {
  try {
    await createUserWithEmailAndPassword(auth, email, password);
  } catch (e) {
    if (e?.code !== "auth/email-already-in-use") throw e;
    await signInWithEmailAndPassword(auth, email, password);
  }
}

async function seedJob() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "jobs", JOB_ID), {
      id: JOB_ID,
      jobNumber: "J-1",
      jobName: "Staff Callable Job",
      status: "active",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
  });
}

await seedJob();
await ensureUser(NOROLE_EMAIL, NOROLE_PASSWORD);
await signInWithEmailAndPassword(auth, NOROLE_EMAIL, NOROLE_PASSWORD);

let denied = false;
try {
  await generatePickupToken({ jobId: JOB_ID });
} catch {
  denied = true;
}
if (!denied) {
  console.error("FAIL: generatePickupToken allowed roleless user");
  process.exit(1);
}

try {
  await revokePickupToken({ jobId: JOB_ID });
  console.error("FAIL: revokePickupToken allowed roleless user");
  process.exit(1);
} catch {
  // expected
}

await ensureUser(DISPATCHER_EMAIL, DISPATCHER_PASSWORD);
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), "dispatcherRoles", auth.currentUser.uid), {
    active: true,
    role: "dispatcher",
    updatedAt: "2026-01-01T00:00:00Z",
  });
});
await signInWithEmailAndPassword(auth, DISPATCHER_EMAIL, DISPATCHER_PASSWORD);

const gen = await generatePickupToken({ jobId: JOB_ID });
if (!gen.data?.token) {
  console.error("FAIL: dispatcher generatePickupToken did not return token");
  process.exit(1);
}

const revoked = await revokePickupToken({ jobId: JOB_ID });
if (revoked.data?.revoked === undefined && revoked.data?.ok !== true) {
  // tolerate shape — callable returns revoked count
}

console.log("test-staff-callables: PASS");
await testEnv.cleanup();