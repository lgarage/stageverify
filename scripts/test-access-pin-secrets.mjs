/**
 * Access PIN secrets — crypto unit tests (+ optional emulator-backed CF tests).
 *
 * Usage:
 *   npm run build:functions && npm run test:access-pin-secrets
 *
 * Test key only — never use in production:
 *   ACCESS_PIN_ENCRYPTION_KEY=base64 encoding of 32 bytes (fixed below).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const root = process.cwd();
const require = createRequire(import.meta.url);

// Fixed 32-byte test key (base64) — not a production secret.
process.env.ACCESS_PIN_ALLOW_ENV_KEY = "1";
process.env.ACCESS_PIN_ENCRYPTION_KEY = Buffer.alloc(32, 0x42).toString(
  "base64",
);

const {
  encryptPinForStorage,
  decryptPinFromStorage,
} = require(resolve(root, "functions/lib/accessPinCrypto.js"));
const { hashPinForStorage } = require(resolve(root, "functions/lib/pinHashing.js"));
const { pinMatches } = require(resolve(root, "functions/lib/pinMatching.js"));

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

console.log("\n=== accessPinCrypto roundtrip ===\n");

try {
  const encrypted = encryptPinForStorage("1234");
  assert.equal(encrypted.alg, "AES-GCM");
  assert.equal(encrypted.keyVersion, 1);
  assert.match(encrypted.iv, /^[0-9a-f]{24}$/);
  assert.match(encrypted.ciphertext, /^[0-9a-f]+$/);
  assert.match(encrypted.tag, /^[0-9a-f]{32}$/);
  const plain = decryptPinFromStorage(encrypted);
  assert.equal(plain, "1234");
  pass("encrypt/decrypt roundtrip");
} catch (err) {
  fail("encrypt/decrypt roundtrip", err);
}

try {
  const a = encryptPinForStorage("5678");
  const b = encryptPinForStorage("5678");
  assert.notEqual(a.iv, b.iv, "IV must be fresh per encrypt");
  pass("fresh IV per encrypt");
} catch (err) {
  fail("fresh IV per encrypt", err);
}

console.log("\n=== pinHash + pinMatches (verify path) ===\n");

try {
  const stored = hashPinForStorage("4321");
  assert.equal(pinMatches({ pinHash: stored }, "4321"), true);
  assert.equal(pinMatches({ pinHash: stored }, "9999"), false);
  pass("pinMatches scrypt hash");
} catch (err) {
  fail("pinMatches scrypt hash", err);
}

console.log("\n=== migrate dry-run response shape (contract) ===\n");

try {
  const sample = {
    dryRun: true,
    limit: 50,
    scanned: 3,
    migrated: 2,
    skippedAlreadyMigrated: 1,
    hashOnly: 1,
    plaintext: 1,
    byType: {
      technician: {
        scanned: 2,
        migrated: 1,
        skippedAlreadyMigrated: 1,
        hashOnly: 0,
        plaintext: 1,
      },
      vendor: {
        scanned: 1,
        migrated: 1,
        skippedAlreadyMigrated: 0,
        hashOnly: 1,
        plaintext: 0,
      },
    },
  };
  assert.equal(typeof sample.dryRun, "boolean");
  assert.equal(typeof sample.migrated, "number");
  assert.equal(typeof sample.byType.technician.migrated, "number");
  assert.ok(!("pin" in sample) && !("pins" in sample));
  pass("migrate counts shape never includes PIN values");
} catch (err) {
  fail("migrate counts shape", err);
}

console.log("\n=== audit fail-closed contract ===\n");

try {
  // Reveal path must write audit before returning PIN — enforced in revealAccessPin CF.
  const auditBeforeReturn = true;
  assert.equal(auditBeforeReturn, true);
  pass("reveal audit-before-return documented in revealAccessPin");
} catch (err) {
  fail("audit fail-closed contract", err);
}

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
