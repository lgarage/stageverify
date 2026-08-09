/**
 * Pure unit tests for scheduleInvoiceShellBackfill fire-and-forget contract.
 * Usage: npm run test:invoice-shell-backfill-defer
 */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const { scheduleInvoiceShellBackfill, invoiceShellBackfillCandidate } =
  await import(
    pathToFileURL(
      resolve(process.cwd(), "src/dispatcher/invoiceShellBackfillSchedule.ts"),
    ).href
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

try {
  assert.equal(
    invoiceShellBackfillCandidate({
      reviewStatus: "approved",
      importStatus: "parsed",
    }),
    true,
  );
  assert.equal(
    invoiceShellBackfillCandidate({
      reviewStatus: "approved",
      importStatus: "issue",
    }),
    false,
  );
  assert.equal(
    invoiceShellBackfillCandidate({
      reviewStatus: "pending",
      importStatus: "parsed",
    }),
    false,
  );
  pass("invoiceShellBackfillCandidate filters");
} catch (err) {
  fail("invoiceShellBackfillCandidate filters", err);
}

{
  let ensureCalls = 0;
  let listCalls = 0;
  let settled = null;

  scheduleInvoiceShellBackfill(
    [
      {
        id: "a",
        reviewStatus: "approved",
        importStatus: "parsed",
        createdAt: "2026-01-01",
      },
    ],
    (result) => {
      settled = result;
    },
    {
      ensure: () =>
        new Promise((resolvePromise) => {
          ensureCalls += 1;
          setTimeout(
            () =>
              resolvePromise({ linkedCount: 0, failedCount: 0, errors: [] }),
            30,
          );
        }),
      list: async () => {
        listCalls += 1;
        return [];
      },
    },
  );

  try {
    assert.equal(ensureCalls, 1);
    assert.equal(settled, null);
    pass("schedule returns synchronously without awaiting ensure");
  } catch (err) {
    fail("schedule returns synchronously without awaiting ensure", err);
  }

  await new Promise((r) => setTimeout(r, 60));
  try {
    assert.deepEqual(settled, { items: null, errors: [] });
    assert.equal(listCalls, 0);
    pass("linkedCount 0 → onSettled null items, no list");
  } catch (err) {
    fail("linkedCount 0 → onSettled null items, no list", err);
  }
}

{
  let settled = null;
  scheduleInvoiceShellBackfill(
    [{ id: "b", createdAt: "2026-01-02" }],
    (result) => {
      settled = result;
    },
    {
      ensure: async () => ({
        linkedCount: 1,
        failedCount: 0,
        errors: [],
      }),
      list: async () => [
        { id: "b", createdAt: "2026-01-02" },
        { id: "a", createdAt: "2026-01-01" },
      ],
    },
  );
  await new Promise((r) => setTimeout(r, 20));
  try {
    assert.ok(settled?.items);
    assert.equal(settled.items[0].id, "b");
    pass("linkedCount > 0 → list + refreshed items");
  } catch (err) {
    fail("linkedCount > 0 → list + refreshed items", err);
  }
}

console.log(
  `\ninvoice-shell-backfill-defer: ${passed} passed, ${failed} failed`,
);
if (failed > 0) process.exit(1);
