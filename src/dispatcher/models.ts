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

/** V2 business readiness — distinct from physical receipt (`availabilityStatus`) and location notes. */
export type ReadinessStatus =
  | "ordering"
  | "not_ready"
  | "ready_for_pickup"
  | "picked_up";

export const READINESS_STATUS_LABEL: Record<ReadinessStatus, string> = {
  ordering: "Ordering",
  not_ready: "Not Ready",
  ready_for_pickup: "Ready For Pickup",
  picked_up: "Picked Up",
};

/**
 * Map V1 delivery workflow status to V2 readiness when `readinessStatus` is unset.
 * V1 documents without `readinessStatus` continue to use `DeliveryStatus` for routing/UI.
 */
export function readinessStatusFromDeliveryStatus(
  status: DeliveryStatus,
): ReadinessStatus {
  switch (status) {
    case "pending":
    case "shipped":
      return "ordering";
    case "arrived":
    case "partial":
    case "issue":
    case "complete":
      return "not_ready";
    case "ready_for_pickup":
      return "ready_for_pickup";
    case "picked_up":
    case "installed":
      return "picked_up";
  }
}

export function effectiveReadinessStatus(
  delivery: Pick<DeliveryOrder, "status" | "readinessStatus">,
): ReadinessStatus {
  return delivery.readinessStatus ?? readinessStatusFromDeliveryStatus(delivery.status);
}

/** Pickup-accountability source per material line — not inventory tracking. */
export type MaterialSource =
  | "vendor_delivery"
  | "shop_stock"
  | "direct_shipment"
  | "unknown";

/** Physical receipt / pickup confirmation — separate from location notes and workflow status. */
export type AvailabilityStatus = "expected" | "received" | "picked_up";

export type MaterialIssueType =
  | "missing"
  | "wrong_item"
  | "damaged"
  | "backordered"
  | "other";

export const MATERIAL_ISSUE_TYPE_LABEL: Record<MaterialIssueType, string> = {
  missing: "Missing",
  wrong_item: "Wrong Item",
  damaged: "Damaged",
  backordered: "Backordered",
  other: "Other",
};

/** Blocking types disable implicit “everything present”; `other` is informational only. */
export function isBlockingMaterialIssueType(type: MaterialIssueType): boolean {
  return type !== "other";
}

export type MaterialIssueStatus =
  | "open"
  | "assigned"
  | "resolved"
  | "closed";

export interface MaterialOwnerRef {
  id: string | null;
  name: string;
}

/** Delivery-level owner overrides job-level; neither set → Unassigned. */
export function effectiveMaterialOwner(
  job: Pick<Job, "materialOwnerId" | "materialOwnerName"> | undefined,
  delivery: Pick<DeliveryOrder, "materialOwnerId" | "materialOwnerName">,
): MaterialOwnerRef {
  if (delivery.materialOwnerId) {
    return {
      id: delivery.materialOwnerId,
      name: delivery.materialOwnerName ?? "Unassigned",
    };
  }
  if (job?.materialOwnerId) {
    return {
      id: job.materialOwnerId,
      name: job.materialOwnerName ?? "Unassigned",
    };
  }
  return { id: null, name: "Unassigned" };
}

export type IssueResolutionType =
  | "found_in_shop"
  | "pick_up_supply_house"
  | "vendor_redeliver"
  | "substitute"
  | "transfer"
  | "continue_without"
  | "hold_job"
  | "other";

export type VendorEmailReviewStatus =
  | "pending_review"
  | "approved"
  | "rejected"
  | "auto_processed";

/** Phase-gated Firestore root collections — create only when the active phase gate requires persistence. */
export const V2_COLLECTION_NAMES = {
  materialIssues: "materialIssues",
  vendorEmailEvents: "vendorEmailEvents",
  aiCorrections: "aiCorrections",
  vendorKnowledge: "vendorKnowledge",
} as const;

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

/** Deliveries in these statuses must not open on /receive (zone or id QR deep links). */
export const RECEIVE_BLOCKED_DELIVERY_STATUSES = new Set<DeliveryStatus>([
  "ready_for_pickup",
  "complete",
  "picked_up",
  "installed",
]);

/** Zone is vacant for ESL/QR once pickup is finished. */
export const ZONE_CLEARED_DELIVERY_STATUSES = new Set<DeliveryStatus>([
  "picked_up",
  "installed",
]);

export function shouldRouteScanToPickup(status: DeliveryStatus): boolean {
  return RECEIVE_BLOCKED_DELIVERY_STATUSES.has(status);
}

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
  /** V2: default material owner for deliveries on this job (Phase 3+ workflows). */
  materialOwnerId?: string;
  materialOwnerName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Vendor {
  id: string;
  name: string;
  contactName?: string;
  contactPhone?: string;
  email?: string;
  address?: string;
  supplies?: string;
  notes?: string;
  /** 4-digit PIN (MVP); readable only by authenticated dispatchers. Verified server-side. */
  pinCode?: string;
  /** scrypt hash `salt:hex` — preferred over pinCode when set. */
  pinHash?: string;
  /** When false, PIN verification fails. Defaults to active when unset. */
  active?: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface VerifyVendorPinInput {
  deliveryId: string;
  pin: string;
}

export interface VerifyVendorPinResult {
  success: boolean;
  message?: string;
  vendorId?: string;
  vendorName?: string;
  deliveryId?: string;
}

export interface PinVerificationEvent {
  id: string;
  deliveryOrderId: string;
  vendorId: string;
  vendorName: string;
  pinVerified: true;
  action: "PIN_VERIFIED";
  timestamp: string;
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

/** Structured expected material line (Phase 3+ pickup UI; optional on delivery in Phase 2). */
export interface ExpectedMaterial {
  id: string;
  description: string;
  qty: number;
  classification?: string;
  materialSource?: MaterialSource;
  availabilityStatus?: AvailabilityStatus;
  currentLocationNote?: string;
}

/** Structured shop-stock pull line (Phase 3+ UI; stub in Phase 2). */
export interface ShopStockLine {
  id: string;
  description: string;
  qty: number;
  shopStockLocationCode?: string;
  availabilityStatus?: AvailabilityStatus;
}

export interface DeliveryOrder {
  id: string;
  orderNumber: string;
  jobId: string;
  vendorId: string;
  /** Denormalized for public vendor flows when vendors collection is auth-only. */
  vendorName?: string;
  /** SHA-256 verifier for offline PIN check when verifyVendorPin CF is unreachable. */
  vendorPinVerifier?: string;
  purchaseOrderId?: string;
  deliveryDate: string;
  /** Assigned staging location — where material should be staged. */
  stagingLocationId?: string;
  additionalStagingLocationIds?: string[];
  status: DeliveryStatus;
  /** V2 business readiness; when unset, derive from `status` via `effectiveReadinessStatus`. */
  readinessStatus?: ReadinessStatus;
  materialOwnerId?: string;
  materialOwnerName?: string;
  /** Last known physical location — distinct from assigned staging zone. */
  currentLocationNote?: string;
  availabilityStatus?: AvailabilityStatus;
  /** Structured expected materials (Phase 3+); legacy workflows ignore when absent. */
  expectedMaterials?: ExpectedMaterial[];
  /** Structured shop-stock pulls (Phase 3+); legacy free-text list remains supported. */
  shopStockLines?: ShopStockLine[];
  issueSummary?: string;
  /** Free-text shop-stock lines for technician pickup (not inventory). */
  shopStockPickListItems?: string[];
  shopStockLocationNote?: string;
  notes?: string;
  submittedAt?: string;
  lastCheckmarkAt?: string;
  /** Denormalized — maintained by createMaterialIssue Cloud Function only. */
  openIssueCount?: number;
  /** Denormalized — open/assigned issues with blocking types (missing, wrong, damaged, backordered). */
  openBlockingIssueCount?: number;
  createdAt: string;
  updatedAt: string;
}

export type VendorDeliveryMode = "full_checkin" | "exception_only";

export interface AppSettings {
  vendorRevertWindowMinutes: number;
  autoSubmitMinutes: number;
  entrywayEslTagId?: string;
  /** Vendor receive UX: full line-item check-in vs exception-only Delivered hub. */
  vendorDeliveryMode?: VendorDeliveryMode;
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
  materialSource?: MaterialSource;
  currentLocationNote?: string;
  availabilityStatus?: AvailabilityStatus;
  shopStockLocationCode?: string;
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
    widthFt: typeof data.widthFt === "number" ? data.widthFt : undefined,
    depthFt: typeof data.depthFt === "number" ? data.depthFt : undefined,
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
  widthFt?: number;
  depthFt?: number;
}

export const isOversizedSpot = (loc: StagingLocation): boolean =>
  (loc.widthFt ?? 0) >= 8 || (loc.depthFt ?? 0) >= 8;

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
  /** Linked MaterialIssue ids (Phase 3+). */
  issueIds?: string[];
}

export interface MaterialIssue {
  id: string;
  deliveryOrderId: string;
  jobId: string;
  type: MaterialIssueType;
  status: MaterialIssueStatus;
  reportedBy: string;
  assignedOwnerId?: string;
  assignedOwnerName?: string;
  description?: string;
  /** True for missing, wrong_item, damaged, backordered. */
  blocking: boolean;
  clientRequestId: string;
  itemId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMaterialIssueInput {
  deliveryOrderId: string;
  jobId: string;
  type: MaterialIssueType;
  description?: string;
  reportedBy: string;
  clientRequestId: string;
  itemId?: string;
}

export interface CreateMaterialIssueResult {
  issueId: string;
  status: MaterialIssueStatus;
  assignedOwnerId?: string;
  assignedOwnerName: string;
  blocking: boolean;
  duplicate: boolean;
}

/** Forward-compatible stub — resolution workflows Phase 4+. */
export interface IssueResolution {
  id: string;
  materialIssueId: string;
  resolutionType: IssueResolutionType;
  assignee?: string;
  notes?: string;
  resolvedAt: string;
  resolvedBy?: string;
}

/** Forward-compatible stub — vendor email ingestion Phase 5–6. */
export interface VendorEmailEvent {
  id: string;
  vendorId: string;
  deliveryOrderId?: string;
  purchaseOrderId?: string;
  rawPayloadRef?: string;
  parsedFields?: Record<string, string>;
  confidenceScore?: number;
  humanReviewRequired?: boolean;
  reviewStatus: VendorEmailReviewStatus;
  receivedAt: string;
}

/** Forward-compatible stub — AI correction store Phase 8. */
export interface AICorrection {
  id: string;
  vendorId?: string;
  entityType: string;
  entityId?: string;
  originalValue: unknown;
  correctedValue: unknown;
  reason?: string;
  correctedBy: string;
  createdAt: string;
}

/** One vendor-scoped knowledge entry (collection: vendorKnowledge — Phase 8+). */
export interface VendorKnowledgeEntry {
  id: string;
  vendorId: string;
  term: string;
  normalizedTerm: string;
  ruleNotes?: string;
  version?: number;
  updatedAt: string;
}

export const getAllStagingLocationIds = (delivery: DeliveryOrder): string[] => {
  const ids: string[] = [];
  if (delivery.stagingLocationId) ids.push(delivery.stagingLocationId);
  if (delivery.additionalStagingLocationIds?.length) {
    ids.push(...delivery.additionalStagingLocationIds);
  }
  return ids;
};

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
  openIssueCount: number;
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
  materialIssues: MaterialIssue[];
}
