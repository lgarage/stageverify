/**
 * Unit: collectDeliveryStagingCodes + fulfillment/staging display helpers.
 */
import {
  collectDeliveryStagingCodes,
  hasActiveShopStagingAssignment,
  hasUnresolvedStagingLocationRefs,
  isShopStagingAssignmentMissing,
  siblingOccupiedStagingCodes,
  stagingNeededBannerBody,
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
  ["zone-g11", { id: "zone-g11", code: "G11", label: "G11", type: "ground", status: "Active" }],
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

const locByIdWithInactive = new Map([
  ...locById,
  [
    "zone-s2f-inactive",
    {
      id: "zone-s2f-inactive",
      code: "S2-F",
      label: "Shelf 2 — F",
      type: "shelf",
      status: "Inactive",
    },
  ],
  [
    "zone-s2f-active",
    {
      id: "zone-s2f-active",
      code: "S2-F",
      label: "Shelf 2 — F",
      type: "shelf",
      status: "Active",
    },
  ],
]);

assert(
  "inactive spot id does not resolve",
  collectDeliveryStagingCodes(
    { stagingLocationId: "zone-s2f-inactive" },
    locByIdWithInactive,
  ).length === 0,
);
assert(
  "inactive + Active duplicate: only Active id resolves",
  collectDeliveryStagingCodes(
    { stagingLocationId: "zone-s2f-active" },
    locByIdWithInactive,
  ).join(",") === "S2-F",
);
assert(
  "inactive-only assignment → staging missing",
  isShopStagingAssignmentMissing(
    {
      status: "pending",
      invoiceFulfillmentMethod: "delivery",
      stagingLocationId: "zone-s2f-inactive",
    },
    locByIdWithInactive,
  ) === true,
);

const early = {
  id: "delivery-2205-early",
  jobId: "job-6169474",
  status: "pending",
  invoiceFulfillmentMethod: "delivery",
};
const truck = {
  id: "delivery-truck-stock",
  jobId: "job-6169474",
  status: "arrived",
  invoiceFulfillmentMethod: "delivery",
  plannedStagingLocationIds: ["zone-g11"],
  updatedAt: "2026-10-23T22:16:47.060Z",
};
assert(
  "sibling occupied codes name G11",
  siblingOccupiedStagingCodes(early, [early, truck], locById).join(",") ===
    "G11",
);
assert(
  "banner names sibling spot",
  stagingNeededBannerBody(
    siblingOccupiedStagingCodes(early, [early, truck], locById),
  ) === "Another delivery on this job is at G11.",
);
assert(
  "banner default when no sibling spot",
  stagingNeededBannerBody(
    siblingOccupiedStagingCodes(early, [early], locById),
  ) === "Assign a location for receiving and pickup.",
);

const otherJob = {
  ...truck,
  id: "delivery-other-job",
  jobId: "job-other",
};
assert(
  "sibling helper ignores other jobs",
  siblingOccupiedStagingCodes(early, [early, otherJob], locById).length === 0,
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
