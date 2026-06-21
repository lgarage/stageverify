/**
 * Evidence model alignment — svscope §4–§5 exception-only DELIVERED path.
 * Run: npm run test:evidence-alignment
 */

import {
  computeDeliveryReadiness,
  computePhysicalDropoffComplete,
} from "../src/dispatcher/readiness.ts";

const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

const zeroQtyItems = [
  {
    id: "i1",
    deliveryOrderId: "del-1",
    description: "Coil",
    qtyOrdered: 2,
    qtyReceived: 0,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "pending",
  },
  {
    id: "i2",
    deliveryOrderId: "del-1",
    description: "Line set",
    qtyOrdered: 1,
    qtyReceived: 0,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "pending",
  },
];

const baseDelivery = {
  id: "del-1",
  orderNumber: "ORD-1007",
  jobId: "job-261042",
  vendorId: "vendor-johnstone",
  purchaseOrderId: "po-johnstone-45821",
  deliveryDate: "2026-06-12",
  stagingLocationId: "loc-g2",
  status: "arrived",
  createdAt: "2026-06-01T00:00:00Z",
  updatedAt: "2026-06-01T00:00:00Z",
};

const exceptionOnly = { vendorDeliveryMode: "exception_only" };

// 1 — exception_only DELIVERED satisfies physical side without vendor item qty
assert(
  computePhysicalDropoffComplete(
    { ...baseDelivery, vendorPhysicalDropoffConfirmed: true },
    zeroQtyItems,
    "exception_only",
  ),
  "exception_only DELIVERED → physical complete without qty",
);

// 2 — DELIVERED alone ≠ Ready (missing vendor order completeness)
const deliveredOnly = computeDeliveryReadiness(
  {
    ...baseDelivery,
    vendorPhysicalDropoffConfirmed: true,
    vendorPhysicalDropoffConfirmedAt: "2026-06-12T10:00:00Z",
    vendorOrderComplete: false,
  },
  zeroQtyItems,
  exceptionOnly,
);
assert(!deliveredOnly.readyForPickup, "DELIVERED alone is not Ready");
assert(
  deliveredOnly.evidence.readinessBlockReasons.includes("vendor_order_incomplete"),
  "DELIVERED alone blocks on vendor order",
);

// 3 — vendor order email alone ≠ Ready (missing physical drop-off)
const emailOnly = computeDeliveryReadiness(
  { ...baseDelivery, vendorOrderComplete: true },
  zeroQtyItems,
  exceptionOnly,
);
assert(!emailOnly.readyForPickup, "vendor order alone is not Ready");
assert(
  emailOnly.evidence.readinessBlockReasons.includes("physical_dropoff_incomplete"),
  "vendor order alone blocks on physical drop-off",
);

// 4 — both sources + staging + no blockers = Ready
const bothReady = computeDeliveryReadiness(
  {
    ...baseDelivery,
    vendorOrderComplete: true,
    vendorPhysicalDropoffConfirmed: true,
    vendorPhysicalDropoffConfirmedAt: "2026-06-12T10:00:00Z",
  },
  zeroQtyItems,
  exceptionOnly,
);
assert(bothReady.readyForPickup, "both sources + staging → Ready");

// 5 — full_checkin legacy still qty-gated (ignore vendor DELIVERED flag)
assert(
  !computePhysicalDropoffComplete(
    { ...baseDelivery, vendorPhysicalDropoffConfirmed: true },
    zeroQtyItems,
    "full_checkin",
  ),
  "full_checkin requires qty even when vendor DELIVERED flag set",
);

// 6 — idempotent duplicate DELIVERED: readiness unchanged on recompute
const first = computeDeliveryReadiness(
  {
    ...baseDelivery,
    vendorOrderComplete: true,
    vendorPhysicalDropoffConfirmed: true,
    vendorPhysicalDropoffConfirmedAt: "2026-06-12T10:00:00Z",
  },
  zeroQtyItems,
  exceptionOnly,
);
const second = computeDeliveryReadiness(
  {
    ...baseDelivery,
    vendorOrderComplete: true,
    vendorPhysicalDropoffConfirmed: true,
    vendorPhysicalDropoffConfirmedAt: "2026-06-12T10:00:00Z",
    submittedAt: "2026-06-12T10:05:00Z",
  },
  zeroQtyItems,
  exceptionOnly,
);
assert(
  first.readyForPickup === second.readyForPickup &&
    first.deliveryStatus === second.deliveryStatus &&
    first.evidence.readinessBlockReasons.join() ===
      second.evidence.readinessBlockReasons.join(),
  "duplicate DELIVERED recalc is idempotent",
);

// staging required when vendor confirmed drop-off
const noStaging = computeDeliveryReadiness(
  {
    ...baseDelivery,
    stagingLocationId: "",
    vendorOrderComplete: true,
    vendorPhysicalDropoffConfirmed: true,
  },
  zeroQtyItems,
  exceptionOnly,
);
assert(!noStaging.readyForPickup, "DELIVERED without staging location is not Ready");

// 7 — blocking issue prevents Ready
const withBlocker = computeDeliveryReadiness(
  {
    ...baseDelivery,
    vendorOrderComplete: true,
    vendorPhysicalDropoffConfirmed: true,
    vendorPhysicalDropoffConfirmedAt: "2026-06-12T10:00:00Z",
    openBlockingIssueCount: 1,
  },
  zeroQtyItems,
  exceptionOnly,
);
assert(!withBlocker.readyForPickup, "blocking issue prevents Ready");
assert(
  withBlocker.evidence.readinessBlockReasons.includes("unresolved_blocking_issues"),
  "blocking issue reason present",
);

if (failures.length) {
  console.error("FAIL evidence alignment tests:");
  for (const f of failures) console.error(" -", f);
  process.exit(1);
}

console.log("PASS evidence model alignment (7 scenarios)");
