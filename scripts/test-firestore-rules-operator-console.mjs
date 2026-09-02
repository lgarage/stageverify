/**
 * Firestore rules deny-all for operator console collections.
 * Usage: npm run test:firestore-rules-operator-console
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";

const PROJECT_ID = "stageverify-db";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = PROJECT_ID;

const rules = readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8");
const testEnv = await initializeTestEnvironment({
  projectId: "stageverify-db",
  firestore: { rules, host: "127.0.0.1", port: 8080 },
});

let passed = 0;
let failed = 0;
const pass = (msg) => {
  passed += 1;
  console.log(`  ✓ ${msg}`);
};
const fail = (msg, err) => {
  failed += 1;
  console.error(`  ✗ ${msg}`);
  if (err) console.error(`    ${err?.message ?? err}`);
};

const collections = [
  ["operatorAccounts", "op-user-1"],
  ["operatorOperations", "op-1"],
  ["consoleCustomers", "cus_1"],
  ["consoleLocations", "loc_1"],
  ["consoleUsers", "usr_1"],
  ["consoleActivityEvents", "evt_1"],
  ["operatorConsoleLocks", "first-operator-bootstrap"],
];

try {
  console.log("\n=== firestore rules operator console ===\n");
  const authed = testEnv.authenticatedContext("user-1");
  const db = authed.firestore();

  for (const [collection, id] of collections) {
    try {
      await assertFails(db.collection(collection).doc(id).get());
      pass(`${collection} read denied`);
    } catch (err) {
      fail(`${collection} read denied`, err);
    }
    try {
      await assertFails(
        db.collection(collection).doc(id).set({ probe: true }),
      );
      pass(`${collection} write denied`);
    } catch (err) {
      fail(`${collection} write denied`, err);
    }
  }

  // Sanity: appSettings still readable
  try {
    await assertSucceeds(db.collection("appSettings").doc("config").get());
    pass("appSettings read still allowed for authed (unchanged rule)");
  } catch (err) {
    fail("appSettings read still allowed", err);
  }
} finally {
  await testEnv.cleanup();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
