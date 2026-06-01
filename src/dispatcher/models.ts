export type DeliveryStatus =
  | "pending"
  | "shipped"
  | "arrived"
  | "partial"
  | "ready_for_pickup"
  | "complete"
  | "issue"
  | "picked_up"
  | "installed";

export type ItemStatus =
  | "pending"
  | "partial"
  | "received"
  | "missing"
  | "damaged"
  | "backordered"
  | "installed";

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  pending: "Ordered",
  shipped: "Shipped",
  arrived: "Received",
  partial: "Partial",
  ready_for_pickup: "Staged",
  complete: "Complete",
  issue: "Issue",
  picked_up: "Picked Up",
  installed: "Installed",
};

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
  locationId?: string;
}

export type LocationStatus = "Planned" | "Installed" | "Tagged" | "Active";

export const LOCATION_STATUSES: LocationStatus[] = [
  "Planned",
  "Installed",
  "Tagged",
  "Active",
];

export const isLocationActive = (loc: StagingLocation): boolean =>
  loc.status === "Active";

type StagingLocationRaw = Record<string, unknown> & {
  id?: string;
  active?: boolean;
  status?: LocationStatus;
};

export function parseStagingLocation(
  docId: string,
  data: StagingLocationRaw,
): StagingLocation {
  const status: LocationStatus =
    data.status !== undefined
      ? data.status
      : data.active === true
        ? "Active"
        : "Planned";
  return {
    id: typeof data.id === "string" ? data.id : docId,
    code: String(data.code),
    label: String(data.label),
    type: data.type as StagingLocation["type"],
    status,
    notes: typeof data.notes === "string" ? data.notes : undefined,
    sortOrder: typeof data.sortOrder === "number" ? data.sortOrder : undefined,
    eslTagId: typeof data.eslTagId === "string" ? data.eslTagId : undefined,
  };
}

export interface StagingLocation {
  id: string;
  code: string;
  label: string;
  type: "ground" | "shelf" | "bin" | "other";
  status: LocationStatus;
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
  job?: Job;
  vendor: Vendor;
  purchaseOrder?: PurchaseOrder;
  stagingLocation?: StagingLocation;
  items: Item[];
  statusHistory: StatusHistoryEvent[];
  pickupEvents: PickupEvent[];
}
