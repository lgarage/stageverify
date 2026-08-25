/**
 * Unit tests for delivery list paging helper.
 * Usage: npm run test:delivery-list-paging
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";

const mod = await import(
  resolve(process.cwd(), "src/dispatcher/deliveryListPaging.ts")
);
const { asPagedResult } = mod;

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

const items = Array.from({ length: 120 }, (_, i) => `item-${i + 1}`);

try {
  const p25 = asPagedResult(items, 1, 25);
  assert.equal(p25.items.length, 25);
  assert.equal(p25.items[0], "item-1");
  assert.equal(p25.items[24], "item-25");
  assert.equal(p25.page, 1);
  assert.equal(p25.pageSize, 25);
  assert.equal(p25.totalItems, 120);
  assert.equal(p25.totalPages, 5);
  pass("numeric pageSize 25 slice on page 1");
} catch (err) {
  fail("numeric pageSize 25 slice on page 1", err);
}

try {
  const p50 = asPagedResult(items, 2, 50);
  assert.equal(p50.items.length, 50);
  assert.equal(p50.items[0], "item-51");
  assert.equal(p50.page, 2);
  assert.equal(p50.pageSize, 50);
  assert.equal(p50.totalPages, 3);
  pass("numeric pageSize 50 slice on page 2");
} catch (err) {
  fail("numeric pageSize 50 slice on page 2", err);
}

try {
  const p100 = asPagedResult(items, 2, 100);
  assert.equal(p100.items.length, 20);
  assert.equal(p100.items[0], "item-101");
  assert.equal(p100.page, 2);
  assert.equal(p100.pageSize, 100);
  assert.equal(p100.totalPages, 2);
  pass("numeric pageSize 100 slice on page 2");
} catch (err) {
  fail("numeric pageSize 100 slice on page 2", err);
}

try {
  const all = asPagedResult(items, 3, "all");
  assert.equal(all.items.length, 120);
  assert.equal(all.page, 1);
  assert.equal(all.pageSize, "all");
  assert.equal(all.totalItems, 120);
  assert.equal(all.totalPages, 1);
  pass('All returns full set with page 1 and pageSize "all"');
} catch (err) {
  fail('All returns full set with page 1 and pageSize "all"', err);
}

try {
  const allIgnorePage = asPagedResult(items, 5, "all");
  assert.equal(allIgnorePage.page, 1);
  assert.equal(allIgnorePage.items.length, 120);
  pass("All ignores page > 1");
} catch (err) {
  fail("All ignores page > 1", err);
}

try {
  const afterAll = asPagedResult(items, 1, 25);
  assert.equal(afterAll.page, 1);
  assert.equal(afterAll.items.length, 25);
  pass("switching from All conceptually to 25 uses valid page 1 slice");
} catch (err) {
  fail("switching from All conceptually to 25 uses valid page 1 slice", err);
}

try {
  const empty = asPagedResult([], 1, 25);
  assert.deepEqual(empty.items, []);
  assert.equal(empty.totalItems, 0);
  assert.equal(empty.totalPages, 1);
  assert.equal(empty.page, 1);
  pass("empty array returns empty page with totalPages 1");
} catch (err) {
  fail("empty array returns empty page with totalPages 1", err);
}

try {
  const clamped = asPagedResult(items, 99, 25);
  assert.equal(clamped.page, 5);
  assert.equal(clamped.items.length, 20);
  assert.equal(clamped.items[0], "item-101");
  pass("page past end clamps to last page");
} catch (err) {
  fail("page past end clamps to last page", err);
}

console.log(`\ndelivery-list-paging: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
