import assert from "node:assert/strict";
import { deriveVendorOrderFulfillmentLabel } from "../src/dispatcher/vendorJobCardStatus.ts";
import {
  createVendorRunDetailsCache,
  enrichVendorRunFulfillment,
  invalidateVendorRunDetailsCache,
  vendorRunFulfillmentUsesPhysicalFallback,
} from "../src/dispatcher/vendorRunFulfillmentHydration.ts";

const listOnly = {
  deliveryId: "d1",
  jobId: "job-1",
  jobName: "Job One",
  orderNumber: "100",
  vendorPhysicalDropoffConfirmed: true,
  hasAssignableSpot: true,
  stagingLocationCodes: ["G2"],
  items: [{ id: "i1", description: "Unit", qtyOrdered: 2 }],
};
const alreadyHydrated = {
  ...listOnly,
  deliveryId: "d2",
  items: [
    {
      id: "i2",
      description: "Unit",
      qtyOrdered: 2,
      qtyReceived: 1,
      qtyBackordered: 1,
      status: "backordered",
    },
  ],
};

let fetchCount = 0;
const fetchedIds = [];
async function fetchDetails({ deliveryId }) {
  fetchCount += 1;
  fetchedIds.push(deliveryId);
  return {
    delivery: {
      vendorPhysicalDropoffConfirmedAt: "2026-08-22T10:00:00.000Z",
    },
    items: [
      {
        id: "i1",
        description: "Unit",
        qtyOrdered: 2,
        qtyReceived: 1,
        qtyBackordered: 1,
        status: "backordered",
      },
    ],
  };
}

const cache = createVendorRunDetailsCache();
const first = await enrichVendorRunFulfillment(
  [listOnly, alreadyHydrated],
  "token-a",
  fetchDetails,
  cache,
);
assert.equal(fetchCount, 1, "fetches only rows missing qtyReceived");
assert.deepEqual(fetchedIds, ["d1"]);
assert.equal(first[0].items[0].qtyReceived, 1);
assert.equal(
  first[0].vendorPhysicalDropoffConfirmedAt,
  "2026-08-22T10:00:00.000Z",
  "copies timestamp from details.delivery",
);
assert.equal(first[1].items[0].qtyReceived, 1);

const second = await enrichVendorRunFulfillment(
  [listOnly, alreadyHydrated],
  "token-a",
  fetchDetails,
  cache,
);
assert.equal(fetchCount, 1, "reuses session cache on second enrich");
assert.equal(second[0].items[0].qtyBackordered, 1);
assert.equal(
  second[0].vendorPhysicalDropoffConfirmedAt,
  "2026-08-22T10:00:00.000Z",
  "timestamp survives cache reuse",
);

const emptyFetchCount = { n: 0 };
const kept = await enrichVendorRunFulfillment(
  [listOnly],
  "token-b",
  async () => {
    emptyFetchCount.n += 1;
    return { items: [] };
  },
);
assert.equal(emptyFetchCount.n, 1);
assert.equal(kept[0].items[0].description, "Unit");
assert.equal(kept[0].items[0].qtyReceived, undefined);

const listWithTimestamp = {
  ...listOnly,
  deliveryId: "d3",
  vendorPhysicalDropoffConfirmedAt: "2026-08-20T08:00:00.000Z",
};
const merged = await enrichVendorRunFulfillment(
  [listWithTimestamp],
  "token-c",
  async () => {
    throw new Error("should not fetch when qty already on row");
  },
  createVendorRunDetailsCache(),
);
assert.equal(
  merged[0].vendorPhysicalDropoffConfirmedAt,
  "2026-08-20T08:00:00.000Z",
  "keeps list-row timestamp when present",
);

const flatDetailsFetch = await enrichVendorRunFulfillment(
  [
    {
      ...listOnly,
      deliveryId: "d4",
      items: [{ id: "i4", description: "Unit", qtyOrdered: 1 }],
    },
  ],
  "token-d",
  async () => ({
    vendorPhysicalDropoffConfirmedAt: "2026-08-21T09:00:00.000Z",
    items: [
      {
        id: "i4",
        description: "Unit",
        qtyOrdered: 1,
        qtyReceived: 1,
      },
    ],
  }),
);
assert.equal(
  flatDetailsFetch[0].vendorPhysicalDropoffConfirmedAt,
  "2026-08-21T09:00:00.000Z",
  "accepts flattened details.vendorPhysicalDropoffConfirmedAt",
);

invalidateVendorRunDetailsCache(cache, "token-a", "d1");
const afterInvalidate = await enrichVendorRunFulfillment(
  [listOnly],
  "token-a",
  fetchDetails,
  cache,
);
assert.equal(fetchCount, 2, "invalidated cache refetches on next enrich");
assert.equal(
  afterInvalidate[0].vendorPhysicalDropoffConfirmedAt,
  "2026-08-22T10:00:00.000Z",
);

assert.equal(vendorRunFulfillmentUsesPhysicalFallback(listOnly.items), false);
assert.equal(
  deriveVendorOrderFulfillmentLabel({
    items: listOnly.items,
    vendorPhysicalDropoffConfirmed: vendorRunFulfillmentUsesPhysicalFallback(
      listOnly.items,
    )
      ? true
      : false,
  }),
  "Incomplete",
  "unhydrated list must not flash Delivered from physical drop-off",
);
assert.equal(
  deriveVendorOrderFulfillmentLabel({
    items: first[0].items,
    vendorPhysicalDropoffConfirmed: true,
  }),
  "Partial",
  "hydrated backorder remains Partial",
);

console.log("PASS: test-vendor-run-fulfillment-hydration (12 cases)");
