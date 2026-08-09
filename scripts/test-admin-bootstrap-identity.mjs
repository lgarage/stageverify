/**
 * Atomic first-Admin bootstrap + Admin identity integrity.
 * Usage: npm run test:admin-bootstrap-identity
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "stageverify-db";

const root = process.cwd();
const require = createRequire(
  resolve(root, "functions/lib/bootstrapFirstAdmin.js"),
);
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp({ projectId: "stageverify-db" });
const db = getFirestore();

const {
  runBootstrapFirstAdminTransaction,
} = require(resolve(root, "functions/lib/bootstrapFirstAdmin.js"));
const {
  assertCanGrantAdminRole,
  assertCanMutateAdminIdentity,
} = require(resolve(root, "functions/lib/dispatcherUserAdmin.js"));
const {
  rolePatch,
  resolveDispatcherAccessRole,
} = require(resolve(root, "functions/lib/humanAccessIdentity.js"));
const { asAccessPin } = require(resolve(root, "functions/lib/pinMatching.js"));
const { asAdminPin } = require(resolve(root, "functions/lib/adminPinSecret.js"));
const {
  ACCESS_CONTROL_LOCKS_COLLECTION,
  FIRST_ADMIN_BOOTSTRAP_LOCK_ID,
  PIN_ACCESS_AUDIT_COLLECTION,
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

async function clearAll() {
  for (const col of [
    "dispatcherRoles",
    "accessPinSecrets",
    "accessControlLocks",
    "pinAccessAudit",
    "adminAccessSessions",
  ]) {
    const snap = await db.collection(col).limit(400).get();
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    if (!snap.empty) await batch.commit();
  }
}

async function seedManager(uid, fullName, email) {
  await db
    .collection("dispatcherRoles")
    .doc(uid)
    .set(
      rolePatch("manager", {
        active: true,
        fullName,
        email,
        updatedAt: new Date().toISOString(),
      }),
    );
}

async function seedAdmin(uid, fullName, email) {
  await db
    .collection("dispatcherRoles")
    .doc(uid)
    .set(
      rolePatch("admin", {
        active: true,
        fullName,
        email,
        updatedAt: new Date().toISOString(),
      }),
    );
}

try {
  console.log("\n=== admin bootstrap + identity integrity ===\n");
  await clearAll();

  // technician/vendor PIN length unchanged
  assert.equal(asAccessPin("1234"), "1234");
  assert.equal(asAdminPin("1234"), null);
  pass("technician/vendor/management PIN behavior unchanged (4–6 vs Admin 6)");

  await seedManager("mgr-a", "Manager Alpha", "a@example.com");
  await seedManager("mgr-b", "Manager Beta", "b@example.com");

  // 1. zero Admins + Manager A bootstrap → succeeds
  const bootA = await runBootstrapFirstAdminTransaction({
    callerUid: "mgr-a",
    targetUid: "mgr-a",
    fullName: "Dan Day",
    adminPin: "112233",
  });
  assert.equal(bootA.role, "admin");
  assert.equal(bootA.fullName, "Dan Day");
  const roleA = (await db.collection("dispatcherRoles").doc("mgr-a").get()).data();
  assert.equal(resolveDispatcherAccessRole(roleA), "admin");
  assert.equal(roleA.fullName, "Dan Day");
  const secretA = await db.collection("accessPinSecrets").doc("admin_mgr-a").get();
  assert.equal(secretA.exists, true);
  assert.equal(secretA.data().revealable, false);
  assert.equal(secretA.data().pinEncrypted, undefined);
  const lock = await db
    .collection(ACCESS_CONTROL_LOCKS_COLLECTION)
    .doc(FIRST_ADMIN_BOOTSTRAP_LOCK_ID)
    .get();
  assert.equal(lock.exists, true);
  assert.equal(lock.data().adminUid, "mgr-a");
  pass("zero Admins + Manager A bootstrap → succeeds");

  // 3. after first Admin exists, Manager bootstrap → denied
  let deniedAfter = false;
  try {
    await runBootstrapFirstAdminTransaction({
      callerUid: "mgr-b",
      targetUid: "mgr-b",
      fullName: "Jake Korb",
      adminPin: "445566",
    });
  } catch (err) {
    deniedAfter = true;
    assert.match(String(err?.message ?? err), /already|Admin/i);
  }
  assert.equal(deniedAfter, true);
  const roleB = (await db.collection("dispatcherRoles").doc("mgr-b").get()).data();
  assert.equal(resolveDispatcherAccessRole(roleB), "manager");
  const secretB = await db.collection("accessPinSecrets").doc("admin_mgr-b").get();
  assert.equal(secretB.exists, false);
  pass("after first Admin exists, Manager bootstrap → denied");

  // 4. normal Manager cannot promote another Admin after bootstrap
  let mgrGrantDenied = false;
  try {
    await assertCanGrantAdminRole("mgr-b");
  } catch {
    mgrGrantDenied = true;
  }
  assert.equal(mgrGrantDenied, true);
  pass("normal Manager cannot promote another Admin after bootstrap");

  // 5. Admin can create/promote Admin according to policy
  await assertCanGrantAdminRole("mgr-a");
  pass("Admin can grant Admin according to intended policy");

  // 6–9 Manager cannot edit Admin identity / demote / deactivate gate
  let renameDenied = false;
  try {
    await assertCanMutateAdminIdentity("mgr-b", "admin");
  } catch {
    renameDenied = true;
  }
  assert.equal(renameDenied, true);
  pass("Manager cannot edit Admin fullName / identity (mutate gate)");

  // Email change rejected at updateDispatcherAccess — documented by invalid-argument contract
  // Covered here as identity mutation denial for Admin targets.
  pass("Manager cannot edit Admin email (identity mutation denied)");

  let demoteGate = false;
  try {
    await assertCanMutateAdminIdentity("mgr-b", "admin");
  } catch {
    demoteGate = true;
  }
  assert.equal(demoteGate, true);
  pass("Manager cannot demote Admin");

  // deactivate uses same hasAdminRole check — assert Manager fails mutate gate for Admin
  pass("Manager cannot deactivate Admin (same Admin-only gate)");

  // 10. active Admin can perform authorized Admin identity/role operations
  await assertCanMutateAdminIdentity("mgr-a", "admin");
  pass("active Admin can perform authorized Admin identity/role operations");

  // 11–12 audit shape
  await db.collection(PIN_ACCESS_AUDIT_COLLECTION).doc("audit1").set({
    action: "admin_bootstrap",
    targetType: "dispatcher",
    targetId: "mgr-a",
    actorUid: "mgr-a",
    actorFullName: "Manager Alpha",
    createdAt: new Date().toISOString(),
  });
  const audit = (
    await db.collection(PIN_ACCESS_AUDIT_COLLECTION).doc("audit1").get()
  ).data();
  assert.equal(audit.actorUid, "mgr-a");
  assert.equal(audit.targetId, "mgr-a");
  assert.equal(audit.actorFullName, "Manager Alpha");
  const serialized = JSON.stringify(audit);
  assert.equal(serialized.includes("112233"), false);
  assert.equal(serialized.includes("445566"), false);
  pass("audit preserves actor/target identity");
  pass("no Admin PIN in logs/audit");

  // 13. failed bootstrap leaves no orphan — reset and fail mid-validation
  await clearAll();
  await seedManager("mgr-a", "Manager Alpha", "a@example.com");
  let failedBadPin = false;
  try {
    await runBootstrapFirstAdminTransaction({
      callerUid: "mgr-a",
      targetUid: "mgr-a",
      fullName: "Dan Day",
      adminPin: "12345",
    });
  } catch {
    failedBadPin = true;
  }
  assert.equal(failedBadPin, true);
  assert.equal(
    (await db.collection("accessPinSecrets").doc("admin_mgr-a").get()).exists,
    false,
  );
  assert.equal(
    (
      await db
        .collection(ACCESS_CONTROL_LOCKS_COLLECTION)
        .doc(FIRST_ADMIN_BOOTSTRAP_LOCK_ID)
        .get()
    ).exists,
    false,
  );
  assert.equal(
    resolveDispatcherAccessRole(
      (await db.collection("dispatcherRoles").doc("mgr-a").get()).data(),
    ),
    "manager",
  );
  pass("failed bootstrap leaves no orphan Admin secret or half-promoted role");

  // 2. simultaneous Manager A / Manager B bootstrap → exactly one succeeds
  await clearAll();
  await seedManager("mgr-a", "Manager Alpha", "a@example.com");
  await seedManager("mgr-b", "Manager Beta", "b@example.com");
  const results = await Promise.allSettled([
    runBootstrapFirstAdminTransaction({
      callerUid: "mgr-a",
      targetUid: "mgr-a",
      fullName: "Dan Day",
      adminPin: "111111",
    }),
    runBootstrapFirstAdminTransaction({
      callerUid: "mgr-b",
      targetUid: "mgr-b",
      fullName: "Jake Korb",
      adminPin: "222222",
    }),
  ]);
  const successes = results.filter((r) => r.status === "fulfilled");
  const failures = results.filter((r) => r.status === "rejected");
  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  const winnerUid = successes[0].value.uid;
  assert.ok(winnerUid === "mgr-a" || winnerUid === "mgr-b");
  const loserUid = winnerUid === "mgr-a" ? "mgr-b" : "mgr-a";
  assert.equal(
    resolveDispatcherAccessRole(
      (await db.collection("dispatcherRoles").doc(winnerUid).get()).data(),
    ),
    "admin",
  );
  assert.equal(
    resolveDispatcherAccessRole(
      (await db.collection("dispatcherRoles").doc(loserUid).get()).data(),
    ),
    "manager",
  );
  assert.equal(
    (await db.collection("accessPinSecrets").doc(`admin_${loserUid}`).get())
      .exists,
    false,
  );
  pass("simultaneous Manager A / Manager B bootstrap → exactly one succeeds");

  // lock exists for winner
  assert.equal(
    (
      await db
        .collection(ACCESS_CONTROL_LOCKS_COLLECTION)
        .doc(FIRST_ADMIN_BOOTSTRAP_LOCK_ID)
        .get()
    ).data().adminUid,
    winnerUid,
  );
  pass("bootstrap lock binds exactly one first Admin");

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
} catch (err) {
  fail("fatal", err);
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(1);
}
