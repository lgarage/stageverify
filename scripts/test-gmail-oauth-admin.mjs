/**
 * Gmail integration management requires active Admin role.
 * Google APIs are not called — expects failed-precondition when OAuth secrets absent.
 * Usage: npm run test:gmail-oauth-admin
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

const DISPATCHER_EMAIL = "gmail-oauth-dispatcher@stageverify.test";
const ADMIN_EMAIL = "gmail-oauth-admin@stageverify.test";
const PASSWORD = "StageVerifyTest1!";

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

const initiate = httpsCallable(functions, "initiateGmailOAuth");
const disconnect = httpsCallable(functions, "disconnectGmailOAuth");
const registerWatch = httpsCallable(functions, "registerGmailWatchCallable");

async function ensureUser(email) {
  try {
    await createUserWithEmailAndPassword(auth, email, PASSWORD);
  } catch (e) {
    if (e?.code !== "auth/email-already-in-use") throw e;
    await signInWithEmailAndPassword(auth, email, PASSWORD);
  }
}

async function seedRole(uid, role) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "dispatcherRoles", uid), {
      active: true,
      role,
      updatedAt: "2026-01-01T00:00:00Z",
    });
  });
}

await ensureUser(DISPATCHER_EMAIL);
await seedRole(auth.currentUser.uid, "dispatcher");
await signInWithEmailAndPassword(auth, DISPATCHER_EMAIL, PASSWORD);

let denied = false;
try {
  await initiate({});
} catch (e) {
  denied = e?.code === "functions/permission-denied";
}
if (!denied) {
  console.error("FAIL: dispatcher allowed initiateGmailOAuth");
  process.exit(1);
}

try {
  await disconnect({});
  console.error("FAIL: dispatcher allowed disconnectGmailOAuth");
  process.exit(1);
} catch (e) {
  if (e?.code !== "functions/permission-denied") {
    console.error("FAIL: unexpected disconnect error", e);
    process.exit(1);
  }
}

await ensureUser(ADMIN_EMAIL);
await seedRole(auth.currentUser.uid, "admin");
await signInWithEmailAndPassword(auth, ADMIN_EMAIL, PASSWORD);

let adminInitiateOk = false;
try {
  const res = await initiate({
    returnUrl: "http://localhost:5173/stageverify/#/settings",
  });
  adminInitiateOk = Boolean(res.data?.authUrl || res.data?.state);
} catch (e) {
  adminInitiateOk =
    e?.code === "functions/failed-precondition" ||
    String(e?.message ?? "").includes("not configured");
}
if (!adminInitiateOk) {
  console.error("FAIL: admin initiate was denied or returned empty payload");
  process.exit(1);
}

try {
  await registerWatch({});
} catch (e) {
  if (
    e?.code !== "functions/failed-precondition" &&
    e?.code !== "functions/permission-denied"
  ) {
    console.error("FAIL: unexpected registerWatch error", e);
    process.exit(1);
  }
}

console.log("test-gmail-oauth-admin: PASS");
await testEnv.cleanup();