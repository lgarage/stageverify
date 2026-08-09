/**
 * PIN rotate transaction — proves all-reads-before-all-writes on uniqueness cleanup.
 * Repro: existing revealable secret → rotate to a different PIN (Johnstone Save path).
 *
 * Usage: npm run test:access-pin-rotate-transaction
 * No plaintext PIN values are logged.
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
  resolve(root, "functions/lib/accessPinSecretWrite.js"),
);
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp({ projectId: "stageverify-db" });

const {
  prepareAccessPinSecretWrite,
  applyAccessPinSecretWriteInTransaction,
} = require(resolve(root, "functions/lib/accessPinSecretWrite.js"));
const {
  decryptPinFromStorage,
  pinLookupKeyForPin,
} = require(resolve(root, "functions/lib/accessPinCrypto.js"));
const {
  accessPinSecretDocId,
  accessPinUniquenessDocId,
  ACCESS_PIN_UNIQUENESS_COLLECTION,
  ACCESS_PIN_SECRETS_COLLECTION,
} = require(resolve(root, "functions/lib/accessPinSecretsShared.js"));

const VENDOR_ID = "vendor-rotate-tx-test";
const PIN_A = "1111";
const PIN_B = "2222";

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

async function runApply(targetType, targetId, pin) {
  const db = getFirestore();
  const refs = prepareAccessPinSecretWrite(targetType, targetId, pin);
  const now = new Date().toISOString();
  await db.runTransaction(async (tx) => {
    const entitySnap = await tx.get(refs.entityRef);
    const existingSecretSnap = await tx.get(refs.secretRef);
    const uniquenessSnap = await tx.get(refs.uniquenessRef);
    const legacyUniquenessSnaps = await Promise.all(
      refs.legacyUniquenessRefs.map((ref) => tx.get(ref)),
    );
    await applyAccessPinSecretWriteInTransaction(tx, db, {
      targetType,
      targetId,
      pin,
      now,
      refs,
      existingSecretSnap,
      uniquenessSnap,
      legacyUniquenessSnaps,
      entitySnap,
    });
  });
}

async function cleanup() {
  const db = getFirestore();
  const batch = db.batch();
  batch.delete(db.collection("vendors").doc(VENDOR_ID));
  batch.delete(
    db
      .collection(ACCESS_PIN_SECRETS_COLLECTION)
      .doc(accessPinSecretDocId("vendor", VENDOR_ID)),
  );
  for (const pin of [PIN_A, PIN_B]) {
    const key = pinLookupKeyForPin(pin);
    batch.delete(
      db
        .collection(ACCESS_PIN_UNIQUENESS_COLLECTION)
        .doc(accessPinUniquenessDocId(key)),
    );
  }
  await batch.commit().catch(() => undefined);
}

try {
  console.log("\n=== access PIN rotate transaction ===\n");
  const db = getFirestore();
  await cleanup();

  await db.collection("vendors").doc(VENDOR_ID).set({
    id: VENDOR_ID,
    name: "Rotate Tx Vendor",
    active: true,
    updatedAt: new Date().toISOString(),
  });

  await runApply("vendor", VENDOR_ID, PIN_A);
  const secretAfterA = await db
    .collection(ACCESS_PIN_SECRETS_COLLECTION)
    .doc(accessPinSecretDocId("vendor", VENDOR_ID))
    .get();
  assert.equal(secretAfterA.exists, true);
  const dataA = secretAfterA.data();
  assert.equal(dataA.revealable, true);
  assert.equal(decryptPinFromStorage(dataA.pinEncrypted).length, PIN_A.length);
  assert.equal(decryptPinFromStorage(dataA.pinEncrypted), PIN_A);
  const uniqA = await db
    .collection(ACCESS_PIN_UNIQUENESS_COLLECTION)
    .doc(accessPinUniquenessDocId(pinLookupKeyForPin(PIN_A)))
    .get();
  assert.equal(uniqA.exists, true);
  pass("initial assign commits (no existing secret)");

  const updatedAtA = dataA.updatedAt;

  // Load-bearing: rotate revealable PIN — pre-fix threw read-after-write.
  await runApply("vendor", VENDOR_ID, PIN_B);
  pass("PIN rotate commits without transaction read-after-write error");

  const secretAfterB = await db
    .collection(ACCESS_PIN_SECRETS_COLLECTION)
    .doc(accessPinSecretDocId("vendor", VENDOR_ID))
    .get();
  assert.equal(secretAfterB.exists, true);
  const dataB = secretAfterB.data();
  assert.equal(decryptPinFromStorage(dataB.pinEncrypted), PIN_B);
  assert.notEqual(dataB.updatedAt, updatedAtA);
  pass("secret updated to new PIN (length-checked; value asserted)");

  const uniqAAfter = await db
    .collection(ACCESS_PIN_UNIQUENESS_COLLECTION)
    .doc(accessPinUniquenessDocId(pinLookupKeyForPin(PIN_A)))
    .get();
  const uniqBAfter = await db
    .collection(ACCESS_PIN_UNIQUENESS_COLLECTION)
    .doc(accessPinUniquenessDocId(pinLookupKeyForPin(PIN_B)))
    .get();
  assert.equal(uniqAAfter.exists, false);
  assert.equal(uniqBAfter.exists, true);
  pass("old uniqueness removed; new uniqueness written");

  // Johnstone-shaped path: rotate + consume admin session in ONE transaction
  // (setAccessPin ordering — reads session before secret/audit writes).
  const {
    formatAdminAccessSessionToken,
    hashAdminAccessSessionRaw,
  } = require(resolve(root, "functions/lib/adminAccessSession.js"));
  const {
    ADMIN_ACCESS_SESSIONS_COLLECTION,
    PIN_ACCESS_AUDIT_COLLECTION,
  } = require(resolve(root, "functions/lib/accessPinSecretsShared.js"));

  const sessionId = "a".repeat(32);
  const raw = "b".repeat(64);
  const actorUid = "manager-rotate-test";
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  await db.collection(ADMIN_ACCESS_SESSIONS_COLLECTION).doc(sessionId).set({
    managerUid: actorUid,
    targetType: "vendor",
    targetId: VENDOR_ID,
    secretHash: hashAdminAccessSessionRaw(raw),
    createdAt: new Date().toISOString(),
    expiresAt,
    revoked: false,
  });

  const PIN_C = "3333";
  const refsC = prepareAccessPinSecretWrite("vendor", VENDOR_ID, PIN_C);
  const auditRef = db.collection(PIN_ACCESS_AUDIT_COLLECTION).doc();
  const nowC = new Date().toISOString();
  await db.runTransaction(async (tx) => {
    const entitySnap = await tx.get(refsC.entityRef);
    const existingSecretSnap = await tx.get(refsC.secretRef);
    const uniquenessSnap = await tx.get(refsC.uniquenessRef);
    const legacyUniquenessSnaps = await Promise.all(
      refsC.legacyUniquenessRefs.map((ref) => tx.get(ref)),
    );
    const sessionRef = db
      .collection(ADMIN_ACCESS_SESSIONS_COLLECTION)
      .doc(sessionId);
    const sessionSnap = await tx.get(sessionRef);
    assert.equal(sessionSnap.exists, true);
    const session = sessionSnap.data();
    assert.equal(session.managerUid, actorUid);
    assert.equal(Boolean(session.consumedAt), false);

    await applyAccessPinSecretWriteInTransaction(tx, db, {
      targetType: "vendor",
      targetId: VENDOR_ID,
      pin: PIN_C,
      now: nowC,
      refs: refsC,
      existingSecretSnap,
      uniquenessSnap,
      legacyUniquenessSnaps,
      entitySnap,
    });
    tx.set(auditRef, {
      action: "pin_changed",
      targetType: "vendor",
      targetId: VENDOR_ID,
      actorUid,
      createdAt: nowC,
    });
    tx.set(sessionRef, { consumedAt: nowC }, { merge: true });
  });

  const secretAfterC = await db
    .collection(ACCESS_PIN_SECRETS_COLLECTION)
    .doc(accessPinSecretDocId("vendor", VENDOR_ID))
    .get();
  assert.equal(decryptPinFromStorage(secretAfterC.data().pinEncrypted), PIN_C);
  const sessionAfter = await db
    .collection(ADMIN_ACCESS_SESSIONS_COLLECTION)
    .doc(sessionId)
    .get();
  assert.equal(typeof sessionAfter.data()?.consumedAt, "string");
  const auditAfter = await auditRef.get();
  assert.equal(auditAfter.exists, true);
  assert.equal(auditAfter.data()?.action, "pin_changed");
  pass("rotate + session consume + pin_changed audit commits (setAccessPin shape)");

  // silence unused import lint in node — token formatter available for future
  void formatAdminAccessSessionToken;

  await cleanup();
  await db
    .collection(ADMIN_ACCESS_SESSIONS_COLLECTION)
    .doc(sessionId)
    .delete()
    .catch(() => undefined);
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
} catch (err) {
  fail("fatal", err);
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(1);
}
