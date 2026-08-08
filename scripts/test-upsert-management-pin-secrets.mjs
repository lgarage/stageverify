/**
 * upsertManagementPinDoc — accessPinSecrets sync when PIN changes.
 *
 * Usage:
 *   npm run build:functions && npm run test:upsert-management-pin-secrets
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
  resolve(root, "functions/lib/managementPinRegistry.js"),
);

const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

if (getApps().length === 0) {
  initializeApp({ projectId: "stageverify-db" });
}

const {
  upsertManagementPinDoc,
  resolveManagementPinMatch,
  normalizeManagementPinPermissions,
} = require(resolve(root, "functions/lib/managementPinRegistry.js"));
const {
  encryptPinForStorage,
  pinLookupKeyForPin,
} = require(resolve(root, "functions/lib/accessPinCrypto.js"));
const { hashPinForStorage } = require(resolve(root, "functions/lib/pinHashing.js"));
const {
  accessPinSecretDocId,
  accessPinUniquenessDocId,
} = require(resolve(root, "functions/lib/accessPinSecretsShared.js"));

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

async function clearFixture(pinId) {
  const db = getFirestore();
  const batch = db.batch();
  batch.delete(db.collection("managementPins").doc(pinId));
  batch.delete(
    db.collection("accessPinSecrets").doc(accessPinSecretDocId("management", pinId)),
  );
  const oldKey = pinLookupKeyForPin("1111");
  const newKey = pinLookupKeyForPin("2222");
  batch.delete(
    db
      .collection("accessPinUniqueness")
      .doc(accessPinUniquenessDocId("management", oldKey)),
  );
  batch.delete(
    db
      .collection("accessPinUniqueness")
      .doc(accessPinUniquenessDocId("management", newKey)),
  );
  await batch.commit();
}

try {
  console.log("\n=== upsertManagementPinDoc accessPinSecrets sync ===\n");

  const pinId = "mpin-test-secrets-sync";
  await clearFixture(pinId);

  const db = getFirestore();
  const now = new Date().toISOString();
  const oldPin = "1111";
  const newPin = "2222";

  await db.collection("managementPins").doc(pinId).set({
    id: pinId,
    label: "Test PIN",
    active: true,
    pinConfigured: true,
    permissions: normalizeManagementPinPermissions(null),
    createdAt: now,
    updatedAt: now,
  });

  const oldLookupKey = pinLookupKeyForPin(oldPin);
  await db
    .collection("accessPinSecrets")
    .doc(accessPinSecretDocId("management", pinId))
    .set({
      targetType: "management",
      targetId: pinId,
      pinHash: hashPinForStorage(oldPin),
      pinEncrypted: encryptPinForStorage(oldPin),
      pinLookupKey: oldLookupKey,
      revealable: true,
      updatedAt: now,
    });
  await db
    .collection("accessPinUniqueness")
    .doc(accessPinUniquenessDocId("management", oldLookupKey))
    .set({
      targetType: "management",
      targetId: pinId,
      updatedAt: now,
    });

  const beforeOld = await resolveManagementPinMatch(oldPin);
  assert.ok(beforeOld);
  assert.equal(beforeOld.id, pinId);
  pass("old PIN matches via accessPinSecrets before upsert");

  await upsertManagementPinDoc({
    id: pinId,
    pin: newPin,
    label: "Test PIN",
    active: true,
  });

  const afterOld = await resolveManagementPinMatch(oldPin);
  assert.equal(afterOld, null);
  pass("old PIN no longer matches after upsert with new pin");

  const afterNew = await resolveManagementPinMatch(newPin);
  assert.ok(afterNew);
  assert.equal(afterNew.id, pinId);
  pass("new PIN matches via accessPinSecrets after upsert");

  const mgmtSnap = await db.collection("managementPins").doc(pinId).get();
  const mgmtData = mgmtSnap.data();
  assert.equal(mgmtData.pinConfigured, true);
  assert.equal(mgmtData.pinHash, undefined);
  pass("managementPins doc strips pinHash and sets pinConfigured");

  await upsertManagementPinDoc({
    id: pinId,
    label: "Renamed only",
    permissions: { catchAllCheckIn: false },
  });

  const stillNew = await resolveManagementPinMatch(newPin);
  assert.ok(stillNew);
  assert.equal(stillNew.label, "Renamed only");
  assert.equal(stillNew.permissions.catchAllCheckIn, false);
  pass("label-only upsert does not invalidate current PIN secrets");

  await clearFixture(pinId);
} catch (err) {
  fail("upsertManagementPinDoc secrets sync", err);
}

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
