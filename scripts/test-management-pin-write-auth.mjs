/**
 * Management PIN write auth — manager gate + admin-access session on PIN change.
 *
 * Usage:
 *   npm run build:functions && npm run test:management-pin-write-auth
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "stageverify-db";
process.env.FUNCTIONS_EMULATOR = "true";
process.env.ACCESS_PIN_ENCRYPTION_KEY = Buffer.alloc(32, 0x42).toString(
  "base64",
);

const root = process.cwd();
const require = createRequire(
  resolve(root, "functions/lib/managementPinWriteAuth.js"),
);

const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

if (getApps().length === 0) {
  initializeApp({ projectId: "stageverify-db" });
}

const { authorizeManagementPinWrite } = require(
  resolve(root, "functions/lib/managementPinWriteAuth.js"),
);
const { pinLookupKeyForPin } = require(
  resolve(root, "functions/lib/accessPinCrypto.js"),
);
const {
  accessPinSecretDocId,
  accessPinUniquenessDocId,
} = require(resolve(root, "functions/lib/accessPinSecretsShared.js"));
const {
  upsertManagementPinDoc,
} = require(resolve(root, "functions/lib/managementPinRegistry.js"));

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

async function setRole(uid, { manager = false } = {}) {
  await getFirestore().collection("dispatcherRoles").doc(uid).set({
    active: true,
    manager,
  });
}

async function clearFixture(pinId) {
  const db = getFirestore();
  const batch = db.batch();
  batch.delete(db.collection("managementPins").doc(pinId));
  batch.delete(
    db.collection("accessPinSecrets").doc(accessPinSecretDocId("management", pinId)),
  );
  const lookupKey = pinLookupKeyForPin("4321");
  batch.delete(
    db
      .collection("accessPinUniqueness")
      .doc(accessPinUniquenessDocId("management", lookupKey)),
  );
  await batch.commit();
}

async function expectDenied(label, fn, code = "permission-denied") {
  let denied = false;
  try {
    await fn();
  } catch (err) {
    denied = err?.code === code;
    if (!denied) {
      fail(`${label} — expected ${code}, got ${err?.code ?? err}`);
      return;
    }
  }
  if (!denied) {
    fail(`${label} — expected rejection`);
    return;
  }
  pass(label);
}

try {
  console.log("\n=== management PIN write auth ===\n");

  const pinId = "mpin-auth-test";
  await clearFixture(pinId);
  await setRole("disp-only", { manager: false });
  await setRole("mgr-ok", { manager: true });

  await expectDenied("non-manager denied when pin provided", () =>
    authorizeManagementPinWrite(
      { auth: { uid: "disp-only" } },
      { id: pinId, pin: "1234" },
    ),
  );

  const initial = await authorizeManagementPinWrite(
    { auth: { uid: "mgr-ok" } },
    { id: pinId, pin: "5678" },
  );
  assert.equal(initial.sessionConsumption, null);
  pass("manager allowed initial PIN assign without session");

  await upsertManagementPinDoc({
    id: pinId,
    pin: "5678",
    label: "Auth test",
    active: true,
    actorUid: initial.actorUid,
    sessionConsumption: initial.sessionConsumption,
  });

  await expectDenied("existing PIN change without session denied", async () => {
    await authorizeManagementPinWrite(
      { auth: { uid: "mgr-ok" } },
      { id: pinId, pin: "9999" },
    );
  });

  await clearFixture(pinId);
} catch (err) {
  fail("management PIN write auth suite", err);
}

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
