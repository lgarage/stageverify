/**
 * Access PIN length validation — asAccessPin contract tests.
 *
 * Usage:
 *   npm run build:functions && npm run test:access-pin-length
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const root = process.cwd();
const require = createRequire(import.meta.url);

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

function expectAccept(value, label) {
  try {
    const result = asAccessPin(value);
    assert.ok(result, `expected accept for ${label}`);
    pass(`accept ${label} → "${result}"`);
  } catch (err) {
    fail(`accept ${label}`, err);
  }
}

function expectReject(value, label) {
  try {
    const result = asAccessPin(value);
    assert.equal(result, null, `expected reject for ${label}, got "${result}"`);
    pass(`reject ${label}`);
  } catch (err) {
    fail(`reject ${label}`, err);
  }
}

console.log("\n=== asAccessPin length contract ===\n");

expectAccept("1234", "4 digits");
expectAccept("12345", "5 digits");
expectAccept("123456", "6 digits");
expectAccept(" 1234 ", "whitespace trim");
expectAccept("  567890  ", "6 digits with trim");

expectReject("123", "3 digits");
expectReject("1234567", "7 digits");
expectReject("abcd", "letters");
expectReject("12a4", "mixed alphanumeric");
expectReject("12 34", "internal spaces");
expectReject("", "empty string");
expectReject("   ", "whitespace only");
expectReject(null, "null");
expectReject(undefined, "undefined");
expectReject(1234, "number type");

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
