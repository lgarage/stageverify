/**
 * Firestore rules — access PIN CF-only collections + pin field blocks.
 * Usage: npm run test:access-pin-rules
 */
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { resolve } from "path";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

const PROJECT_ID = "stageverify-db";
const RULES_PATH = resolve(process.cwd(), "firestore.rules");

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    host: "127.0.0.1",
    port: 8080,
    rules: readFileSync(RULES_PATH, "utf8"),
  },
});

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

async function seedDispatcher(uid) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "dispatcherRoles", uid), {
      active: true,
      manager: true,
    });
  });
}

try {
  console.log("\n=== access PIN firestore rules ===\n");

  const dispatcherCtx = testEnv.authenticatedContext("disp-1");
  await seedDispatcher("disp-1");
  const db = dispatcherCtx.firestore();

  await assert.rejects(
    () =>
      setDoc(doc(db, "accessPinSecrets", "technician_t1"), {
        targetType: "technician",
        targetId: "t1",
      }),
    /PERMISSION_DENIED/,
  );
  pass("client cannot write accessPinSecrets");

  await assert.rejects(
    () => getDoc(doc(db, "accessPinSecrets", "admin_admin-1")),
    /permission-denied|PERMISSION_DENIED/i,
  );
  pass("client cannot read admin accessPinSecrets");

  await assert.rejects(
    () => getDoc(doc(db, "adminAccessSessions", "sess1")),
    /permission-denied|PERMISSION_DENIED/i,
  );
  pass("client cannot read adminAccessSessions");

  await assert.rejects(
    () =>
      setDoc(doc(db, "adminAccessSessions", "sess1"), {
        managerUid: "disp-1",
      }),
    /PERMISSION_DENIED/,
  );
  pass("client cannot write adminAccessSessions");

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "technicians", "tech-rules-1"), {
      name: "Tech",
      active: true,
    });
  });

  await assert.rejects(
    () =>
      updateDoc(doc(db, "technicians", "tech-rules-1"), {
        pinCode: "1234",
      }),
    /PERMISSION_DENIED/,
  );
  pass("dispatcher cannot client-update technician pinCode");

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "vendors", "vendor-rules-1"), {
      name: "Vendor",
      active: true,
    });
  });

  await assert.rejects(
    () =>
      updateDoc(doc(db, "vendors", "vendor-rules-1"), {
        pinHash: "aa:bb",
      }),
    /PERMISSION_DENIED/,
  );
  pass("authenticated user cannot client-update vendor pinHash");

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(
      doc(ctx.firestore(), "technicians", "tech-rules-1"),
    );
    assert.equal(snap.exists(), true);
  });
  pass("seed sanity");
} catch (err) {
  fail("access pin rules suite", err);
}

await testEnv.cleanup();

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
