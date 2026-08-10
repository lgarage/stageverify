/**
 * Pure unit tests for D-90 vendor Delivered item truth helper.
 * Run: npm run test:vendor-delivered-item-truth
 */

import {
  computeCompleteAllItemTruth,
  computeExceptionItemTruth,
  computeVendorDeliveredItemStatus,
  parseLineExceptions,
  itemTruthChanged,
} from "../functions/src/vendorDeliveredItemTruth.ts";

const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

// A — everything arrived (no prior BO)
{
  const t = computeCompleteAllItemTruth({ qtyOrdered: 10, qtyBackordered: 0 });
  assert(t.qtyReceived === 10, "A received");
  assert(t.qtyMissing === 0, "A missing");
  assert(t.qtyBackordered === 0, "A BO");
  assert(t.qtyDamaged === 0, "A damaged");
  assert(
    t.qtyReceived + t.qtyBackordered + t.qtyMissing + t.qtyDamaged === 10,
    "A invariant",
  );
  assert(t.status === "received", "A status");
}

// G — complete-all preserves invoice-seeded BO
{
  const t = computeCompleteAllItemTruth({ qtyOrdered: 10, qtyBackordered: 2 });
  assert(t.qtyReceived === 8, "G received = ordered - prior BO");
  assert(t.qtyBackordered === 2, "G preserves BO");
  assert(t.qtyMissing === 0, "G missing");
  assert(t.status === "partial", "G status partial");
}

// B — 8 received, 2 backordered
{
  const t = computeExceptionItemTruth(10, {
    qtyReceived: 8,
    qtyBackordered: 2,
    qtyDamaged: 0,
  });
  assert(t.qtyMissing === 0, "B missing not double-counted");
  assert(t.qtyBackordered === 2, "B BO");
  assert(t.status === "partial", "B status");
}

// C — 8 received, 2 missing
{
  const t = computeExceptionItemTruth(10, {
    qtyReceived: 8,
    qtyBackordered: 0,
    qtyDamaged: 0,
  });
  assert(t.qtyMissing === 2, "C missing");
  assert(t.qtyBackordered === 0, "C no invented BO");
}

// D — damaged bucket
{
  const t = computeExceptionItemTruth(10, {
    qtyReceived: 7,
    qtyBackordered: 0,
    qtyDamaged: 3,
  });
  assert(t.qtyMissing === 0, "D missing");
  assert(t.qtyDamaged === 3, "D damaged");
}

// Over-account rejected
{
  let threw = false;
  try {
    computeExceptionItemTruth(10, {
      qtyReceived: 8,
      qtyBackordered: 2,
      qtyDamaged: 1,
    });
  } catch {
    threw = true;
  }
  assert(threw, "over-account throws");
}

// Shortfall alone is not backorder status when received=0 missing=all
{
  const t = computeExceptionItemTruth(10, {
    qtyReceived: 0,
    qtyBackordered: 0,
    qtyDamaged: 0,
  });
  assert(t.qtyMissing === 10, "all missing");
  assert(t.status === "missing", "missing status not backordered");
}

// parseLineExceptions requires all three fields
{
  assert(parseLineExceptions(undefined)?.length === 0, "omit → empty");
  assert(
    parseLineExceptions([{ itemId: "i1", qtyReceived: 1 }]) === null,
    "partial object rejected",
  );
  assert(
    parseLineExceptions([
      { itemId: "i1", qtyReceived: 1, qtyBackordered: 0, qtyDamaged: 0 },
    ])?.length === 1,
    "full object accepted",
  );
}

assert(
  itemTruthChanged(
    { qtyReceived: 0, qtyMissing: 0, qtyDamaged: 0, qtyBackordered: 0 },
    computeCompleteAllItemTruth({ qtyOrdered: 1 }),
  ),
  "changed detects complete-all write",
);

assert(
  computeVendorDeliveredItemStatus({
    qtyOrdered: 5,
    qtyReceived: 0,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 5,
  }) === "backordered",
  "pure BO status",
);

if (failures.length) {
  console.error("FAIL", failures);
  process.exit(1);
}
console.log(`PASS vendor-delivered-item-truth (${7 + 5} cases)`);
