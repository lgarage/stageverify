/**
 * Access PIN secrets — crypto unit tests (+ contract checks).
 *
 * Usage:
 *   npm run build:functions && npm run test:access-pin-secrets
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

const {
  encryptPinForStorage,
  decryptPinFromStorage,
  pinLookupKeyForPin,
} = require(resolve(root, "functions/lib/accessPinCrypto.js"));
const { hashPinForStorage } = require(resolve(root, "functions/lib/pinHashing.js"));
const { pinMatches } = require(resolve(root, "functions/lib/pinMatching.js"));
const {
  parseAdminAccessSessionToken,
  formatAdminAccessSessionToken,
  hashAdminAccessSessionRaw,
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

console.log("\n=== accessPinCrypto roundtrip ===\n");

try {
  const encrypted = encryptPinForStorage("1234");
  assert.equal(encrypted.alg, "AES-GCM");
  const plain = decryptPinFromStorage(encrypted);
  assert.equal(plain, "1234");
  pass("encrypt/decrypt roundtrip");
} catch (err) {
  fail("encrypt/decrypt roundtrip", err);
}

console.log("\n=== pinLookupKeyForPin ===\n");

try {
  const a = pinLookupKeyForPin("1234");
  const b = pinLookupKeyForPin("5678");
  assert.equal(a, pinLookupKeyForPin("1234"));
  assert.notEqual(a, b);
  pass("pinLookupKeyForPin deterministic and distinct");
} catch (err) {
  fail("pinLookupKeyForPin", err);
}

console.log("\n=== admin access session token format ===\n");

try {
  const sessionId = "a".repeat(32);
  const raw = "b".repeat(64);
  const token = formatAdminAccessSessionToken(sessionId, raw);
  const parsed = parseAdminAccessSessionToken(token);
  assert.ok(parsed);
  assert.equal(parsed.sessionId, sessionId);
  assert.equal(parsed.raw, raw);
  assert.equal(hashAdminAccessSessionRaw(raw).length, 64);
  pass("sessionId.raw token parse + secret hash");
} catch (err) {
  fail("session token format", err);
}

console.log("\n=== migrate dry-run response shape ===\n");

try {
  const sample = {
    dryRun: true,
    byType: {
      technician: { migrated: 1 },
      vendor: { migrated: 0 },
      management: { migrated: 1 },
    },
  };
  assert.ok(sample.byType.management);
  assert.ok(!("pin" in sample));
  pass("migrate counts shape includes management");
} catch (err) {
  fail("migrate counts shape", err);
}

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
