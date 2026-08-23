import assert from "node:assert/strict";
import { deriveVendorOrderFulfillmentLabel } from "../src/dispatcher/vendorJobCardStatus.ts";
import {
  createVendorRunDetailsCache,
  enrichVendorRunFulfillment,
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
assert.equal(first[1].items[0].qtyReceived, 1);

const second = await enrichVendorRunFulfillment(
  [listOnly, alreadyHydrated],
  "token-a",
  fetchDetails,
  cache,
);
assert.equal(fetchCount, 1, "reuses session cache on second enrich");
assert.equal(second[0].items[0].qtyBackordered, 1);

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

console.log("PASS: test-vendor-run-fulfillment-hydration (6 cases)");
