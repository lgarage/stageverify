import { collection, getDocs, writeBatch, doc } from "firebase/firestore";
import { db } from "../firebase";
import type {
  DeliveryOrder,
  Item,
  Job,
  PickupEvent,
  PurchaseOrder,
  StagingLocation,
  StatusHistoryEvent,
  Vendor,
} from "./models";

const jobs: Job[] = [
  {
    id: "job-1",
    jobNumber: "JOB-2026-0421",
    jobName: "Riverside Medical Center",
    siteNumber: "SITE-A3",
    status: "active",
    createdAt: "2026-05-20T08:00:00Z",
    updatedAt: "2026-05-29T15:00:00Z",
  },
  {
    id: "job-2",
    jobNumber: "JOB-2026-0389",
    jobName: "Oakwood Office Park",
    siteNumber: "SITE-B1",
    status: "active",
    createdAt: "2026-05-18T09:00:00Z",
    updatedAt: "2026-05-28T10:10:00Z",
  },
  {
    id: "job-3",
    jobNumber: "JOB-2026-0450",
    jobName: "Downtown Highrise",
    siteNumber: "SITE-D4",
    status: "active",
    createdAt: "2026-05-22T13:30:00Z",
    updatedAt: "2026-05-30T09:30:00Z",
  },
];

const vendors: Vendor[] = [
  {
    id: "vendor-1",
    name: "Johnstone Supply",
    contactName: "Dispatch Desk",
    contactPhone: "555-0101",
    email: "dispatch@johnstone.com",
    createdAt: "2026-05-01T08:00:00Z",
  },
  {
    id: "vendor-2",
    name: "First Supply",
    contactName: "Warehouse Counter",
    contactPhone: "555-0102",
    email: "counter@firstsupply.com",
    createdAt: "2026-05-01T08:00:00Z",
  },
  {
    id: "vendor-3",
    name: "Ferguson HVAC",
    contactName: "Commercial Team",
    contactPhone: "555-0103",
    email: "commercial@ferguson.com",
    createdAt: "2026-05-01T08:00:00Z",
  },
];

const stagingLocations: StagingLocation[] = [
  {
    id: "staging-1",
    code: "G1",
    label: "Ground Spot 1",
    type: "ground",
    status: "Active",
  },
  {
    id: "staging-2",
    code: "G2",
    label: "Ground Spot 2",
    type: "ground",
    status: "Active",
  },
  {
    id: "staging-3",
    code: "S1-A",
    label: "Shelf 1 - Bin A",
    type: "shelf",
    status: "Active",
  },
  {
    id: "staging-4",
    code: "S2-A",
    label: "Shelf 2 - Bin A",
    type: "shelf",
    status: "Active",
  },
];

const purchaseOrders: PurchaseOrder[] = [
  {
    id: "po-1",
    poNumber: "PO-88374",
    jobId: "job-1",
    vendorId: "vendor-1",
    orderDate: "2026-05-23",
    expectedDeliveryDate: "2026-05-30",
    status: "open",
  },
  {
    id: "po-2",
    poNumber: "PO-88375",
    jobId: "job-2",
    vendorId: "vendor-2",
    orderDate: "2026-05-22",
    expectedDeliveryDate: "2026-05-29",
    status: "partially_received",
  },
  {
    id: "po-3",
    poNumber: "PO-88377",
    jobId: "job-3",
    vendorId: "vendor-3",
    orderDate: "2026-05-24",
    expectedDeliveryDate: "2026-05-30",
    status: "open",
  },
];

const deliveryOrders: DeliveryOrder[] = [
  {
    id: "delivery-1",
    orderNumber: "ORD-001",
    jobId: "job-1",
    vendorId: "vendor-1",
    purchaseOrderId: "po-1",
    deliveryDate: "2026-05-30",
    stagingLocationId: "staging-2",
    status: "pending",
    issueSummary: "",
    notes: "Driver ETA after lunch.",
    createdAt: "2026-05-25T08:30:00Z",
    updatedAt: "2026-05-29T15:00:00Z",
  },
  {
    id: "delivery-2",
    orderNumber: "ORD-002",
    jobId: "job-2",
    vendorId: "vendor-2",
    purchaseOrderId: "po-2",
    deliveryDate: "2026-05-29",
    stagingLocationId: "staging-3",
    status: "partial",
    issueSummary: "1 item backordered",
    notes: "Thermostat expected next week.",
    createdAt: "2026-05-24T14:15:00Z",
    updatedAt: "2026-05-29T17:45:00Z",
  },
  {
    id: "delivery-3",
    orderNumber: "ORD-004",
    jobId: "job-3",
    vendorId: "vendor-3",
    purchaseOrderId: "po-3",
    deliveryDate: "2026-05-30",
    stagingLocationId: "staging-4",
    status: "arrived",
    issueSummary: "",
    notes: "Unload requires forklift support.",
    createdAt: "2026-05-25T07:00:00Z",
    updatedAt: "2026-05-30T09:30:00Z",
  },
];

const items: Item[] = [
  {
    id: "item-1",
    deliveryOrderId: "delivery-1",
    sku: "RTU-5T",
    description: "RTU 5-ton package unit",
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
    sku: "DCT-2412",
    description: "Ductwork section 24x12",
    qtyOrdered: 4,
    qtyReceived: 0,
    qtyMissing: 4,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "pending",
  },
  {
    id: "item-3",
    deliveryOrderId: "delivery-2",
    sku: "COIL-3T",
    description: "Condenser coil 3-ton",
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
    sku: "LINE-50",
    description: "Line set 50ft 3/8-7/8",
    qtyOrdered: 2,
    qtyReceived: 2,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "received",
  },
  {
    id: "item-5",
    deliveryOrderId: "delivery-2",
    sku: "TSTAT-T10",
    description: "Thermostat T10 Pro",
    qtyOrdered: 1,
    qtyReceived: 0,
    qtyMissing: 1,
    qtyDamaged: 0,
    qtyBackordered: 1,
    status: "backordered",
  },
  {
    id: "item-6",
    deliveryOrderId: "delivery-3",
    sku: "CHILL-50",
    description: "Chiller 50-ton modular",
    qtyOrdered: 1,
    qtyReceived: 1,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "received",
  },
  {
    id: "item-7",
    deliveryOrderId: "delivery-3",
    sku: "PUMP-5HP",
    description: "Pump circulator 5HP",
    qtyOrdered: 2,
    qtyReceived: 1,
    qtyMissing: 1,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "partial",
  },
];

const statusHistory: StatusHistoryEvent[] = [
  {
    id: "event-1",
    entityType: "delivery_order",
    entityId: "delivery-1",
    toStatus: "pending",
    actorType: "dispatcher",
    actorName: "Gavin",
    createdAt: "2026-05-25T08:30:00Z",
  },
  {
    id: "event-2",
    entityType: "delivery_order",
    entityId: "delivery-2",
    fromStatus: "arrived",
    toStatus: "partial",
    reason: "Backordered thermostat",
    actorType: "vendor",
    actorName: "First Supply Driver",
    createdAt: "2026-05-29T17:45:00Z",
  },
  {
    id: "event-3",
    entityType: "item",
    entityId: "item-5",
    fromStatus: "pending",
    toStatus: "backordered",
    reason: "Out of stock",
    actorType: "vendor",
    actorName: "First Supply Driver",
    createdAt: "2026-05-29T17:44:00Z",
  },
  {
    id: "event-4",
    entityType: "delivery_order",
    entityId: "delivery-3",
    fromStatus: "pending",
    toStatus: "arrived",
    actorType: "vendor",
    actorName: "Ferguson HVAC Driver",
    createdAt: "2026-05-30T09:30:00Z",
  },
];

const pickupEvents: PickupEvent[] = [
  {
    id: "pickup-1",
    deliveryOrderId: "delivery-2",
    jobId: "job-2",
    technicianName: "A. Miller",
    pickedUpAt: "2026-05-30T07:05:00Z",
    itemsPickedSummary: "2 line sets, 1 condenser coil",
    notes: "Thermostat still pending",
  },
];

export async function seedFirestore(): Promise<void> {
  const snap = await getDocs(collection(db, "deliveries"));
  if (!snap.empty) return;

  console.log("Seeding Firestore with demo data...");
  const batch = writeBatch(db);

  const seed = <T extends { id: string }>(colName: string, arr: T[]) => {
    for (const item of arr) {
      batch.set(doc(db, colName, item.id), item);
    }
  };

  seed("deliveries", deliveryOrders);
  seed("items", items);
  seed("jobs", jobs);
  seed("vendors", vendors);
  seed("stagingLocations", stagingLocations);
  seed("statusHistory", statusHistory);
  seed("pickupEvents", pickupEvents);
  seed("purchaseOrders", purchaseOrders);

  await batch.commit();
  console.log("Firestore seeded.");
}
