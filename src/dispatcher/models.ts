export type DeliveryStatus =
  | "pending"
  | "arrived"
  | "partial"
  | "ready_for_pickup"
  | "complete"
  | "issue"
  | "picked_up";

export type ItemStatus =
  | "pending"
  | "partial"
  | "received"
  | "missing"
  | "damaged"
  | "backordered";

export type JobStatus = "active" | "on_hold" | "closed";

export type PurchaseOrderStatus =
  | "open"
  | "partially_received"
  | "received"
  | "cancelled";

export type EntityType = "delivery_order" | "item";

export type ActorType = "dispatcher" | "vendor" | "system" | "technician";

export interface Job {
  id: string;
  jobNumber: string;
  jobName: string;
  siteNumber?: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Vendor {
  id: string;
  name: string;
  contactName?: string;
  contactPhone?: string;
  email?: string;
  createdAt: string;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  jobId: string;
  vendorId: string;
  orderDate?: string;
  expectedDeliveryDate?: string;
  status: PurchaseOrderStatus;
}

export interface DeliveryOrder {
  id: string;
  orderNumber: string;
  jobId: string;
  vendorId: string;
  purchaseOrderId?: string;
  deliveryDate: string;
  stagingLocationId?: string;
  status: DeliveryStatus;
  issueSummary?: string;
  notes?: string;
  submittedAt?: string;
  lastCheckmarkAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  vendorRevertWindowMinutes: number;
  autoSubmitMinutes: number;
  entrywayEslTagId?: string;
}

export interface Item {
  id: string;
  deliveryOrderId: string;
  sku?: string;
  description: string;
  qtyOrdered: number;
  qtyReceived: number;
  qtyMissing: number;
  qtyDamaged: number;
  qtyBackordered: number;
  status: ItemStatus;
}

export interface StagingLocation {
  id: string;
  code: string;
  label: string;
  type: "ground" | "shelf" | "bin" | "other";
  active: boolean;
  notes?: string;
  sortOrder?: number;
  eslTagId?: string;
}

export interface StatusHistoryEvent {
  id: string;
  entityType: EntityType;
  entityId: string;
  fromStatus?: string;
  toStatus: string;
  reason?: string;
  actorType: ActorType;
  actorName?: string;
  createdAt: string;
}

export interface PickupEvent {
  id: string;
  deliveryOrderId: string;
  jobId: string;
  technicianName: string;
  pickedUpAt: string;
  itemsPickedSummary: string;
  notes?: string;
}

export interface DeliveryListRow {
  deliveryId: string;
  status: DeliveryStatus;
  jobNumber: string;
  jobName: string;
  poNumber?: string;
  orderNumber: string;
  vendorName: string;
  deliveryDate: string;
  stagingLocationCode?: string;
  itemsReceivedLabel: string;
  issueSummary: string;
}

export interface DeliveryDetails {
  delivery: DeliveryOrder;
  job: Job;
  vendor: Vendor;
  purchaseOrder?: PurchaseOrder;
  stagingLocation?: StagingLocation;
  items: Item[];
  statusHistory: StatusHistoryEvent[];
  pickupEvents: PickupEvent[];
}
