/**
 * Admin access session helpers — Firestore emulator integration.
 * Usage: npm run test:admin-access-session
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "stageverify-db";

const root = process.cwd();
const require = createRequire(
  resolve(root, "functions/lib/adminAccessSession.js"),
);

const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp({ projectId: "stageverify-db" });

const {
  createAdminAccessSession,
  validateAdminAccessSession,
  revokeAdminAccessSessionByToken,
  consumeAdminAccessSessionByToken,
  ADMIN_ACCESS_SESSION_TTL_MS,
} = require(resolve(root, "functions/lib/adminAccessSession.js"));

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

async function clearSessions() {
  const db = getFirestore();
  const snap = await db.collection("adminAccessSessions").limit(200).get();
  const batch = db.batch();
  for (const doc of snap.docs) {
    batch.delete(doc.ref);
  }
  if (!snap.empty) await batch.commit();
}

try {
  console.log("\n=== adminAccessSession emulator ===\n");
  await clearSessions();

  const created = await createAdminAccessSession({
    managerUid: "mgr-1",
    targetType: "technician",
    targetId: "tech-1",
  });
  assert.match(created.sessionToken, /^[0-9a-f]{32}\.[0-9a-f]{64}$/);
  pass("createAdminAccessSession mints sessionId.raw token");

  const ok = await validateAdminAccessSession({
    sessionToken: created.sessionToken,
    managerUid: "mgr-1",
    targetType: "technician",
    targetId: "tech-1",
  });
  assert.equal(ok.ok, true);
  pass("validateAdminAccessSession accepts bound session");

  const crossTarget = await validateAdminAccessSession({
    sessionToken: created.sessionToken,
    managerUid: "mgr-1",
    targetType: "vendor",
    targetId: "tech-1",
  });
  assert.equal(crossTarget.ok, false);
  assert.equal(crossTarget.reason, "target_mismatch");
  pass("cross-target binding rejected");

  const wrongUid = await validateAdminAccessSession({
    sessionToken: created.sessionToken,
    managerUid: "mgr-2",
    targetType: "technician",
    targetId: "tech-1",
  });
  assert.equal(wrongUid.ok, false);
  pass("uid mismatch rejected");

  const revoked = await revokeAdminAccessSessionByToken(created.sessionToken);
  assert.equal(revoked, true);
  const afterRevoke = await validateAdminAccessSession({
    sessionToken: created.sessionToken,
    managerUid: "mgr-1",
    targetType: "technician",
    targetId: "tech-1",
  });
  assert.equal(afterRevoke.ok, false);
  assert.equal(afterRevoke.reason, "revoked");
  pass("revoke invalidates session");

  const created2 = await createAdminAccessSession({
    managerUid: "mgr-1",
    targetType: "technician",
    targetId: "tech-2",
  });
  await consumeAdminAccessSessionByToken(created2.sessionToken, {
    managerUid: "mgr-1",
    targetType: "technician",
    targetId: "tech-2",
  });
  const afterConsume = await validateAdminAccessSession({
    sessionToken: created2.sessionToken,
    managerUid: "mgr-1",
    targetType: "technician",
    targetId: "tech-2",
  });
  assert.equal(afterConsume.ok, false);
  assert.equal(afterConsume.reason, "consumed");
  pass("consume marks session used");

  const created3 = await createAdminAccessSession({
    managerUid: "mgr-1",
    targetType: "technician",
    targetId: "tech-3",
  });
  let consumeRejected = false;
  try {
    await consumeAdminAccessSessionByToken(created3.sessionToken, {
      managerUid: "mgr-1",
      targetType: "vendor",
      targetId: "tech-3",
    });
  } catch {
    consumeRejected = true;
  }
  assert.equal(consumeRejected, true);
  pass("consume rejects target binding mismatch");

  const db = getFirestore();
  const sessionId = created2.sessionToken.split(".")[0];
  const ref = db.collection("adminAccessSessions").doc(sessionId);
  const snap = await ref.get();
  const expiresAt = Date.parse(snap.data().expiresAt);
  const createdAt = Date.parse(snap.data().createdAt);
  assert.equal(expiresAt - createdAt, ADMIN_ACCESS_SESSION_TTL_MS);
  pass("expiresAt is createdAt + 5min absolute TTL");
} catch (err) {
  fail("admin access session suite", err);
}

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
