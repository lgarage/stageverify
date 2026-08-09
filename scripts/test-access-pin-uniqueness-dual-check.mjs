/**
 * Contract: D-74 global uniqueness dual-checks legacy typed index docs,
 * plus job-PIN collision rejection on the access-PIN write path.
 *
 * Usage:
 *   npm run test:access-pin-uniqueness-dual-check
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
const require = createRequire(import.meta.url);

const { pinLookupKeyForPin } = require(
  resolve(root, "functions/lib/accessPinCrypto.js"),
);
const {
  accessPinUniquenessDocId,
  legacyAccessPinUniquenessDocId,
  uniquenessBelongsToOtherTarget,
  ACCESS_PIN_UNIQUENESS_TARGET_TYPES,
  accessPinSecretDocId,
  getDb,
} = require(resolve(root, "functions/lib/accessPinSecretsShared.js"));
const admin = require(resolve(root, "functions/node_modules/firebase-admin"));
if (!admin.apps.length) {
  admin.initializeApp({ projectId: "stageverify-db" });
}
const {
  prepareAccessPinSecretWrite,
  applyAccessPinSecretWriteInTransaction,
} = require(resolve(root, "functions/lib/accessPinSecretWrite.js"));

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

console.log("\n=== accessPinUniqueness dual-check contract ===\n");

try {
  const key = pinLookupKeyForPin("4242");
  assert.equal(accessPinUniquenessDocId(key), `global_${key}`);
  assert.equal(legacyAccessPinUniquenessDocId("vendor", key), `vendor_${key}`);
  assert.equal(
    legacyAccessPinUniquenessDocId("technician", key),
    `technician_${key}`,
  );
  assert.deepEqual(ACCESS_PIN_UNIQUENESS_TARGET_TYPES, [
    "technician",
    "vendor",
    "management",
  ]);
  pass("global + legacy uniqueness doc id shapes");
} catch (err) {
  fail("doc id shapes", err);
}

try {
  assert.equal(
    uniquenessBelongsToOtherTarget(
      { targetType: "vendor", targetId: "vendor-a" },
      "vendor",
      "vendor-a",
    ),
    false,
  );
  assert.equal(
    uniquenessBelongsToOtherTarget(
      { targetType: "vendor", targetId: "vendor-b" },
      "vendor",
      "vendor-a",
    ),
    true,
  );
  assert.equal(
    uniquenessBelongsToOtherTarget(
      { targetType: "technician", targetId: "tech-1" },
      "vendor",
      "vendor-a",
    ),
    true,
  );
  assert.equal(
    uniquenessBelongsToOtherTarget(undefined, "vendor", "vendor-a"),
    false,
  );
  pass("uniquenessBelongsToOtherTarget conflict matrix");
} catch (err) {
  fail("uniquenessBelongsToOtherTarget", err);
}

try {
  const refs = prepareAccessPinSecretWrite("vendor", "vendor-x", "5555");
  assert.ok(refs.uniquenessRef.path.includes("accessPinUniqueness/global_"));
  assert.equal(refs.legacyUniquenessRefs.length, 3);
  const legacyIds = refs.legacyUniquenessRefs.map((r) =>
    r.path.split("/").pop(),
  );
  assert.ok(legacyIds.some((id) => id.startsWith("vendor_")));
  assert.ok(legacyIds.some((id) => id.startsWith("technician_")));
  assert.ok(legacyIds.some((id) => id.startsWith("management_")));
  pass("prepareAccessPinSecretWrite includes legacy uniqueness refs");
} catch (err) {
  fail("prepareAccessPinSecretWrite legacy refs", err);
}

const JOB_ID = "job-uniqueness-collision";
const VENDOR_COLLISION_ID = "vendor-collision-test";
const VENDOR_OK_ID = "vendor-ok-test";
const COLLISION_PIN = "7070";
const OK_PIN = "7171";

async function cleanupJobCollisionFixtures() {
  const db = getDb();
  const batch = db.batch();
  batch.delete(db.collection("jobs").doc(JOB_ID));
  batch.delete(db.collection("vendors").doc(VENDOR_COLLISION_ID));
  batch.delete(db.collection("vendors").doc(VENDOR_OK_ID));
  for (const [vendorId, pin] of [
    [VENDOR_COLLISION_ID, COLLISION_PIN],
    [VENDOR_OK_ID, OK_PIN],
  ]) {
    batch.delete(
      db
        .collection("accessPinSecrets")
        .doc(accessPinSecretDocId("vendor", vendorId)),
    );
    const key = pinLookupKeyForPin(pin);
    batch.delete(
      db.collection("accessPinUniqueness").doc(accessPinUniquenessDocId(key)),
    );
    for (const type of ACCESS_PIN_UNIQUENESS_TARGET_TYPES) {
      batch.delete(
        db
          .collection("accessPinUniqueness")
          .doc(legacyAccessPinUniquenessDocId(type, key)),
      );
    }
  }
  await batch.commit();
}

try {
  const db = getDb();
  await cleanupJobCollisionFixtures();
  await db.collection("jobs").doc(JOB_ID).set({
    id: JOB_ID,
    pinCode: COLLISION_PIN,
  });
  await db.collection("vendors").doc(VENDOR_COLLISION_ID).set({
    id: VENDOR_COLLISION_ID,
    name: "Collision Vendor",
    active: true,
  });

  let rejected = false;
  let rejectErr = null;
  try {
    const refs = prepareAccessPinSecretWrite(
      "vendor",
      VENDOR_COLLISION_ID,
      COLLISION_PIN,
    );
    const now = new Date().toISOString();
    await db.runTransaction(async (tx) => {
      const entitySnap = await tx.get(refs.entityRef);
      const existingSecretSnap = await tx.get(refs.secretRef);
      const uniquenessSnap = await tx.get(refs.uniquenessRef);
      const legacyUniquenessSnaps = await Promise.all(
        refs.legacyUniquenessRefs.map((ref) => tx.get(ref)),
      );
      await applyAccessPinSecretWriteInTransaction(tx, db, {
        targetType: "vendor",
        targetId: VENDOR_COLLISION_ID,
        pin: COLLISION_PIN,
        now,
        refs,
        existingSecretSnap,
        uniquenessSnap,
        legacyUniquenessSnaps,
        entitySnap,
      });
    });
  } catch (err) {
    rejectErr = err;
    rejected =
      err?.code === "already-exists" ||
      String(err?.message ?? "").includes("Could not set PIN");
  }
  if (rejected) {
    pass("applyAccessPinSecretWrite rejects PIN matching job pinCode");
  } else if (rejectErr) {
    fail("job PIN collision reject — unexpected error", rejectErr);
  } else {
    fail("job PIN collision reject — expected already-exists");
  }

  await db.collection("vendors").doc(VENDOR_OK_ID).set({
    id: VENDOR_OK_ID,
    name: "Ok Vendor",
    active: true,
  });
  const okRefs = prepareAccessPinSecretWrite("vendor", VENDOR_OK_ID, OK_PIN);
  const nowOk = new Date().toISOString();
  await db.runTransaction(async (tx) => {
    const entitySnap = await tx.get(okRefs.entityRef);
    const existingSecretSnap = await tx.get(okRefs.secretRef);
    const uniquenessSnap = await tx.get(okRefs.uniquenessRef);
    const legacyUniquenessSnaps = await Promise.all(
      okRefs.legacyUniquenessRefs.map((ref) => tx.get(ref)),
    );
    await applyAccessPinSecretWriteInTransaction(tx, db, {
      targetType: "vendor",
      targetId: VENDOR_OK_ID,
      pin: OK_PIN,
      now: nowOk,
      refs: okRefs,
      existingSecretSnap,
      uniquenessSnap,
      legacyUniquenessSnaps,
      entitySnap,
    });
  });
  const secretSnap = await db
    .collection("accessPinSecrets")
    .doc(accessPinSecretDocId("vendor", VENDOR_OK_ID))
    .get();
  assert.equal(secretSnap.exists, true);
  pass("non-colliding access PIN write succeeds");
} catch (err) {
  fail("job PIN collision live transaction", err);
} finally {
  try {
    await cleanupJobCollisionFixtures();
  } catch {
    // best-effort teardown
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
