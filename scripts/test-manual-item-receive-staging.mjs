/**
 * Manual Order Summary Delivered → physical staging gate (P1).
 * Run: npm run test:manual-item-receive-staging
 */
import {
  deliveryHasActualPhysicalStaging,
  deliveryHasAnyStagingRefs,
  manualDeliveredRequiresPhysicalStagingGate,
  buildManualReceiveStagingNavigateUrl,
} from "../src/dispatcher/manualItemReceiveStaging.ts";

const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function baseDelivery(overrides = {}) {
  return {
    invoiceFulfillmentMethod: "delivery",
    invoiceImportStatus: "pending",
    invoiceDeliverToSite: false,
    stagingLocationId: "",
    additionalStagingLocationIds: undefined,
    plannedStagingLocationIds: undefined,
    ...overrides,
  };
}

// Actual staging: primary id
assert(
  deliveryHasActualPhysicalStaging({ stagingLocationId: "loc-g12" }) === true,
  "stagingLocationId counts as actual physical staging",
);

// Actual staging: additional ids
assert(
  deliveryHasActualPhysicalStaging({
    stagingLocationId: "",
    additionalStagingLocationIds: ["loc-g4"],
  }) === true,
  "additionalStagingLocationIds counts as actual physical staging",
);

// Planned only — NOT actual (PR #216)
assert(
  deliveryHasActualPhysicalStaging({
    stagingLocationId: "",
    additionalStagingLocationIds: [],
    plannedStagingLocationIds: ["loc-g12"],
  }) === false,
  "planned-only must not count as actual physical staging",
);

// deliveryHasAnyStagingRefs
assert(
  deliveryHasAnyStagingRefs(baseDelivery()) === false,
  "no refs → deliveryHasAnyStagingRefs false",
);
assert(
  deliveryHasAnyStagingRefs(
    baseDelivery({ plannedStagingLocationIds: ["loc-g12"] }),
  ) === true,
  "planned-only → deliveryHasAnyStagingRefs true",
);
assert(
  deliveryHasAnyStagingRefs(baseDelivery({ stagingLocationId: "loc-g12" })) ===
    true,
  "actual staging → deliveryHasAnyStagingRefs true",
);

// Gate: Delivered + no actual → requires staging
assert(
  manualDeliveredRequiresPhysicalStagingGate(
    baseDelivery({ plannedStagingLocationIds: ["loc-g12"] }),
    "Delivered",
  ) === true,
  "Delivered with planned-only must gate on physical staging",
);

// Gate: Delivered + actual → no gate
assert(
  manualDeliveredRequiresPhysicalStagingGate(
    baseDelivery({ stagingLocationId: "loc-g12" }),
    "Delivered",
  ) === false,
  "Delivered with actual staging must not gate",
);

// Gate: Not Delivered → never gate
assert(
  manualDeliveredRequiresPhysicalStagingGate(baseDelivery(), "Not Delivered") ===
    false,
  "Not Delivered must never gate on staging",
);

// Gate: will-call skip
assert(
  manualDeliveredRequiresPhysicalStagingGate(
    baseDelivery({
      invoiceFulfillmentMethod: "will_call_pickup",
      stagingLocationId: "",
    }),
    "Delivered",
  ) === false,
  "will-call Delivered must skip shop staging gate",
);

// Case A — no refs: first physical assign (no reassign)
const urlNoRefs = buildManualReceiveStagingNavigateUrl(
  "delivery-1",
  "item-abc",
  { reassign: false },
);
assert(
  urlNoRefs.includes("assignDelivery=delivery-1"),
  "case A nav URL must include assignDelivery",
);
assert(
  urlNoRefs.includes("pendingItemReceive=item-abc"),
  "case A nav URL must carry pendingItemReceive",
);
assert(
  !urlNoRefs.includes("reassign=1"),
  "case A nav URL must NOT include reassign=1",
);

// Case B — planned or existing refs: reassign CF path
const urlPlanned = buildManualReceiveStagingNavigateUrl(
  "delivery-1",
  "item-abc",
  { reassign: true },
);
assert(
  urlPlanned.includes("reassign=1"),
  "case B nav URL must include reassign=1",
);
assert(
  urlPlanned.includes("pendingItemReceive=item-abc"),
  "case B nav URL must carry pendingItemReceive",
);

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

console.log("test-manual-item-receive-staging: all cases passed");
process.exit(0);
