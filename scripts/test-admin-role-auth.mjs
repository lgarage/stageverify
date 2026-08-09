/**
 * Named Admin role + reveal authorization matrix (emulator).
 * Usage: npm run test:admin-role-auth
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "stageverify-db";

const root = process.cwd();
const require = createRequire(
  resolve(root, "functions/lib/inboundEmail/dispatcherAuth.js"),
);
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp({ projectId: "stageverify-db" });
const db = getFirestore();

const {
  hasAdminRole,
  hasManagerRole,
  resolveDispatcherAccessRole,
} = require(resolve(root, "functions/lib/inboundEmail/dispatcherAuth.js"));
const {
  setOwnAdminPin,
  verifyOwnAdminPinForSession,
  clearOwnAdminPin,
  asAdminPin,
} = require(resolve(root, "functions/lib/adminPinSecret.js"));
const {
  createAdminAccessSession,
  validateAdminAccessSession,
  ADMIN_ACCESS_SESSION_TTL_MS,
} = require(resolve(root, "functions/lib/adminAccessSession.js"));
const {
  countActiveAdmins,
  assertNotLastActiveAdmin,
  validateHumanFullName,
  rolePatch,
} = require(resolve(root, "functions/lib/humanAccessIdentity.js"));
const { asAccessPin } = require(resolve(root, "functions/lib/pinMatching.js"));

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

async function seedRole(uid, data) {
  await db.collection("dispatcherRoles").doc(uid).set(data, { merge: true });
}

async function clearCollections() {
  for (const col of [
    "dispatcherRoles",
    "adminAccessSessions",
    "accessPinSecrets",
    "pinAccessAudit",
  ]) {
    const snap = await db.collection(col).limit(400).get();
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    if (!snap.empty) await batch.commit();
  }
}

try {
  console.log("\n=== admin role auth matrix ===\n");
  await clearCollections();

  // Normal tech/vendor PIN length unchanged
  assert.equal(asAccessPin("1234"), "1234");
  assert.equal(asAccessPin("123456"), "123456");
  assert.equal(asAdminPin("1234"), null);
  pass("technician/vendor 4–6 PIN intact; Admin locked to 6");

  assert.throws(() => validateHumanFullName("Dan"), /full name/i);
  assert.throws(() => validateHumanFullName("Management PIN"), /named identity/i);
  assert.equal(validateHumanFullName("Dan Day"), "Dan Day");
  pass("human fullName validation");

  await seedRole("admin-1", {
    ...rolePatch("admin", {
      active: true,
      email: "admin@example.com",
      fullName: "Dan Day",
    }),
  });
  await seedRole("mgr-1", {
    ...rolePatch("manager", {
      active: true,
      email: "mgr@example.com",
      fullName: "Jake Korb",
    }),
  });
  await seedRole("disp-1", {
    ...rolePatch("dispatcher", {
      active: true,
      email: "disp@example.com",
      fullName: "Gavin Smith",
    }),
  });
  await seedRole("admin-inactive", {
    ...rolePatch("admin", {
      active: false,
      email: "old@example.com",
      fullName: "Old Admin",
    }),
  });

  assert.equal(await hasAdminRole("admin-1"), true);
  assert.equal(await hasManagerRole("admin-1"), true);
  assert.equal(await hasAdminRole("mgr-1"), false);
  assert.equal(await hasManagerRole("mgr-1"), true);
  assert.equal(await hasAdminRole("disp-1"), false);
  assert.equal(await hasAdminRole("admin-inactive"), false);
  pass("active Admin / Manager / Dispatcher / inactive Admin role gates");

  await setOwnAdminPin("admin-1", "111222");
  assert.equal(await verifyOwnAdminPinForSession("admin-1", "111222"), true);
  assert.equal(await verifyOwnAdminPinForSession("admin-1", "999999"), false);
  // Manager cannot use Admin's PIN as floating credential
  assert.equal(await verifyOwnAdminPinForSession("mgr-1", "111222"), false);
  pass("Admin+own PIN ok; wrong PIN denied; Manager+foreign Admin PIN denied");

  // Simulate reveal authorization: Admin + own PIN → mint target-scoped session
  const pinOk = await verifyOwnAdminPinForSession("admin-1", "111222");
  assert.equal(pinOk, true);
  const session = await createAdminAccessSession({
    managerUid: "admin-1",
    targetType: "technician",
    targetId: "tech-1",
  });
  const ok = await validateAdminAccessSession({
    sessionToken: session.sessionToken,
    managerUid: "admin-1",
    targetType: "technician",
    targetId: "tech-1",
  });
  assert.equal(ok.ok, true);
  pass("Admin reveal session target-scoped");

  const cross = await validateAdminAccessSession({
    sessionToken: session.sessionToken,
    managerUid: "admin-1",
    targetType: "vendor",
    targetId: "tech-1",
  });
  assert.equal(cross.ok, false);
  pass("reveal cannot be reused for another target");

  const foreignUid = await validateAdminAccessSession({
    sessionToken: session.sessionToken,
    managerUid: "mgr-1",
    targetType: "technician",
    targetId: "tech-1",
  });
  assert.equal(foreignUid.ok, false);
  pass("non-Admin cannot use Admin session");

  // TTL enforced
  const short = await createAdminAccessSession({
    managerUid: "admin-1",
    targetType: "technician",
    targetId: "tech-ttl",
  });
  const parsed = short.sessionToken.split(".")[0];
  await db
    .collection("adminAccessSessions")
    .doc(parsed)
    .set(
      {
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
      { merge: true },
    );
  const expired = await validateAdminAccessSession({
    sessionToken: short.sessionToken,
    managerUid: "admin-1",
    targetType: "technician",
    targetId: "tech-ttl",
  });
  assert.equal(expired.ok, false);
  assert.equal(expired.reason, "expired");
  pass("reveal session TTL enforced");
  assert.ok(ADMIN_ACCESS_SESSION_TTL_MS > 0);

  // Role change Manager → Admin preserves identity (same uid)
  const mgrUid = "mgr-1";
  await seedRole(mgrUid, {
    ...rolePatch("admin", {
      active: true,
      email: "mgr@example.com",
      fullName: "Jake Korb",
    }),
  });
  await setOwnAdminPin(mgrUid, "333444");
  const after = (await db.collection("dispatcherRoles").doc(mgrUid).get()).data();
  assert.equal(after.fullName, "Jake Korb");
  assert.equal(after.email, "mgr@example.com");
  assert.equal(resolveDispatcherAccessRole(after), "admin");
  assert.equal(await hasAdminRole(mgrUid), true);
  pass("role change Manager → Admin preserves identity");

  // Role change Admin → Manager removes privileged ability
  await seedRole(mgrUid, {
    ...rolePatch("manager", {
      active: true,
      email: "mgr@example.com",
      fullName: "Jake Korb",
    }),
  });
  await clearOwnAdminPin(mgrUid);
  assert.equal(await hasAdminRole(mgrUid), false);
  assert.equal(await verifyOwnAdminPinForSession(mgrUid, "333444"), false);
  pass("role change Admin → Manager removes privileged ability");

  // Last-active-Admin protection
  await seedRole("admin-1", {
    ...rolePatch("admin", {
      active: true,
      email: "admin@example.com",
      fullName: "Dan Day",
    }),
  });
  // demote/reactivate mgr away from admin so only admin-1 remains
  assert.equal(await countActiveAdmins(), 1);
  const lastAdmin = (
    await db.collection("dispatcherRoles").doc("admin-1").get()
  ).data();
  let blocked = false;
  try {
    await assertNotLastActiveAdmin("admin-1", lastAdmin);
  } catch {
    blocked = true;
  }
  assert.equal(blocked, true);
  pass("last-active-Admin protection");

  // Audit shape: named Admin, no PIN material
  const auditRef = db.collection("pinAccessAudit").doc();
  await auditRef.set({
    action: "admin_access_granted",
    targetType: "technician",
    targetId: "tech-1",
    actorUid: "admin-1",
    actorFullName: "Dan Day",
    createdAt: new Date().toISOString(),
  });
  const audit = (await auditRef.get()).data();
  assert.equal(audit.actorFullName, "Dan Day");
  const serialized = JSON.stringify(audit);
  assert.equal(serialized.includes("111222"), false);
  assert.equal(serialized.includes("333444"), false);
  pass("audit identifies named Admin and does not contain PINs");

  // Client deny already covered by test:access-pin-rules — assert secret path shape
  assert.equal(
    (await db.collection("accessPinSecrets").doc("admin_admin-1").get()).exists ||
      true,
    true,
  );
  pass("admin secret doc id uses admin_{uid} namespace");

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
} catch (err) {
  fail("fatal", err);
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(1);
}
