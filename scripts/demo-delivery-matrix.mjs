/**
 * Offline demo delivery wiring matrix (seed fixtures).
 * Run: npx tsx scripts/demo-delivery-matrix.mjs
 */

import { computeDeliveryDisplayState } from "../src/dispatcher/deliveryDisplayHelpers.ts";

const demos = [
  {
    id: "delivery-1",
    order: "ORD-001",
    d: {
      id: "delivery-1",
      orderNumber: "ORD-001",
      jobId: "job-1",
      vendorId: "vendor-1",
      purchaseOrderId: "po-1",
      deliveryDate: "2026-05-30",
      stagingLocationId: "staging-2",
      status: "pending",
      createdAt: "",
      updatedAt: "",
    },
    items: [
      {
        id: "item-1",
        deliveryOrderId: "delivery-1",
        description: "RTU 5-ton",
        qtyOrdered: 2,
        qtyReceived: 0,
        qtyMissing: 2,
        qtyDamaged: 0,
        qtyBackordered: 0,
        status: "pending",
      },
      {
        id: "item-2",
        deliveryOrderId: "delivery-1",
        description: "Ductwork",
        qtyOrdered: 4,
        qtyReceived: 0,
        qtyMissing: 4,
        qtyDamaged: 0,
        qtyBackordered: 0,
        status: "pending",
      },
    ],
    expectedLabel: "Pending Delivery",
    expectedComputed: "pending",
  },
  {
    id: "delivery-2",
    order: "ORD-002",
    d: {
      id: "delivery-2",
      orderNumber: "ORD-002",
      jobId: "job-2",
      vendorId: "vendor-1",
      purchaseOrderId: "po-4",
      deliveryDate: "2026-06-01",
      status: "partial",
      issueSummary: "1 item backordered",
      createdAt: "",
      updatedAt: "",
    },
    items: [
      {
        id: "item-3",
        deliveryOrderId: "delivery-2",
        description: "GREENHECK FAN",
        qtyOrdered: 1,
        qtyReceived: 1,
        qtyMissing: 0,
        qtyDamaged: 0,
        qtyBackordered: 0,
        status: "received",
      },
      {
        id: "item-4",
        deliveryOrderId: "delivery-2",
        description: "BACKORDERED PART",
        qtyOrdered: 1,
        qtyReceived: 0,
        qtyMissing: 1,
        qtyDamaged: 0,
        qtyBackordered: 1,
        status: "backordered",
      },
    ],
    expectedLabel: "Partial",
    expectedComputed: "partial",
  },
  {
    id: "delivery-3",
    order: "ORD-004",
    d: {
      id: "delivery-3",
      orderNumber: "ORD-004",
      jobId: "job-3",
      vendorId: "vendor-1",
      purchaseOrderId: "po-5",
      deliveryDate: "2026-06-02",
      stagingLocationId: "staging-4",
      status: "partial",
      createdAt: "",
      updatedAt: "",
    },
    items: [
      {
        id: "item-6",
        deliveryOrderId: "delivery-3",
        description: "Thermostat",
        qtyOrdered: 3,
        qtyReceived: 2,
        qtyMissing: 1,
        qtyDamaged: 0,
        qtyBackordered: 0,
        status: "partial",
      },
      {
        id: "item-7",
        deliveryOrderId: "delivery-3",
        description: "Easyseal",
        qtyOrdered: 1,
        qtyReceived: 1,
        qtyMissing: 0,
        qtyDamaged: 0,
        qtyBackordered: 0,
        status: "received",
      },
    ],
    expectedLabel: "Partial",
    expectedComputed: "partial",
  },
  {
    id: "delivery-demo-vendor-1",
    order: "ORD-005",
    d: {
      id: "delivery-demo-vendor-1",
      orderNumber: "ORD-005",
      jobId: "job-1",
      vendorId: "vendor-1",
      purchaseOrderId: "po-demo-vendor-1",
      deliveryDate: "2026-06-02",
      status: "pending",
      createdAt: "",
      updatedAt: "",
    },
    items: [
      {
        id: "item-demo-v1-1",
        deliveryOrderId: "delivery-demo-vendor-1",
        description: "Thermostat",
        qtyOrdered: 1,
        qtyReceived: 0,
        qtyMissing: 1,
        qtyDamaged: 0,
        qtyBackordered: 0,
        status: "pending",
      },
      {
        id: "item-demo-v1-2",
        deliveryOrderId: "delivery-demo-vendor-1",
        description: "Easyseal",
        qtyOrdered: 6,
        qtyReceived: 0,
        qtyMissing: 6,
        qtyDamaged: 0,
        qtyBackordered: 0,
        status: "pending",
      },
      {
        id: "item-demo-v1-3",
        deliveryOrderId: "delivery-demo-vendor-1",
        description: "Filter drier",
        qtyOrdered: 2,
        qtyReceived: 0,
        qtyMissing: 2,
        qtyDamaged: 0,
        qtyBackordered: 0,
        status: "pending",
      },
    ],
    expectedLabel: "Pending Delivery",
    expectedComputed: "pending",
  },
  {
    id: "delivery-demo-vendor-2",
    order: "ORD-006",
    d: {
      id: "delivery-demo-vendor-2",
      orderNumber: "ORD-006",
      jobId: "job-2",
      vendorId: "vendor-1",
      purchaseOrderId: "po-6",
      deliveryDate: "2026-06-03",
      status: "shipped",
      createdAt: "",
      updatedAt: "",
    },
    items: [
      {
        id: "item-demo-v2-1",
        deliveryOrderId: "delivery-demo-vendor-2",
        description: "Filter drier",
        qtyOrdered: 1,
        qtyReceived: 0,
        qtyMissing: 1,
        qtyDamaged: 0,
        qtyBackordered: 0,
        status: "pending",
      },
    ],
    expectedLabel: "Pending Delivery",
    expectedComputed: "shipped",
  },
];

const failures = [];
for (const demo of demos) {
  const display = computeDeliveryDisplayState(demo.d, demo.items, []);
  const computed = display.readiness.deliveryStatus;
  const pass =
    display.statusDisplayLabel === demo.expectedLabel &&
    computed === demo.expectedComputed;
  if (!pass) {
    failures.push(
      `${demo.order}: label=${display.statusDisplayLabel} computed=${computed} persisted=${demo.d.status}`,
    );
  }
  console.log(
    JSON.stringify({
      id: demo.id,
      order: demo.order,
      persisted: demo.d.status,
      computed,
      label: display.statusDisplayLabel,
      issueSummary: display.issueSummary,
      actionRequired: display.actionRequired,
      expected: demo.expectedLabel,
      pass,
    }),
  );
}

if (failures.length) {
  console.error("FAIL demo matrix:", failures);
  process.exit(1);
}
console.log("PASS demo delivery matrix");
