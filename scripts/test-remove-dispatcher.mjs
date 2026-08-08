/**
 * Emulator tests for removeDispatcher (inactive Manager/Dispatcher permanent removal).
 * Usage: npm run test:remove-dispatcher
 */
import assert from "node:assert/strict";
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
const admin = require("../functions/node_modules/firebase-admin");

const PROJECT_ID = "stageverify-db";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}

const firebaseConfig = {
  apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
  authDomain: "stageverify-db.firebaseapp.com",
  projectId: PROJECT_ID,
  storageBucket: "stageverify-db.firebasestorage.app",
  messagingSenderId: "784751243681",
  appId: "1:784751243681:web:31fa71762b94f878fd1be0",
};

const PASSWORD = "StageVerifyTest1!";
const stamp = Date.now();

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

const clientApp = initializeApp(firebaseConfig, `remove-dispatcher-${stamp}`);
const auth = getAuth(clientApp);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
const functions = getFunctions(clientApp, "us-central1");
connectFunctionsEmulator(functions, "127.0.0.1", 5001);

const removeDispatcher = httpsCallable(functions, "removeDispatcher");
const listDispatchers = httpsCallable(functions, "listDispatchers");

async function createAuthUser(email) {
  const cred = await createUserWithEmailAndPassword(auth, email, PASSWORD);
  return cred.user.uid;
}

async function setRole(uid, fields) {
  await admin.firestore().collection("dispatcherRoles").doc(uid).set(
    {
      email: fields.email,
      active: fields.active !== false,
      manager: fields.manager === true,
      updatedAt: new Date().toISOString(),
      ...fields.extra,
    },
    { merge: true },
  );
}

async function expectHttpsError(label, fn, code) {
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

try {
  console.log("\n=== removeDispatcher emulator ===\n");

  const managerEmail = `mgr-remove-${stamp}@test.local`;
  const targetEmail = `disp-remove-${stamp}@test.local`;
  const activeEmail = `disp-active-${stamp}@test.local`;
  const nonMgrEmail = `disp-only-${stamp}@test.local`;
  const protectedEmail = "test@stageverify.dev"; // pragma: allowlist secret — fixture allowlist email

  const managerUid = await createAuthUser(managerEmail);
  const targetUid = await createAuthUser(targetEmail);
  const activeUid = await createAuthUser(activeEmail);
  const nonMgrUid = await createAuthUser(nonMgrEmail);
  const protectedUid = await createAuthUser(
    `protected-alias-${stamp}@test.local`,
  );

  await setRole(managerUid, {
    email: managerEmail,
    active: true,
    manager: true,
  });
  await setRole(targetUid, {
    email: targetEmail,
    active: false,
    manager: false,
  });
  await setRole(activeUid, {
    email: activeEmail,
    active: true,
    manager: false,
  });
  await setRole(nonMgrUid, {
    email: nonMgrEmail,
    active: true,
    manager: false,
  });
  // Role email is the protected identity (Auth email can differ for seed).
  await setRole(protectedUid, {
    email: protectedEmail,
    active: false,
    manager: false,
  });

  // Sanity fixtures that must stay untouched
  const techRef = admin.firestore().collection("technicians").doc("tech-remove-sanity");
  const vendorRef = admin.firestore().collection("vendors").doc("vendor-remove-sanity");
  await techRef.set({ name: "Sanity Tech", active: true });
  await vendorRef.set({ name: "Sanity Vendor", active: true });
  const techBefore = (await techRef.get()).data();
  const vendorBefore = (await vendorRef.get()).data();

  await signInWithEmailAndPassword(auth, nonMgrEmail, PASSWORD);
  await expectHttpsError(
    "non-manager denied",
    () => removeDispatcher({ uid: targetUid }),
    "permission-denied",
  );

  await signInWithEmailAndPassword(auth, managerEmail, PASSWORD);

  await expectHttpsError(
    "active account blocked",
    () => removeDispatcher({ uid: activeUid }),
    "failed-precondition",
  );
  const activeStill = await admin.auth().getUser(activeUid);
  assert.ok(activeStill.uid);
  pass("active Auth user unchanged after blocked remove");

  await expectHttpsError(
    "self-remove blocked",
    () => removeDispatcher({ uid: managerUid }),
    "failed-precondition",
  );

  await expectHttpsError(
    "protected email blocked",
    () => removeDispatcher({ uid: protectedUid }),
    "failed-precondition",
  );
  const protectedStill = await admin.auth().getUser(protectedUid);
  assert.ok(protectedStill.uid);
  pass("protected Auth user unchanged");

  const result = await removeDispatcher({ uid: targetUid });
  assert.equal(result.data.success, true);
  assert.equal(result.data.uid, targetUid);
  pass("manager removes inactive dispatcher");

  try {
    await admin.auth().getUser(targetUid);
    fail("Auth user should be deleted");
  } catch (err) {
    if (String(err?.code).includes("auth/user-not-found")) {
      pass("Auth user deleted");
    } else {
      fail("Auth delete check", err);
    }
  }

  const tombstone = await admin
    .firestore()
    .collection("dispatcherRoles")
    .doc(targetUid)
    .get();
  assert.equal(tombstone.exists, true);
  assert.equal(tombstone.data().removed, true);
  assert.equal(tombstone.data().active, false);
  assert.equal(tombstone.data().removedBy, managerUid);
  pass("role doc tombstoned with history fields");

  const listed = await listDispatchers({});
  const ids = (listed.data.dispatchers || []).map((d) => d.uid);
  assert.equal(ids.includes(targetUid), false);
  pass("listDispatchers excludes removed uid");

  await expectHttpsError(
    "double-remove blocked",
    () => removeDispatcher({ uid: targetUid }),
    "failed-precondition",
  );

  const auditSnap = await admin
    .firestore()
    .collection("pinAccessAudit")
    .where("action", "==", "dispatcher_removed")
    .where("targetId", "==", targetUid)
    .get();
  assert.equal(auditSnap.size, 1);
  assert.equal(auditSnap.docs[0].data().targetType, "dispatcher");
  assert.equal(auditSnap.docs[0].data().actorUid, managerUid);
  pass("pinAccessAudit dispatcher_removed written");

  const techAfter = (await techRef.get()).data();
  const vendorAfter = (await vendorRef.get()).data();
  assert.deepEqual(techAfter, techBefore);
  assert.deepEqual(vendorAfter, vendorBefore);
  pass("technician/vendor docs untouched");

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
} catch (err) {
  console.error("FATAL:", err);
  process.exit(1);
}
