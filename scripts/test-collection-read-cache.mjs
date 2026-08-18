/**
 * Pure unit tests for dispatcher collection-read coalescing cache.
 * Usage: npm run test:collection-read-cache
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";

const mod = await import(
  resolve(process.cwd(), "src/dispatcher/collectionReadCache.ts")
);
const { DISPATCHER_READ_CACHE_TTL_MS, isReadCacheFresh, createCollectionReadCache } =
  mod;

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
  assert.equal(DISPATCHER_READ_CACHE_TTL_MS, 4_000);
  pass("TTL is 4s");
} catch (err) {
  fail("TTL is 4s", err);
}

try {
  assert.equal(isReadCacheFresh(1000, 1000 + 3_999), true);
  pass("fresh just under TTL");
} catch (err) {
  fail("fresh just under TTL", err);
}

try {
  assert.equal(isReadCacheFresh(1000, 1000 + 4_000), false);
  pass("stale at exact TTL");
} catch (err) {
  fail("stale at exact TTL", err);
}

{
  const cache = createCollectionReadCache(4_000);
  let loads = 0;
  const loader = async () => {
    loads += 1;
    return { n: loads };
  };
  try {
    const [a, b, c] = await Promise.all([
      cache.read("k", loader),
      cache.read("k", loader),
      cache.read("k", loader),
    ]);
    assert.equal(loads, 1);
    assert.equal(a.n, 1);
    assert.equal(b.n, 1);
    assert.equal(c.n, 1);
    pass("concurrent reads share one loader");
  } catch (err) {
    fail("concurrent reads share one loader", err);
  }

  try {
    const d = await cache.read("k", loader, { nowMs: Date.now() });
    assert.equal(loads, 1);
    assert.equal(d.n, 1);
    pass("TTL hit does not reload");
  } catch (err) {
    fail("TTL hit does not reload", err);
  }

  try {
    const e = await cache.read("k", loader, { bypass: true });
    assert.equal(loads, 2);
    assert.equal(e.n, 2);
    pass("bypass reloads");
  } catch (err) {
    fail("bypass reloads", err);
  }

  try {
    cache.invalidate("k");
    const f = await cache.read("k", loader);
    assert.equal(loads, 3);
    assert.equal(f.n, 3);
    pass("invalidate forces reload");
  } catch (err) {
    fail("invalidate forces reload", err);
  }
}

{
  const cache = createCollectionReadCache(4_000);
  let loads = 0;
  try {
    await cache
      .read("err", async () => {
        loads += 1;
        throw new Error("boom");
      })
      .catch(() => undefined);
    await cache.read("err", async () => {
      loads += 1;
      return "ok";
    });
    assert.equal(loads, 2);
    pass("failed loader is not stuck inflight");
  } catch (err) {
    fail("failed loader is not stuck inflight", err);
  }
}

console.log(`\ncollection-read-cache: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
