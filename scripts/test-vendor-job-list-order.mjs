import assert from "node:assert/strict";
import {
  isVendorJobCardDelivered,
  mergeVendorVisibleCompletedRows,
  orderVendorJobsDeliveredLast,
  partitionVendorRunDeliveries,
  patchVendorRunCompleteRows,
  classifyVendorRunDeliveryRow,
  vendorRunCanComplete,
  VENDOR_COMPLETED_MS_24H,
  VENDOR_COMPLETED_MS_72H,
} from "../src/dispatcher/vendorJobListOrder.ts";

function row(id, delivered) {
  return { id, vendorPhysicalDropoffConfirmed: delivered };
}

function partitionRow(id, opts = {}) {
  return {
    id,
    deliveryId: id,
    vendorPhysicalDropoffConfirmed: opts.delivered ?? false,
    vendorPhysicalDropoffConfirmedAt: opts.at,
    status: opts.status,
    items: opts.items ?? [],
  };
}

function fullDeliveredItems() {
  return [{ id: "i1", qtyOrdered: 1, qtyReceived: 1 }];
}

function partialItems() {
  return [
    {
      id: "i1",
      qtyOrdered: 2,
      qtyReceived: 1,
      qtyBackordered: 1,
      status: "backordered",
    },
  ];
}

const source = [
  row("u1", false),
  row("d1", true),
  row("u2", false),
  row("d2", true),
  row("u3", false),
];
const originalIds = source.map((r) => r.id);

const unfinishedOnly = [row("a", false), row("b", false), row("c", false)];
assert.deepEqual(
  orderVendorJobsDeliveredLast(unfinishedOnly).map((r) => r.id),
  ["a", "b", "c"],
  "all unfinished jobs only → existing order preserved",
);

const deliveredOnly = [row("d1", true), row("d2", true), row("d3", true)];
assert.deepEqual(
  orderVendorJobsDeliveredLast(deliveredOnly).map((r) => r.id),
  ["d1", "d2", "d3"],
  "all delivered jobs only → existing order preserved",
);

const mixed = orderVendorJobsDeliveredLast(source);
assert.deepEqual(
  mixed.map((r) => r.id),
  ["u1", "u2", "u3", "d1", "d2"],
  "mixed unfinished + delivered → unfinished first, delivered bottom",
);
assert.ok(
  mixed.slice(0, 3).every((r) => r.vendorPhysicalDropoffConfirmed === false),
  "multiple unfinished jobs remain above delivered jobs",
);
assert.ok(
  mixed.slice(3).every((r) => r.vendorPhysicalDropoffConfirmed === true),
  "multiple delivered jobs grouped together at bottom",
);

assert.deepEqual(
  source.map((r) => r.id),
  originalIds,
  "source array is not mutated",
);

const exceptionLike = [
  row("partial", false),
  row("exception", false),
  row("backorder", false),
  row("done", true),
];
assert.deepEqual(
  orderVendorJobsDeliveredLast(exceptionLike).map((r) => r.id),
  ["partial", "exception", "backorder", "done"],
  "partial / exception / backorder stay unfinished unless the card flag is true",
);

assert.equal(isVendorJobCardDelivered({ vendorPhysicalDropoffConfirmed: true }), true);
assert.equal(isVendorJobCardDelivered({ vendorPhysicalDropoffConfirmed: false }), false);
assert.equal(isVendorJobCardDelivered({ vendorPhysicalDropoffConfirmed: undefined }), false);
assert.equal(isVendorJobCardDelivered({}), false);
assert.equal(
  isVendorJobCardDelivered({ vendorPhysicalDropoffConfirmed: null }),
  false,
  "null is not delivered — matches card === true check",
);

const timestampOnly = {
  id: "stale",
  vendorPhysicalDropoffConfirmed: false,
  vendorPhysicalDropoffConfirmedAt: "2026-08-01T00:00:00.000Z",
};
assert.equal(
  isVendorJobCardDelivered(timestampOnly),
  false,
  "timestamp alone does not count — cards use the boolean, not hub isVendorDeliveryConfirmed",
);
assert.equal(orderVendorJobsDeliveredLast([timestampOnly, row("d", true)])[0].id, "stale");

const nowMs = Date.parse("2026-08-23T12:00:00.000Z");
const hoursAgoIso = (hours) =>
  new Date(nowMs - hours * 60 * 60 * 1000).toISOString();

function deliveredLifecycleRow(id, hoursAgo, extra = {}) {
  return partitionRow(id, {
    delivered: true,
    at: hoursAgoIso(hoursAgo),
    items: fullDeliveredItems(),
    ...extra,
  });
}

assert.equal(VENDOR_COMPLETED_MS_24H, 24 * 60 * 60 * 1000);
assert.equal(VENDOR_COMPLETED_MS_72H, 72 * 60 * 60 * 1000);

assert.equal(
  classifyVendorRunDeliveryRow(deliveredLifecycleRow("23h59m", 23 + 59 / 60), nowMs),
  "recentCompleted",
  "23h59m → main recentCompleted",
);
assert.equal(
  classifyVendorRunDeliveryRow(deliveredLifecycleRow("24h", 24), nowMs),
  "completedSection",
  "exactly 24h → completed section",
);
assert.equal(
  classifyVendorRunDeliveryRow(deliveredLifecycleRow("24h01m", 24 + 1 / 60), nowMs),
  "completedSection",
  "24h01m → completed section",
);
assert.equal(
  classifyVendorRunDeliveryRow(deliveredLifecycleRow("48h", 48), nowMs),
  "completedSection",
  "48h → completed section",
);
assert.equal(
  classifyVendorRunDeliveryRow(deliveredLifecycleRow("71h59m", 71 + 59 / 60), nowMs),
  "completedSection",
  "71h59m → completed section",
);
assert.equal(
  classifyVendorRunDeliveryRow(deliveredLifecycleRow("72h", 72), nowMs),
  "completedSection",
  "exactly 72h → completed section (inclusive)",
);
assert.equal(
  classifyVendorRunDeliveryRow(deliveredLifecycleRow("72h01m", 72 + 1 / 60), nowMs),
  "hidden",
  "72h01m → hidden",
);
assert.equal(
  classifyVendorRunDeliveryRow(deliveredLifecycleRow("1h", 1), nowMs),
  "recentCompleted",
  "1h → main recentCompleted",
);

const missingTs = partitionRow("missing-ts", {
  delivered: true,
  items: fullDeliveredItems(),
});
assert.equal(
  classifyVendorRunDeliveryRow(missingTs, nowMs),
  "recentCompleted",
  "missing timestamp never hides",
);

const partialOldDropoff = partitionRow("partial-old", {
  delivered: true,
  at: hoursAgoIso(240),
  status: "partial",
  items: partialItems(),
});
assert.equal(
  classifyVendorRunDeliveryRow(partialOldDropoff, nowMs),
  "partial",
  "Partial stays main even with old drop-off timestamp",
);

const lifecycleSource = [
  partitionRow("open-b", { delivered: false, items: [] }),
  deliveredLifecycleRow("recent-a", 1),
  partitionRow("partial-first", {
    delivered: true,
    at: hoursAgoIso(200),
    items: partialItems(),
  }),
  partitionRow("open-a", { delivered: false, items: [] }),
  deliveredLifecycleRow("section-48h", 48),
  deliveredLifecycleRow("hidden-80h", 80),
];
const lifecycle = partitionVendorRunDeliveries(lifecycleSource, nowMs);
assert.deepEqual(
  lifecycle.mainList.map((r) => r.id),
  ["partial-first", "open-b", "open-a", "recent-a"],
  "Partial first, open next, recent completed last",
);
assert.deepEqual(
  lifecycle.completedDeliveries.map((r) => r.id),
  ["section-48h"],
  "24–72h fully completed only in collapsed section",
);
assert.ok(
  !lifecycle.mainList.some((r) => r.id === "hidden-80h") &&
    !lifecycle.completedDeliveries.some((r) => r.id === "hidden-80h"),
  ">72h hidden from both lists",
);

const undoRow = partitionRow("undo-me", {
  delivered: false,
  at: undefined,
  items: fullDeliveredItems(),
});
assert.equal(
  classifyVendorRunDeliveryRow(undoRow, nowMs),
  "open",
  "cleared drop-off returns to open group",
);

const orderWithinGroups = [
  partitionRow("open-2", { delivered: false }),
  partitionRow("open-1", { delivered: false }),
  deliveredLifecycleRow("recent-2", 2),
  deliveredLifecycleRow("recent-1", 1),
  partitionRow("partial-2", { delivered: true, items: partialItems() }),
  partitionRow("partial-1", { delivered: true, items: partialItems() }),
];
const grouped = partitionVendorRunDeliveries(orderWithinGroups, nowMs);
assert.deepEqual(
  grouped.mainList.map((r) => r.id),
  ["partial-2", "partial-1", "open-2", "open-1", "recent-2", "recent-1"],
  "source order preserved inside each main-list group",
);

const serverRecent = [partitionRow("open-1", { delivered: false })];
const omittedRecent = deliveredLifecycleRow("recent-omitted", 2);
assert.deepEqual(
  mergeVendorVisibleCompletedRows(serverRecent, [omittedRecent], nowMs).map(
    (r) => r.id,
  ),
  ["open-1", "recent-omitted"],
  "omitted <24h completed row recovered to recent",
);

const serverOpenOnly = [partitionRow("open-2", { delivered: false })];
const omitted48h = deliveredLifecycleRow("section-omitted", 48);
assert.deepEqual(
  mergeVendorVisibleCompletedRows(serverOpenOnly, [omitted48h], nowMs).map(
    (r) => r.id,
  ),
  ["open-2", "section-omitted"],
  "omitted 48h completed row recovered to completed section",
);

const omitted80h = deliveredLifecycleRow("hidden-omitted", 80);
assert.deepEqual(
  mergeVendorVisibleCompletedRows(serverOpenOnly, [omitted80h], nowMs).map(
    (r) => r.id,
  ),
  ["open-2"],
  "omitted >72h completed row stays hidden",
);

const serverWithRecent = [
  partitionRow("open-3", { delivered: false }),
  deliveredLifecycleRow("recent-server", 1),
];
const staleRecent = deliveredLifecycleRow("recent-server", 5);
staleRecent.staleMarker = true;
const mergedBoth = mergeVendorVisibleCompletedRows(
  serverWithRecent,
  [staleRecent],
  nowMs,
);
assert.equal(mergedBoth.length, 2);
assert.equal(mergedBoth[1].id, "recent-server");
assert.equal(mergedBoth[1].staleMarker, undefined, "server row wins when both present");

const omittedPartial = partitionRow("partial-omitted", {
  delivered: true,
  at: hoursAgoIso(2),
  items: partialItems(),
});
assert.deepEqual(
  mergeVendorVisibleCompletedRows(serverOpenOnly, [omittedPartial], nowMs).map(
    (r) => r.id,
  ),
  ["open-2"],
  "Partial omitted leftover is NOT recovered as completed",
);

const omittedWithZeroQty = {
  ...deliveredLifecycleRow("recent-zero-qty", 1),
  items: [{ id: "i1", qtyOrdered: 1, qtyReceived: 0 }],
  vendorPhysicalDropoffConfirmed: true,
};
assert.deepEqual(
  mergeVendorVisibleCompletedRows(serverOpenOnly, [omittedWithZeroQty], nowMs).map(
    (r) => r.id,
  ),
  ["open-2"],
  "zero qtyReceived with drop-off confirms does not recover as completed",
);
const omittedWithPatchedQty = {
  ...deliveredLifecycleRow("recent-patched-qty", 1),
  items: [{ id: "i1", qtyOrdered: 1, qtyReceived: 1 }],
  vendorPhysicalDropoffConfirmed: true,
};
assert.deepEqual(
  mergeVendorVisibleCompletedRows(serverOpenOnly, [omittedWithPatchedQty], nowMs).map(
    (r) => r.id,
  ),
  ["open-2", "recent-patched-qty"],
  "patched qtyReceived recovers omitted recent completed row",
);

function patchTestRow(id, opts = {}) {
  return {
    deliveryId: id,
    jobId: "job",
    jobName: "Shop",
    orderNumber: "ORDER",
    stagingLocationCodes: ["G1"],
    hasAssignableSpot: true,
    vendorPhysicalDropoffConfirmed: opts.delivered ?? false,
    vendorPhysicalDropoffConfirmedAt: opts.at,
    status: opts.status,
    items: opts.items ?? [],
  };
}

const partialCompleteSource = patchTestRow("partial-complete", {
  status: "partial",
  items: [
    {
      id: "i-partial",
      qtyOrdered: 2,
      qtyReceived: 0,
      qtyBackordered: 2,
      status: "backordered",
    },
  ],
});
const partialPatched = patchVendorRunCompleteRows(
  [partialCompleteSource],
  new Set(["partial-complete"]),
  nowMs,
)[0];
assert.equal(
  partialPatched.items[0].qtyReceived,
  0,
  "Partial complete patch keeps qtyReceived 0",
);
assert.equal(
  partialPatched.items[0].qtyBackordered,
  2,
  "Partial complete patch keeps backorder qty",
);
assert.equal(
  classifyVendorRunDeliveryRow(partialPatched, nowMs),
  "partial",
  "Partial complete patch stays in partial group",
);

const unhydratedCompleteSource = patchTestRow("open-complete", {
  items: [{ id: "i-open", qtyOrdered: 1, description: "Air handler" }],
});
const unhydratedPatched = patchVendorRunCompleteRows(
  [unhydratedCompleteSource],
  new Set(["open-complete"]),
  nowMs,
)[0];
assert.equal(
  unhydratedPatched.items[0].qtyReceived,
  1,
  "unhydrated complete patch fills qtyReceived from qtyOrdered",
);
assert.equal(
  classifyVendorRunDeliveryRow(unhydratedPatched, nowMs),
  "recentCompleted",
  "unhydrated complete patch classifies as recentCompleted",
);

const hydratedOpenZeroSource = patchTestRow("open-hydrated-zero", {
  items: [{ id: "i-open", qtyOrdered: 1, qtyReceived: 0 }],
});
const hydratedOpenZeroPatched = patchVendorRunCompleteRows(
  [hydratedOpenZeroSource],
  new Set(["open-hydrated-zero"]),
  nowMs,
)[0];
assert.equal(
  hydratedOpenZeroPatched.items[0].qtyReceived,
  1,
  "hydrated open qtyReceived 0 is filled on complete when not Partial",
);
assert.equal(
  classifyVendorRunDeliveryRow(hydratedOpenZeroPatched, nowMs),
  "recentCompleted",
  "hydrated open complete patch classifies as recentCompleted",
);

assert.equal(
  vendorRunCanComplete({ hasAssignableSpot: true, stagingLocationCodes: [] }),
  true,
  "vendorRunCanComplete true when hasAssignableSpot",
);
assert.equal(
  vendorRunCanComplete({
    hasAssignableSpot: false,
    stagingLocationCodes: ["G1"],
  }),
  true,
  "vendorRunCanComplete true when stagingLocationCodes has entry",
);
assert.equal(
  vendorRunCanComplete({ hasAssignableSpot: false, stagingLocationCodes: [] }),
  false,
  "vendorRunCanComplete false when neither spot nor codes",
);
assert.equal(
  vendorRunCanComplete({
    hasAssignableSpot: false,
    stagingLocationCodes: ["  "],
  }),
  false,
  "vendorRunCanComplete false when codes are blank",
);

console.log("PASS: test-vendor-job-list-order (43 cases)");
