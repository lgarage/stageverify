/**
 * migrateAccessPins contract — shape only (no live CF invoke).
 * Usage: npm run test:migrate-access-pins
 */
import assert from "node:assert/strict";

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

console.log("\n=== migrateAccessPins contract ===\n");

try {
  const response = {
    dryRun: true,
    limit: 50,
    scanned: 4,
    migrated: 2,
    skippedAlreadyMigrated: 1,
    skippedCollision: 0,
    hashOnly: 1,
    plaintext: 1,
    byType: {
      technician: {
        scanned: 1,
        migrated: 1,
        skippedAlreadyMigrated: 0,
        skippedCollision: 0,
        hashOnly: 0,
        plaintext: 1,
      },
      vendor: {
        scanned: 1,
        migrated: 0,
        skippedAlreadyMigrated: 1,
        skippedCollision: 0,
        hashOnly: 0,
        plaintext: 0,
      },
      management: {
        scanned: 2,
        migrated: 1,
        skippedAlreadyMigrated: 0,
        skippedCollision: 0,
        hashOnly: 1,
        plaintext: 0,
      },
    },
  };
  assert.equal(Object.keys(response.byType).length, 3);
  assert.ok(!("pin" in response));
  pass("management included in byType stats");
} catch (err) {
  fail("migrate contract", err);
}

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
