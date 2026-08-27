/**
 * CF deliveryReadiness staging-assignment parity with FE readiness.ts (PR #192 / 6167419).
 * Run: npm run test:delivery-readiness-staging-parity
 *
 * Map color consumption (persisted readiness → occupancy → resolveSpotColor):
 * - readinessStatus ready_for_pickup → spot purple (readyForPickup: true)
 * - not_ready + occupied → spot orange (readyForPickup: false)
 */

import {
  computeDeliveryReadiness,
  computeStagingAssignmentComplete,
  deliveryHasCurrentShopStagingAssignment,
} from "../functions/src/deliveryReadiness.ts";
import { resolveSpotColor } from "../src/dispatcher/resolveSpotColor.ts";

const failures = [];
const NOW = "2026-08-25T00:00:00Z";

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function completeItem(qtyOrdered = 2, overrides = {}) {
  return {
    qtyOrdered,
    qtyReceived: qtyOrdered,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 0,
    ...overrides,
  };
}

function baseDelivery(overrides = {}) {
  return {
    status: "partial",
    vendorOrderComplete: true,
    vendorPhysicalDropoffConfirmed: true,
    stagingLocationId: "",
    ...overrides,
  };
}

function assertNoMutation(beforeDelivery, beforeItems, delivery, items, label) {
  assert(
    JSON.stringify(delivery) === JSON.stringify(beforeDelivery),
    `${label}: compute must not mutate delivery`,
  );
  assert(
    JSON.stringify(items) === JSON.stringify(beforeItems),
    `${label}: compute must not mutate items`,
  );
}

function runCase(label, delivery, items, expected, options = {}) {
  const beforeDelivery = JSON.parse(JSON.stringify(delivery));
  const beforeItems = JSON.parse(JSON.stringify(items));
  const mode = options.vendorDeliveryMode;

  const stagingComplete = computeStagingAssignmentComplete(delivery, items);
  if (expected.stagingAssignmentComplete !== undefined) {
    assert(
      stagingComplete === expected.stagingAssignmentComplete,
      `${label}: stagingAssignmentComplete expected ${expected.stagingAssignmentComplete}, got ${stagingComplete}`,
    );
  }

  const result = computeDeliveryReadiness(delivery, items, NOW, mode);
  assertNoMutation(beforeDelivery, beforeItems, delivery, items, label);

  if (expected.readyForPickup !== undefined) {
    assert(
      result.readyForPickup === expected.readyForPickup,
      `${label}: readyForPickup expected ${expected.readyForPickup}, got ${result.readyForPickup}`,
    );
  }
  if (expected.readinessStatus) {
    assert(
      result.readinessStatus === expected.readinessStatus,
      `${label}: readinessStatus expected ${expected.readinessStatus}, got ${result.readinessStatus}`,
    );
  }
  if (expected.deliveryStatus) {
    assert(
      result.deliveryStatus === expected.deliveryStatus,
      `${label}: deliveryStatus expected ${expected.deliveryStatus}, got ${result.deliveryStatus}`,
    );
  }
  if (expected.stagingAssignmentComplete !== undefined) {
    assert(
      result.stagingAssignmentComplete === expected.stagingAssignmentComplete,
      `${label}: result.stagingAssignmentComplete expected ${expected.stagingAssignmentComplete}, got ${result.stagingAssignmentComplete}`,
    );
  }
  if (expected.blockReasonIncludes) {
    for (const reason of expected.blockReasonIncludes) {
      assert(
        result.evidence.readinessBlockReasons.includes(reason),
        `${label}: expected block reason ${reason}, got ${JSON.stringify(result.evidence.readinessBlockReasons)}`,
      );
    }
  }
  if (expected.blockReasonExcludes) {
    for (const reason of expected.blockReasonExcludes) {
      assert(
        !result.evidence.readinessBlockReasons.includes(reason),
        `${label}: must not include block reason ${reason}, got ${JSON.stringify(result.evidence.readinessBlockReasons)}`,
      );
    }
  }
  if (expected.stagingLocationId === "") {
    assert(
      delivery.stagingLocationId === "",
      `${label}: stagingLocationId must remain empty (planned-only must not promote)`,
    );
  }
}

// 1 — planned-only loc-g12 (6167419 shape): fully received + vendor confirmed + vendor order complete
runCase(
  "case1-planned-only-g12",
  baseDelivery({ plannedStagingLocationIds: ["loc-g12"] }),
  [completeItem()],
  {
    readyForPickup: true,
    readinessStatus: "ready_for_pickup",
    deliveryStatus: "ready_for_pickup",
    stagingAssignmentComplete: true,
    blockReasonExcludes: ["staging_assignment_incomplete"],
    stagingLocationId: "",
  },
);

// 2 — actual stagingLocationId only (no planned)
runCase(
  "case2-stagingLocationId-only",
  baseDelivery({ stagingLocationId: "loc-g12", plannedStagingLocationIds: undefined }),
  [completeItem()],
  {
    readyForPickup: true,
    readinessStatus: "ready_for_pickup",
    deliveryStatus: "ready_for_pickup",
    stagingAssignmentComplete: true,
    blockReasonExcludes: ["staging_assignment_incomplete"],
  },
);

// 3 — additionalStagingLocationIds only
runCase(
  "case3-additionalStaging-only",
  baseDelivery({
    additionalStagingLocationIds: ["loc-g4"],
    plannedStagingLocationIds: undefined,
  }),
  [completeItem()],
  {
    readyForPickup: true,
    readinessStatus: "ready_for_pickup",
    deliveryStatus: "ready_for_pickup",
    stagingAssignmentComplete: true,
    blockReasonExcludes: ["staging_assignment_incomplete"],
  },
);

// 4 — no staging fields + received + confirmed → not ready
runCase(
  "case4-no-staging-fields",
  baseDelivery({
    stagingLocationId: "",
    additionalStagingLocationIds: undefined,
    plannedStagingLocationIds: undefined,
  }),
  [completeItem()],
  {
    readyForPickup: false,
    readinessStatus: "not_ready",
    stagingAssignmentComplete: false,
    blockReasonIncludes: ["staging_assignment_incomplete"],
  },
);

// 5 — partial qty + planned G12 → physical_dropoff_incomplete (full_checkin)
runCase(
  "case5-partial-qty-planned",
  baseDelivery({ plannedStagingLocationIds: ["loc-g12"] }),
  [completeItem(2, { qtyReceived: 1 })],
  {
    readyForPickup: false,
    readinessStatus: "not_ready",
    stagingAssignmentComplete: true,
    blockReasonIncludes: ["physical_dropoff_incomplete"],
  },
);

// 6 — backordered required item + planned G12 + otherwise complete
runCase(
  "case6-backorder-planned",
  baseDelivery({ plannedStagingLocationIds: ["loc-g12"] }),
  [completeItem(2, { qtyReceived: 1, qtyBackordered: 1 })],
  {
    readyForPickup: false,
    readinessStatus: "not_ready",
    stagingAssignmentComplete: true,
    blockReasonIncludes: ["unresolved_backorder", "physical_dropoff_incomplete"],
  },
);

// 7 — openBlockingIssueCount: 1 + planned G12 + otherwise complete
runCase(
  "case7-blocking-issue-planned",
  baseDelivery({ plannedStagingLocationIds: ["loc-g12"], openBlockingIssueCount: 1 }),
  [completeItem()],
  {
    readyForPickup: false,
    readinessStatus: "not_ready",
    stagingAssignmentComplete: true,
    blockReasonIncludes: ["unresolved_blocking_issues"],
    blockReasonExcludes: ["staging_assignment_incomplete"],
  },
);

// 8 — will-call skip: no staging → skips shop staging block
runCase(
  "case8-will-call-skip",
  baseDelivery({
    invoiceFulfillmentMethod: "will_call_pickup",
    stagingLocationId: "",
    plannedStagingLocationIds: undefined,
  }),
  [completeItem()],
  {
    readyForPickup: true,
    readinessStatus: "ready_for_pickup",
    deliveryStatus: "ready_for_pickup",
    blockReasonExcludes: ["staging_assignment_incomplete", "physical_dropoff_incomplete"],
  },
);

runCase(
  "case8-pickup-at-vendor-skip",
  baseDelivery({
    invoiceImportStatus: "pickup_at_vendor",
    stagingLocationId: "",
    plannedStagingLocationIds: undefined,
  }),
  [completeItem()],
  {
    readyForPickup: true,
    readinessStatus: "ready_for_pickup",
    blockReasonExcludes: ["staging_assignment_incomplete"],
  },
);

// 9 — undo vendorPhysicalDropoffConfirmed from case 1 shape
// full_checkin: qty still fully received → physical still complete
runCase(
  "case9-undo-vendor-confirmed-full-checkin",
  baseDelivery({
    plannedStagingLocationIds: ["loc-g12"],
    vendorPhysicalDropoffConfirmed: false,
  }),
  [completeItem()],
  {
    readyForPickup: true,
    readinessStatus: "ready_for_pickup",
    stagingAssignmentComplete: true,
    blockReasonExcludes: ["physical_dropoff_incomplete", "staging_assignment_incomplete"],
    stagingLocationId: "",
  },
);

// exception_only: clearing vendorPhysicalDropoffConfirmed → physical_dropoff_incomplete
runCase(
  "case9-undo-vendor-confirmed-exception-only",
  baseDelivery({
    plannedStagingLocationIds: ["loc-g12"],
    vendorPhysicalDropoffConfirmed: false,
  }),
  [completeItem()],
  {
    readyForPickup: false,
    readinessStatus: "not_ready",
    stagingAssignmentComplete: true,
    blockReasonIncludes: ["physical_dropoff_incomplete"],
    blockReasonExcludes: ["staging_assignment_incomplete"],
    stagingLocationId: "",
  },
  { vendorDeliveryMode: "exception_only" },
);

// 10 — planned-only + NOT received + NOT vendor confirmed → vacuous staging complete, not ready
runCase(
  "case10-planned-not-received-not-confirmed",
  baseDelivery({
    plannedStagingLocationIds: ["loc-g12"],
    vendorPhysicalDropoffConfirmed: false,
    vendorOrderComplete: false,
  }),
  [completeItem(2, { qtyReceived: 0 })],
  {
    readyForPickup: false,
    readinessStatus: "not_ready",
    stagingAssignmentComplete: true,
    blockReasonIncludes: ["vendor_order_incomplete", "physical_dropoff_incomplete"],
    blockReasonExcludes: ["staging_assignment_incomplete"],
    stagingLocationId: "",
  },
);

// 11 — PR #192 regression / fixture6167419
runCase(
  "case11-pr192-6167419",
  baseDelivery({
    plannedStagingLocationIds: ["loc-g12"],
    vendorOrderComplete: true,
    vendorPhysicalDropoffConfirmed: true,
    stagingLocationId: "",
    status: "partial",
  }),
  [completeItem(4)],
  {
    readyForPickup: true,
    readinessStatus: "ready_for_pickup",
    deliveryStatus: "ready_for_pickup",
    stagingAssignmentComplete: true,
    blockReasonExcludes: ["staging_assignment_incomplete"],
    stagingLocationId: "",
  },
);

// Whitespace-only planned id must NOT count as assignment
{
  const delivery = baseDelivery({ plannedStagingLocationIds: ["   "] });
  assert(
    deliveryHasCurrentShopStagingAssignment(delivery) === false,
    "whitespace-only plannedStagingLocationIds must not count as assignment",
  );
  const stagingComplete = computeStagingAssignmentComplete(delivery, [completeItem()]);
  assert(
    stagingComplete === false,
    "whitespace-only planned with received qty → stagingAssignmentComplete false",
  );
}

// 12 — map/location consumption via resolveSpotColor
{
  const occupancyReady = { G12: { readyForPickup: true } };
  const occupancyNotReady = { G12: { readyForPickup: false } };
  assert(
    resolveSpotColor("G12", occupancyReady, {}) === "purple",
    "case12: ready_for_pickup occupancy → purple",
  );
  assert(
    resolveSpotColor("G12", occupancyNotReady, {}) === "orange",
    "case12: not_ready occupied → orange",
  );
}

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

console.log("test-deliveryReadiness-staging-assignment-parity: all cases passed");
process.exit(0);
