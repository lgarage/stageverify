/**
 * sendVendorEmail saveVendorEmail validation (Firestore + Functions emulators).
 * Usage: npm run test:send-vendor-email
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { initializeApp } from "firebase/app";
import { connectFirestoreEmulator, doc, getDoc, getFirestore, setDoc } from "firebase/firestore";
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

const TEST_EMAIL = "send-vendor-email-test@stageverify.test";
const TEST_PASSWORD = "StageVerifyTest1!";

let passed = 0;
let failed = 0;

function pass(msg) {
  passed += 1;
  console.log(`  ✓ ${msg}`);
}

function fail(msg, err) {
  failed += 1;
  console.error(`  ✗ ${msg}`);
  if (err) console.error(`    ${err?.message ?? err}`);
}

function expectInvalidArgument(err, label) {
  const code = err?.code ?? "";
  const message = String(err?.message ?? "");
  if (
    code === "functions/invalid-argument" ||
    message.includes("invalid-argument") ||
    message.includes("Confirm save to vendor record") ||
    message.includes("Vendor has no email on file")
  ) {
    pass(label);
    return true;
  }
  fail(label, err);
  return false;
}

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    host: "127.0.0.1",
    port: 8080,
    rules: readFileSync(RULES_PATH, "utf8"),
  },
});

const clientApp = initializeApp(firebaseConfig);
const db = getFirestore(clientApp);
connectFirestoreEmulator(db, "127.0.0.1", 8080);
const auth = getAuth(clientApp);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
const functions = getFunctions(clientApp, "us-central1");
connectFunctionsEmulator(functions, "127.0.0.1", 5001);
const sendVendorEmail = httpsCallable(functions, "sendVendorEmail");

async function readVendorEmail(vendorId) {
  let email = null;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore(), "vendors", vendorId));
    email = snap.exists() ? snap.data()?.email ?? null : null;
  });
  return email;
}

async function seedDelivery(vendorEmail) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const adminDb = ctx.firestore();
    const vendorDoc = {
      id: "vendor-1",
      name: "Test Vendor",
      createdAt: "2026-01-01T00:00:00Z",
    };
    if (vendorEmail !== undefined) {
      vendorDoc.email = vendorEmail;
    }
    await setDoc(doc(adminDb, "vendors", "vendor-1"), vendorDoc);
    await setDoc(doc(adminDb, "jobs", "job-1"), {
      id: "job-1",
      jobNumber: "26-1001",
      jobName: "Send vendor email test",
      status: "active",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await setDoc(doc(adminDb, "deliveries", "del-1"), {
      id: "del-1",
      orderNumber: "ORD-1001",
      vendorId: "vendor-1",
      jobId: "job-1",
      purchaseOrderId: "po-1",
      status: "arrived",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await setDoc(doc(adminDb, "materialIssues", "issue-1"), {
      id: "issue-1",
      deliveryOrderId: "del-1",
      type: "missing",
      status: "open",
      description: "Missing widget",
      createdAt: "2026-01-01T00:00:00Z",
    });
    await setDoc(doc(adminDb, "emailProviderConnections", "gmail"), {
      provider: "gmail",
      status: "connected",
      connectedAccountEmail: "dispatcher@test.example",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await setDoc(doc(adminDb, "emailProviderSecrets", "gmail"), {
      refreshToken: "fake-refresh-token-for-emulator",
      updatedAt: "2026-01-01T00:00:00Z",
    });
  });
}

try {
  await createUserWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
} catch {
  // user may already exist from prior runs
}
await signInWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);

console.log("\n=== sendVendorEmail saveVendorEmail validation ===\n");

await seedDelivery("old-vendor@example.com");

try {
  await sendVendorEmail({
    deliveryOrderId: "del-1",
    materialIssueId: "issue-1",
    to: "new-vendor@example.com",
    subject: "Question about delivery",
    body: "Please confirm ETA.",
  });
  fail("mismatch without saveVendorEmail should reject");
} catch (err) {
  expectInvalidArgument(err, "rejects mismatched To without saveVendorEmail");
}

const emailAfterReject = await readVendorEmail("vendor-1");
if (emailAfterReject === "old-vendor@example.com") {
  pass("vendor email unchanged after rejected mismatch");
} else {
  fail("vendor email should not change on rejected mismatch", emailAfterReject);
}

try {
  await sendVendorEmail({
    deliveryOrderId: "del-1",
    materialIssueId: "issue-1",
    to: "new-vendor@example.com",
    subject: "Question about delivery",
    body: "Please confirm ETA.",
    saveVendorEmail: true,
  });
  fail("saveVendorEmail with fake Gmail token should not succeed send");
} catch (err) {
  const ok =
    String(err?.message ?? "").includes("failed-precondition") ||
    String(err?.message ?? "").includes("internal") ||
    err?.code === "functions/failed-precondition" ||
    err?.code === "functions/internal";
  if (ok) {
    pass("saveVendorEmail true proceeds past mismatch check (fails at Gmail as expected)");
  } else {
    fail("unexpected error after saveVendorEmail", err);
  }
}

await seedDelivery(undefined);

try {
  await sendVendorEmail({
    deliveryOrderId: "del-1",
    to: "first-vendor@example.com",
    subject: "Question",
    body: "Need info.",
  });
  fail("vendor with no email should require saveVendorEmail");
} catch (err) {
  expectInvalidArgument(err, "rejects send when vendor has no email and saveVendorEmail false");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
