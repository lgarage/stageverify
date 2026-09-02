/**
 * Unit tests for operator prototype allowlist gate (client-only; not a security boundary).
 * Usage: npm run test:operator-access-gate
 */
import assert from "node:assert/strict";
import {
  isOperatorPrototypeAllowed,
  normalizeOperatorAllowlist,
} from "../src/operator/operatorAccess.ts";

function allowedWithRaw(email, raw) {
  const allowlist = normalizeOperatorAllowlist(raw);
  if (!email) return false;
  if (allowlist.length === 0) return false;
  return allowlist.includes(email.trim().toLowerCase());
}

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

try {
  assert.equal(normalizeOperatorAllowlist(undefined).length, 0);
  assert.equal(allowedWithRaw("ops@example.com", undefined), false);
  pass("empty/unset allowlist denies");
} catch (err) {
  fail("empty/unset allowlist denies", err);
}

try {
  assert.equal(allowedWithRaw(null, "ops@example.com"), false);
  assert.equal(allowedWithRaw(undefined, "ops@example.com"), false);
  assert.equal(allowedWithRaw("", "ops@example.com"), false);
  pass("null/empty email denies");
} catch (err) {
  fail("null/empty email denies", err);
}

try {
  assert.equal(
    allowedWithRaw("Ops@Example.COM", "ops@example.com,other@test.com"),
    true,
  );
  assert.equal(
    allowedWithRaw("OTHER@test.com", "ops@example.com,other@test.com"),
    true,
  );
  pass("case-insensitive allow when listed");
} catch (err) {
  fail("case-insensitive allow when listed", err);
}

try {
  assert.equal(
    allowedWithRaw("not-listed@example.com", "ops@example.com"),
    false,
  );
  assert.equal(
    allowedWithRaw("ops@example.com", "   ,  , "),
    false,
  );
  pass("non-match and whitespace-only allowlist deny");
} catch (err) {
  fail("non-match and whitespace-only allowlist deny", err);
}

try {
  assert.equal(typeof isOperatorPrototypeAllowed, "function");
  assert.equal(isOperatorPrototypeAllowed(null), false);
  pass("isOperatorPrototypeAllowed export fail-closed without env");
} catch (err) {
  fail("isOperatorPrototypeAllowed export fail-closed without env", err);
}

console.log(`\ntest:operator-access-gate — ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("test:operator-access-gate PASS");
