/**
 * Manual Order Summary Delivered → physical staging gate (P1).
 * Run: npm run test:manual-item-receive-staging
 */
import {
  deliveryHasActualPhysicalStaging,
  deliveryHasAnyStagingRefs,
  manualDeliveredRequiresPhysicalStagingGate,
  buildManualReceiveStagingNavigateUrl,
  resolveManualDeliveredInlineStagingConfirm,
  buildManualDeliveredInlineConfirmMessage,
  buildManualDeliveredSpotCommit,
} from "../src/dispatcher/manualItemReceiveStaging.ts";
import {
  deliveryReferencesStagingLocation,
  findConflictingStagingHolder,
  mustAssertStagingLocationAvailable,
} from "../src/dispatcher/stagingOccupancy.ts";

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

const mockStagingLocs = [
  { id: "loc-g11", code: "G11", zoneId: "zone-g11" },
  { id: "loc-g12", code: "G12", zoneId: "zone-g12" },
];

// Inline confirm — single planned spot resolves (PS-1)
const inlinePlanned = resolveManualDeliveredInlineStagingConfirm(
  baseDelivery({ plannedStagingLocationIds: ["loc-g11"] }),
  mockStagingLocs,
);
assert(
  inlinePlanned?.locationId === "loc-g11" && inlinePlanned?.locationCode === "G11",
  "single planned spot → inline confirm target",
);
assert(
  buildManualDeliveredInlineConfirmMessage("G11") ===
    "Was this delivered to G11?",
  "inline confirm message uses spot code",
);

// Inline confirm — no refs
assert(
  resolveManualDeliveredInlineStagingConfirm(baseDelivery(), mockStagingLocs) ===
    null,
  "no assigned spot → no inline confirm",
);

// Inline confirm — multiple planned spots → map path
assert(
  resolveManualDeliveredInlineStagingConfirm(
    baseDelivery({
      plannedStagingLocationIds: ["loc-g11", "loc-g12"],
    }),
    mockStagingLocs,
  ) === null,
  "multiple assigned spots → no inline confirm",
);

// Inline confirm — actual physical already set → no inline (direct receive)
assert(
  resolveManualDeliveredInlineStagingConfirm(
    baseDelivery({ stagingLocationId: "loc-g11" }),
    mockStagingLocs,
  ) === null,
  "actual physical staging → no inline confirm",
);

// Code-form ref resolves to the location id
const inlineByCode = resolveManualDeliveredInlineStagingConfirm(
  baseDelivery({ plannedStagingLocationIds: ["g-11"] }),
  mockStagingLocs,
);
assert(
  inlineByCode?.locationId === "loc-g11" && inlineByCode?.locationCode === "G11",
  "code-form planned ref → canonical G11",
);

// Same spot stored as id and code is still one assigned spot
const inlineAliased = resolveManualDeliveredInlineStagingConfirm(
  baseDelivery({ plannedStagingLocationIds: ["loc-g11", "G11"] }),
  mockStagingLocs,
);
assert(
  inlineAliased?.locationId === "loc-g11",
  "id plus code alias → one inline target",
);

// Unresolvable alone, or mixed with a real spot, stays on the map path
assert(
  resolveManualDeliveredInlineStagingConfirm(
    baseDelivery({ plannedStagingLocationIds: ["missing-spot"] }),
    mockStagingLocs,
  ) === null,
  "unresolvable spot → no inline confirm",
);
assert(
  resolveManualDeliveredInlineStagingConfirm(
    baseDelivery({ plannedStagingLocationIds: ["loc-g11", "missing-spot"] }),
    mockStagingLocs,
  ) === null,
  "resolvable plus unresolvable → no inline confirm",
);

// Occupancy: planned-only must still assert. Actual hold may skip.
const plannedOnly = baseDelivery({
  id: "delivery-1",
  status: "pending",
  plannedStagingLocationIds: ["loc-g11"],
});
assert(
  deliveryReferencesStagingLocation(plannedOnly, "loc-g11") === true,
  "planned id references the spot",
);
assert(
  deliveryReferencesStagingLocation(plannedOnly, "G11") === false,
  "planned id does not match a code string",
);
assert(
  mustAssertStagingLocationAvailable(plannedOnly, "loc-g11") === true,
  "planned-only must not skip occupancy assert",
);
assert(
  mustAssertStagingLocationAvailable(
    baseDelivery({ stagingLocationId: "loc-g11" }),
    "loc-g11",
  ) === false,
  "actual hold skips occupancy assert",
);

const otherActual = {
  id: "delivery-other",
  status: "pending",
  orderNumber: "ORD-9",
  stagingLocationId: "loc-g11",
  plannedStagingLocationIds: [],
};
const otherPlanned = {
  id: "delivery-planned",
  status: "pending",
  orderNumber: "ORD-8",
  stagingLocationId: "",
  plannedStagingLocationIds: ["loc-g11"],
};
const clearedHolder = {
  id: "delivery-cleared",
  status: "picked_up",
  orderNumber: "ORD-7",
  stagingLocationId: "loc-g11",
};
assert(
  findConflictingStagingHolder(
    [plannedOnly, otherActual],
    "delivery-1",
    "loc-g11",
  )?.id === "delivery-other",
  "another order's actual hold blocks inline confirm",
);
assert(
  findConflictingStagingHolder(
    [plannedOnly, otherPlanned],
    "delivery-1",
    "loc-g11",
  )?.id === "delivery-planned",
  "another order's planned hold blocks inline confirm",
);
assert(
  findConflictingStagingHolder([plannedOnly, clearedHolder], "delivery-1", "loc-g11") ===
    undefined,
  "cleared delivery does not block",
);
assert(
  findConflictingStagingHolder([plannedOnly], "delivery-1", "loc-g11") ===
    undefined,
  "this delivery's own planned spot does not block",
);

const spotCommit = buildManualDeliveredSpotCommit({
  stagingLocationId: "loc-g11",
  plannedStagingLocationIds: ["loc-g11", "G11"],
  qtyOrdered: 2,
  qtyReceived: 2,
  qtyMissing: 0,
  now: "2026-10-15T00:00:00.000Z",
});
assert(
  spotCommit.deliveryFields.stagingLocationId === "loc-g11" &&
    spotCommit.deliveryFields.plannedStagingLocationIds.length === 0 &&
    spotCommit.itemFields.qtyReceived === 2 &&
    spotCommit.itemFields.status === "received" &&
    spotCommit.releasedPlannedIds.length === 1 &&
    spotCommit.releasedPlannedIds[0] === "G11",
  "confirm payload sets the spot, clears planned, and marks received together",
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
