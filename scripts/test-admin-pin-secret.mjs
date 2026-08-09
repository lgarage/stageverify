/**
 * Named Admin PIN secret helpers — hash-only, 6-digit, no decrypt path.
 * Usage: npm run test:admin-pin-secret
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "stageverify-db";

const root = process.cwd();
const require = createRequire(
  resolve(root, "functions/lib/adminPinSecret.js"),
);
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp({ projectId: "stageverify-db" });

const {
  asAdminPin,
  setOwnAdminPin,
  verifyOwnAdminPinForSession,
  clearOwnAdminPin,
  adminPinSecretDocId,
} = require(resolve(root, "functions/lib/adminPinSecret.js"));

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

async function clearAdminSecrets() {
  const db = getFirestore();
  const snap = await db.collection("accessPinSecrets").limit(200).get();
  const batch = db.batch();
  for (const doc of snap.docs) {
    if (doc.id.startsWith("admin_")) batch.delete(doc.ref);
  }
  if (!snap.empty) await batch.commit();
}

try {
  console.log("\n=== adminPinSecret ===\n");
  await clearAdminSecrets();

  assert.equal(asAdminPin("123456"), "123456");
  pass("6-digit Admin PIN accepted");

  assert.equal(asAdminPin("12345"), null);
  pass("5-digit Admin PIN rejected");

  assert.equal(asAdminPin("1234567"), null);
  pass("7-digit Admin PIN rejected");

  assert.equal(asAdminPin("12ab56"), null);
  pass("nonnumeric Admin PIN rejected");

  assert.equal(asAdminPin("1234"), null);
  pass("4-digit Admin PIN rejected (admin-only rule)");

  const uid = "admin-user-1";
  await setOwnAdminPin(uid, "654321");
  const snap = await getFirestore()
    .collection("accessPinSecrets")
    .doc(adminPinSecretDocId(uid))
    .get();
  assert.equal(snap.exists, true);
  const data = snap.data();
  assert.equal(data.targetType, "admin");
  assert.equal(data.targetId, uid);
  assert.equal(data.revealable, false);
  assert.equal(typeof data.pinHash, "string");
  assert.equal(data.pinEncrypted, undefined);
  pass("Admin PIN stored hash-only (no pinEncrypted)");

  assert.equal(await verifyOwnAdminPinForSession(uid, "654321"), true);
  pass("correct Admin PIN verifies");

  assert.equal(await verifyOwnAdminPinForSession(uid, "000000"), false);
  pass("wrong Admin PIN denied");

  assert.equal(await verifyOwnAdminPinForSession("other-uid", "654321"), false);
  pass("Admin PIN does not float to another uid");

  await clearOwnAdminPin(uid);
  assert.equal(await verifyOwnAdminPinForSession(uid, "654321"), false);
  pass("cleared Admin PIN no longer verifies");

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
} catch (err) {
  fail("fatal", err);
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(1);
}
