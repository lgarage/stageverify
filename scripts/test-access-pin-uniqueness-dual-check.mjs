/**
 * Contract: D-74 global uniqueness dual-checks legacy typed index docs.
 *
 * Usage:
 *   npm run test:access-pin-uniqueness-dual-check
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const root = process.cwd();
const require = createRequire(import.meta.url);

process.env.FUNCTIONS_EMULATOR = "true";
process.env.ACCESS_PIN_ENCRYPTION_KEY = Buffer.alloc(32, 0x42).toString(
  "base64",
);

const { pinLookupKeyForPin } = require(
  resolve(root, "functions/lib/accessPinCrypto.js"),
);
const {
  accessPinUniquenessDocId,
  legacyAccessPinUniquenessDocId,
  uniquenessBelongsToOtherTarget,
  ACCESS_PIN_UNIQUENESS_TARGET_TYPES,
} = require(resolve(root, "functions/lib/accessPinSecretsShared.js"));
const admin = require(resolve(root, "functions/node_modules/firebase-admin"));
if (!admin.apps.length) {
  admin.initializeApp({ projectId: "stageverify-dual-check-test" });
}
const { prepareAccessPinSecretWrite } = require(
  resolve(root, "functions/lib/accessPinSecretWrite.js"),
);

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

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
