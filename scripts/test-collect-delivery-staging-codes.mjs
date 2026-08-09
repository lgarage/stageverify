/**
 * Unit: collectDeliveryStagingCodes + fulfillment/staging display helpers.
 */
import {
  collectDeliveryStagingCodes,
  hasActiveShopStagingAssignment,
  hasUnresolvedStagingLocationRefs,
  isShopStagingAssignmentMissing,
} from "../src/dispatcher/drawer/DrawerStagingLocationChips.tsx";
import {
  fulfillmentDisplayLabel,
  isWillCallPickupStagingListNa,
} from "../src/dispatcher/invoice/invoiceShellDisplayHelpers.ts";
import { isDispatcherTableStagingActionRequired } from "../src/dispatcher/deliveryDisplayHelpers.ts";

let passed = 0;
let failed = 0;
function assert(label, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`PASS: ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const locById = new Map([
  ["staging-1", { id: "staging-1", code: "G1", label: "G1", type: "zone", status: "Active" }],
  ["staging-2", { id: "staging-2", code: "G2", label: "G2", type: "zone", status: "Active" }],
]);

assert(
  "one staging location → G1",
  collectDeliveryStagingCodes(
    { stagingLocationId: "staging-1" },
    locById,
  ).join(",") === "G1",
);
assert(
  "multiple staging locations → G1,G2",
  collectDeliveryStagingCodes(
    {
      stagingLocationId: "staging-1",
      additionalStagingLocationIds: ["staging-2"],
    },
    locById,
  ).join(",") === "G1,G2",
);
assert(
  "planned-only resolves codes",
  collectDeliveryStagingCodes(
    { plannedStagingLocationIds: ["staging-2"] },
    locById,
  ).join(",") === "G2",
);
assert(
  "legacy code-as-id resolves via reverse index",
  collectDeliveryStagingCodes({ stagingLocationId: "G1" }, locById).join(",") ===
    "G1",
);
assert(
  "unknown id drops silently (no invent)",
  collectDeliveryStagingCodes(
    { stagingLocationId: "missing-zone" },
    locById,
  ).length === 0,
);
assert(
  "table label Vendor Drop-Off",
  fulfillmentDisplayLabel({ invoiceFulfillmentMethod: "delivery" }) ===
    "Vendor Drop-Off",
);
assert(
  "table label Will-Call / Pickup @ Vendor",
  fulfillmentDisplayLabel({ invoiceFulfillmentMethod: "will_call_pickup" }) ===
    "Will-Call / Pickup @ Vendor",
);
assert(
  "will-call list N/A",
  isWillCallPickupStagingListNa({
    invoiceFulfillmentMethod: "will_call_pickup",
  }) === true,
);
assert(
  "drop-off missing staging → action required",
  isDispatcherTableStagingActionRequired({
    status: "pending",
    invoiceFulfillmentMethod: "delivery",
  }) === true,
);
assert(
  "drop-off with planned staging → not action required",
  isDispatcherTableStagingActionRequired({
    status: "pending",
    invoiceFulfillmentMethod: "delivery",
    plannedStagingLocationIds: ["staging-1"],
  }) === false,
);
assert(
  "will-call never action-required for staging",
  isDispatcherTableStagingActionRequired({
    status: "pending",
    invoiceFulfillmentMethod: "will_call_pickup",
  }) === false,
);

assert(
  "stale planned id alone → no active staging",
  hasActiveShopStagingAssignment(
    { plannedStagingLocationIds: ["missing-zone"] },
    locById,
  ) === false,
);
assert(
  "stale planned id → staging assignment missing (drop-off)",
  isShopStagingAssignmentMissing(
    {
      status: "pending",
      invoiceFulfillmentMethod: "delivery",
      plannedStagingLocationIds: ["missing-zone"],
    },
    locById,
  ) === true,
);
assert(
  "stale planned id → unresolved refs when nothing resolves",
  hasUnresolvedStagingLocationRefs(
    { plannedStagingLocationIds: ["missing-zone"] },
    locById,
  ) === true,
);
assert(
  "active + stale extra ref → still active (not missing)",
  isShopStagingAssignmentMissing(
    {
      status: "pending",
      invoiceFulfillmentMethod: "delivery",
      stagingLocationId: "staging-1",
      plannedStagingLocationIds: ["missing-zone"],
    },
    locById,
  ) === false,
);
assert(
  "active + stale extra → unresolved helper false (codes exist)",
  hasUnresolvedStagingLocationRefs(
    {
      stagingLocationId: "staging-1",
      plannedStagingLocationIds: ["missing-zone"],
    },
    locById,
  ) === false,
);
assert(
  "Received + drop-off + no staging → missing",
  isShopStagingAssignmentMissing(
    {
      status: "arrived",
      invoiceFulfillmentMethod: "delivery",
    },
    locById,
  ) === true,
);
assert(
  "Will-Call + no staging → not missing (no card)",
  isShopStagingAssignmentMissing(
    {
      status: "pending",
      invoiceFulfillmentMethod: "will_call_pickup",
    },
    locById,
  ) === false,
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
