/**
 * Pure unit tests for app settings cache freshness helper.
 * Usage: npm run test:app-settings-cache
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);

// Compile-free: duplicate the tiny pure helper logic by importing TS via tsx,
// or re-read the source contract. Prefer dynamic import of built path — use tsx.
const mod = await import(
  resolve(process.cwd(), "src/dispatcher/appSettingsCache.ts")
);
const { APP_SETTINGS_CACHE_TTL_MS, isAppSettingsCacheFresh } = mod;

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
  assert.equal(APP_SETTINGS_CACHE_TTL_MS, 60_000);
  pass("TTL is 60s");
} catch (err) {
  fail("TTL is 60s", err);
}

try {
  assert.equal(isAppSettingsCacheFresh(1000, 1000 + 59_999), true);
  pass("fresh just under TTL");
} catch (err) {
  fail("fresh just under TTL", err);
}

try {
  assert.equal(isAppSettingsCacheFresh(1000, 1000 + 60_000), false);
  pass("stale at exact TTL");
} catch (err) {
  fail("stale at exact TTL", err);
}

try {
  assert.equal(isAppSettingsCacheFresh(1000, 1000 + 60_001), false);
  pass("stale over TTL");
} catch (err) {
  fail("stale over TTL", err);
}

try {
  assert.equal(isAppSettingsCacheFresh(1000, 1500, 400), false);
  pass("custom TTL respected");
} catch (err) {
  fail("custom TTL respected", err);
}

console.log(`\napp-settings-cache: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
