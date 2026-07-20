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
  | "running_low"
  | "other";

export const MATERIAL_ISSUE_TYPE_LABEL: Record<MaterialIssueType, string> = {
  missing: "Missing",
  wrong_item: "Wrong Item",
  damaged: "Damaged",
  backordered: "Backordered",
  running_low: "Running Low",
  other: "Other",
};

/** Blocking types disable implicit “everything present”; `other` and `running_low` are informational only. */
export function isBlockingMaterialIssueType(type: MaterialIssueType): boolean {
  return type !== "other" && type !== "running_low";
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
  | "other"
  | "need_more_information";

export const ISSUE_RESOLUTION_TYPE_LABEL: Record<IssueResolutionType, string> = {
  found_in_shop: "Found in Shop",
  pick_up_supply_house: "Pick Up at Supply House",
  vendor_redeliver: "Vendor Redeliver",
  substitute: "Substitute",
  transfer: "Transfer",
  continue_without: "Continue Without",
  hold_job: "Hold Job",
  other: "Other",
  need_more_information: "Need More Information",
};

export const ISSUE_RESOLUTION_TYPES: IssueResolutionType[] = [
  "found_in_shop",
  "pick_up_supply_house",
  "vendor_redeliver",
  "substitute",
  "transfer",
  "continue_without",
  "hold_job",
  "other",
  "need_more_information",
];

export type VendorEmailReviewStatus =
  | "pending_review"
  | "approved"
  | "rejected"
  | "auto_processed";

/** Inbound vendor inbox vs outbound dispatcher reply (Phase 6+). */
export type VendorEmailDirection = "inbound" | "outbound";

/** Why this vendor communication was sent or ingested. */
export type VendorCommunicationPurpose =
  | "vendor_order_update"
  | "need_more_information"
  | "issue_resolution"
  | "general"
  | "unknown";

/** Gmail (or future) email provider OAuth connection — metadata only; tokens Admin SDK only. */
export type EmailProviderId = "gmail";

export type EmailProviderConnectionStatus =
  | "disconnected"
  | "connected"
  | "token_expired";

export interface EmailProviderConnection {
  provider: EmailProviderId;
  status: EmailProviderConnectionStatus;
  connectedAccountEmail?: string;
  connectedAt?: string;
  connectedByUid?: string;
  updatedAt: string;
}

/** Result from manual inbound Gmail sync callable (Refresh Now). */
export interface InboundGmailSyncResult {
  ok: boolean;
  processed: number;
  skipped: number;
  errors: number;
  invoicesQueued?: number;
  skippedByStatus?: Record<string, number>;
  skippedReviewCounts?: Record<string, number>;
  errorDetails?: Array<{ gmailMessageId: string; message: string }>;
}

/** Result from in-modal Re-parse (cached PDF text → parser rerun). */
export interface ReparseVendorInvoiceImportResult {
  ok: boolean;
  import: VendorInvoiceImportReview;
  reparse: {
    importId: string;
    gmailMessageId: string;
    previousLineCount: number;
    newLineCount: number;
    importStatus: string;
  };
}

/** Connect/disconnect audit — no message bodies. */
export type EmailProviderAuditAction =
  | "connected"
  | "disconnected"
  | "token_expired";

export interface EmailProviderAuditEvent {
  id: string;
  provider: EmailProviderId;
  action: EmailProviderAuditAction;
  actorUid: string;
  connectedAccountEmail?: string;
  createdAt: string;
}

/** Phase-gated Firestore root collections — create only when the active phase gate requires persistence. */
export const V2_COLLECTION_NAMES = {
  materialIssues: "materialIssues",
  vendorEmailEvents: "vendorEmailEvents",
  aiCorrections: "aiCorrections",
  vendorKnowledge: "vendorKnowledge",
  emailProviderConnections: "emailProviderConnections",
  emailProviderAuditEvents: "emailProviderAuditEvents",
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
  /** ISO timestamp when dispatcher marked job Pickup Scheduled (Slice 3). */
  pickupScheduledAt?: string;
  /** Dispatcher email or name who marked Pickup Scheduled. */
  pickupScheduledBy?: string;
  /** Job-scoped vendor PIN (D14) — 4-digit; verified server-side only. */
  pinCode?: string;
  /** scrypt hash `salt:hex` — preferred over pinCode when set. */
  pinHash?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Vendor {
  id: string;
  name: string;
  contactName?: string;
  contactPhone?: string;
  email?: string;
  /** Sender domain for Phase 6 live email matching (e.g. johnstone.com). */
  emailDomain?: string;
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
  pin: string;
  /** Legacy `#/receive?id=` flow. */
  deliveryId?: string;
  /** Location-first `#/s?loc=` flow (Phase 3). */
  stagingLocationCode?: string;
  jobId?: string;
}

export interface VerifyVendorPinResult {
  success: boolean;
  message?: string;
  vendorId?: string;
  vendorName?: string;
  deliveryId?: string;
  jobId?: string;
  sessionScope?: "job" | "delivery";
  scannedStagingLocationCode?: string;
  /** Opaque server-issued session token. */
  sessionToken?: string;
  /** ISO expiry from server session doc. */
  expiresAt?: string;
}

export interface JobVendorDeliverySummary {
  deliveryId: string;
  orderNumber: string;
  poNumber?: string;
  vendorName: string;
  status: string;
  stagingLocationCodes: string[];
  scannedStagingLocationCode?: string;
}

export interface LocationPublicBranding {
  found: boolean;
  locationId?: string;
  code?: string;
  label?: string;
  type?: string;
}

/** Server-validated pickup token (Firestore pickupTokens/{tokenHash}). */
export interface PickupToken {
  id: string;
  jobId: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface GeneratePickupTokenInput {
  jobId: string;
}

export interface GeneratePickupTokenResult {
  token: string;
  expiresAt: string;
  jobId: string;
}

export interface RevokePickupTokenInput {
  jobId: string;
}

export interface RevokePickupTokenResult {
  success: boolean;
  revokedCount: number;
}

export interface PickupTokenStatusResult {
  hasActiveToken: boolean;
  expiresAt?: string;
  createdAt?: string;
  createdBy?: string;
}

/** Server-validated vendor PIN session (Firestore vendorSessions/{token}). */
export interface VendorSession {
  id: string;
  deliveryId: string;
  vendorId: string;
  vendorName: string;
  expiresAt: string;
  createdAt: string;
  sessionScope?: "job" | "delivery";
  jobId?: string;
  scannedStagingLocationId?: string;
  scannedStagingLocationCode?: string;
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

/** Structured shop-stock pull line (Phase 3+ pickup UI). */
export interface ShopStockLine {
  id: string;
  description: string;
  qty: number;
  shopStockLocationCode?: string;
  /** Link to permanent stock directory entry (shopStockLocationMappings). */
  shopStockMappingId?: string;
  availabilityStatus?: AvailabilityStatus;
}

/**
 * Permanent shop-stock location mapping (stock directory).
 * Locations stay reserved while active — pickup updates qty accountability, not inventory.
 */
export interface ShopStockLocationMapping {
  id: string;
  stockItemLabel: string;
  locationCode: string;
  /** Display label for combination areas (e.g. G15–G17). */
  combinationGroupLabel?: string;
  /** Member codes reserved together; includes locationCode when combination. */
  memberLocationCodes?: string[];
  qtyAvailable: number;
  qtyAssigned: number;
  qtyPickedUp: number;
  active: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryOrder {
  id: string;
  orderNumber: string;
  jobId: string;
  vendorId: string;
  /** Denormalized for public vendor flows when vendors collection is auth-only. */
  vendorName?: string;
  /** @deprecated Phase 2 — removed from delivery docs; PIN verify is CF-only. */
  vendorPinVerifier?: string;
  purchaseOrderId?: string;
  deliveryDate: string;
  /** Actual staging location — physical truth (location-first: not renamed; see location-first-transition-spec). */
  stagingLocationId?: string;
  additionalStagingLocationIds?: string[];
  /** Dispatcher instruction — where delivery should go (location-first Phase 1 types only). */
  plannedStagingLocationIds?: string[];
  /** Spot whose QR the vendor scanned at check-in (location-first Phase 1 types only). */
  scannedStagingLocationId?: string;
  scannedAt?: string;
  /** Audit entries for planned-spot release (location-first Phase 1 types only). */
  plannedLocationReleases?: PlannedLocationRelease[];
  /** Review-flag overlay — not a status enum value (location-first Phase 1 types only). */
  reviewFlag?: DeliveryReviewFlag;
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
  /** Linked inbound Johnstone invoice import (CF-maintained). */
  vendorInvoiceImportId?: string;
  /** Import-domain status label source — e.g. pickup_at_vendor → Will-Call / Pickup. */
  invoiceImportStatus?: string;
  /** Parsed fulfillment — will_call_pickup skips shop staging. */
  invoiceFulfillmentMethod?: "delivery" | "will_call_pickup" | "unknown";
  /** Job-site delivery from invoice order notes — no shop staging. */
  invoiceDeliverToSite?: boolean;
  invoiceDeliverToLabel?: string;
  /** Dispatcher confirms material reached the stated deliver-to site. */
  invoiceDeliverToSiteConfirmed?: boolean;
  invoiceDeliverToSiteConfirmedAt?: string;
  invoiceDeliverToSiteConfirmedBy?: string;
  createdFromInvoiceImport?: boolean;
  vendorInvoiceNumber?: string;
  vendorOrderNumber?: string;
  customerPoOrReference?: string;
  submittedAt?: string;
  lastCheckmarkAt?: string;
  /** Denormalized — maintained by createMaterialIssue Cloud Function only. */
  openIssueCount?: number;
  /** Denormalized — open/assigned issues with blocking types (missing, wrong, damaged, backordered). */
  openBlockingIssueCount?: number;
  /** Public-safe issue readback for pickup portal — CF-maintained only. */
  pickupMaterialIssues?: PickupMaterialIssueReadback[];
  /** Two-source gate: vendor email / dispatcher confirms order completeness. */
  vendorOrderComplete?: boolean;
  vendorOrderCompleteAt?: string;
  vendorOrderCompleteSource?: "vendor_email" | "physical_checkin" | "dispatcher" | "system";
  /** Match confidence (0–100) when source is vendor_email auto-apply. */
  vendorOrderCompleteConfidence?: number;
  /** Vendor DELIVERED — exception-only physical drop-off (no item qty on happy path). */
  vendorPhysicalDropoffConfirmed?: boolean;
  vendorPhysicalDropoffConfirmedAt?: string;
  /** When vendor pressed DELIVERED (exception-only hub). */
  deliveredAt?: string;
  physicalDropoffSource?: "vendor_email" | "physical_checkin" | "dispatcher" | "system";
  /** Two-source gate: physical check-in confirms drop-off quantities. */
  physicalDropoffComplete?: boolean;
  physicalDropoffCompleteAt?: string;
  /** Derived from stagingLocationId when physical material is received. */
  stagingAssignmentComplete?: boolean;
  /** Partial pickup — staging zones already collected. */
  pickedUpStagingLocationIds?: string[];
  /** Technician item checklist — persisted per delivery for reload continuity. */
  pickupCheckedItemIds?: string[];
  /**
   * Slice 6 — combination staging group (optional; shop-map IDs pending layout decision).
   * When set, all member locations stay reserved together until full pickup release (CF away-037).
   */
  combinationStagingGroupId?: string;
  combinationMemberLocationIds?: string[];
  /** Human-readable block reasons when not ready_for_pickup. */
  readinessBlockReasons?: string[];
  createdAt: string;
  updatedAt: string;
}

/** Planned-spot release audit entry (location-first D4). */
export interface PlannedLocationRelease {
  locationId: string;
  releasedAt: string;
  releasedBy: string;
  reason?: string;
}

/** Review-flag overlay on delivery — not a DeliveryStatus value (location-first D11). */
export interface DeliveryReviewFlag {
  flagged: boolean;
  reason?: string;
  flaggedBy?: string;
  flaggedAt?: string;
}

export type VendorDeliveryMode = "full_checkin" | "exception_only";

export interface AppSettings {
  vendorRevertWindowMinutes: number;
  autoSubmitMinutes: number;
  entrywayEslTagId?: string;
  /** Vendor receive UX: full line-item check-in vs exception-only Delivered hub. */
  vendorDeliveryMode?: VendorDeliveryMode;
  /** Minutes before vendor PIN session expires (server + client inactivity). Default 15. */
  vendorSessionMinutes?: number;
  /** Optional shop geofence center (vendor receive warn/enforce). */
  shopLatitude?: number;
  shopLongitude?: number;
  shopGeofenceRadiusMeters?: number;
  /** When true, vendor DELIVERED blocked outside geofence. PIN still allowed when false. */
  vendorGeofenceEnforce?: boolean;
  /** Configurable StageVerify monitoring inbox — no hard-coded production address. */
  monitoringInboxEmail?: string;
  /** When false or inbox unset, email monitor reports missing configuration. */
  emailMonitoringEnabled?: boolean;
  /** Minutes before technician PIN session expires (location-first Phase 1 types only). */
  technicianSessionMinutes?: number;
  /** Minutes before management PIN session expires (location-first Phase 1 types only). */
  managementSessionMinutes?: number;
  /** Hashed shared shop PIN for management audit tier (location-first Phase 1 types only). */
  managementPinHash?: string;
  /**
   * Staging Map layout additions beyond default constants (extra ground / shelf units / shelf letters)
   * plus optional hiddenSlots. Written by authenticated dispatcher map edit; public-readable via appSettings.
   */
  shopMapLayoutExtras?: {
    extraGround?: string[];
    extraShelfUnits?: string[];
    extraShelfSpots?: Record<string, string[]>;
    hiddenSlots?: string[];
    /** Print/vendor YOU ARE HERE marker offset from entrance anchor (px). */
    youAreHereOffset?: { ox: number; oy: number };
  };
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
    sizeClass: typeof data.sizeClass === "string" ? data.sizeClass : undefined,
    adjacentGroupId:
      typeof data.adjacentGroupId === "string" ? data.adjacentGroupId : undefined,
    mapOffsetX:
      typeof data.mapOffsetX === "number" ? data.mapOffsetX : undefined,
    mapOffsetY:
      typeof data.mapOffsetY === "number" ? data.mapOffsetY : undefined,
    mapWidth:
      typeof data.mapWidth === "number" ? data.mapWidth : undefined,
    mapHeight:
      typeof data.mapHeight === "number" ? data.mapHeight : undefined,
    mapRotationDeg:
      typeof data.mapRotationDeg === "number" &&
      Number.isFinite(data.mapRotationDeg)
        ? data.mapRotationDeg
        : undefined,
    mapLabelRotationDeg:
      typeof data.mapLabelRotationDeg === "number" &&
      Number.isFinite(data.mapLabelRotationDeg)
        ? data.mapLabelRotationDeg
        : undefined,
    mapLayoutSlot:
      typeof data.mapLayoutSlot === "string" ? data.mapLayoutSlot : undefined,
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
  /** Capacity hint for spot suggestions (location-first Phase 1 types only). */
  sizeClass?: string;
  /** Ground-spot adjacency group for Need More Space (location-first Phase 1 types only). */
  adjacentGroupId?: string;
  /** Optional pixel nudge from default map layout (dispatcher map edit). */
  mapOffsetX?: number;
  mapOffsetY?: number;
  /** Optional pixel size override for map chip (defaults to layout constants). */
  mapWidth?: number;
  mapHeight?: number;
  /** Optional CSS rotation in degrees for map chip / shelf frame. */
  mapRotationDeg?: number;
  /** Optional CSS rotation for shelf unit title + spot labels (independent of frame). */
  mapLabelRotationDeg?: number;
  /** Fixed map layout slot (e.g. G1) when zone code differs from layout position. */
  mapLayoutSlot?: string;
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
  clientOperationId?: string;
  stagingLocationIds?: string[];
}

/** Public-safe issue snapshot on delivery — maintained by material-issue CFs for pickup readback. */
export interface PickupMaterialIssueReadback {
  id: string;
  type: MaterialIssueType;
  status: MaterialIssueStatus;
  blocking: boolean;
  description?: string;
  resolutionType?: IssueResolutionType;
  resolutionNote?: string;
  resolvedAt?: string;
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
  /** Shop-stock line key when type is running_low (deliveryId:index). */
  shopStockLineKey?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionType?: IssueResolutionType;
  resolutionNote?: string;
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
  shopStockLineKey?: string;
}

export interface RecordPickupEventInput {
  deliveryOrderId: string;
  jobId: string;
  technicianName: string;
  itemsPickedSummary: string;
  notes?: string;
  clientOperationId: string;
  stagingLocationIds?: string[];
}

export interface RecordPickupEventResult {
  duplicate: boolean;
  pickupEventId: string | null;
  deliveryStatus: string | null;
  pickedUpStagingLocationIds: string[];
  fullyPicked?: boolean;
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

/** Outbound vendor email — Resolve Issue or Vendor Communications hub. */
export interface SendVendorEmailInput {
  deliveryOrderId?: string;
  vendorId?: string;
  materialIssueId?: string;
  to: string;
  /** Additional recipients (Cc). Max 5; must not duplicate `to`. */
  cc?: string[];
  subject: string;
  body: string;
  /** When true, CF updates vendor.email to `to` before send (required if `to` differs from on-file email). */
  saveVendorEmail?: boolean;
  /** Gmail thread id when replying to an inbound vendor message. */
  replyThreadId?: string;
  inReplyTo?: string;
  references?: string[];
}

export interface SendVendorEmailResult {
  eventId: string;
  sourceMessageId: string;
  threadId: string | null;
  trackingToken: string;
  rfc822MessageId: string | null;
  replyToAddress: string;
  sentAt: string;
}

/** Vendor email ingestion — persisted when Phase 5+ gate active. */
export interface VendorEmailEvent {
  id: string;
  /** Stable Gmail (or provider) message id for idempotent ingestion. */
  sourceMessageId: string;
  threadId?: string;
  /** RFC 822 Message-ID header (outbound capture or inbound parse). */
  rfc822MessageId?: string;
  trackingToken?: string;
  matchedBy?: string;
  replyToAddress?: string;
  inReplyTo?: string;
  references?: string[];
  vendorInvoiceImportId?: string;
  applyConflictReason?: string;
  snippet?: string;
  bodyText?: string;
  senderAuthPass?: boolean;
  contentFingerprint?: string;
  /** Defaults to inbound for legacy Phase 5 documents. */
  direction?: VendorEmailDirection;
  communicationPurpose?: VendorCommunicationPurpose;
  /** Linked material issue when outbound from resolve flow (Phase 6+). */
  materialIssueId?: string;
  senderEmail: string;
  recipientEmails?: string[];
  subject: string;
  receivedAt: string;
  vendorId?: string;
  jobId?: string;
  deliveryOrderId?: string;
  purchaseOrderId?: string;
  proposedPoNumber?: string;
  proposedOrderNumber?: string;
  proposedJobNumber?: string;
  emailClassification?: string;
  parsedFields?: Record<string, string>;
  confidenceScore?: number;
  confidenceReason?: string;
  humanReviewRequired?: boolean;
  reviewStatus: VendorEmailReviewStatus;
  rejectedAt?: string;
  rejectedBy?: string;
  rawPayloadRef?: string;
  duplicateOfEventId?: string;
  appliedAt?: string;
  /** Outbound audit fields — populated when direction is outbound (Phase 6+). */
  sentBy?: string;
  sentAt?: string;
  bodyExcerpt?: string;
  provider?: string;
  createdAt: string;
  updatedAt: string;
}

/** Inbound Gmail invoice PDF ingestion — CF Admin SDK writes; dispatcher auth read. */
export type InboundEmailProcessingStatus =
  | "pending"
  | "processing"
  | "extracted"
  | "parsed"
  | "no_pdf"
  | "reply_processed"
  | "error";

export interface InboundEmailProcessing {
  id: string;
  gmailMessageId: string;
  threadId?: string;
  senderEmail: string;
  subject: string;
  receivedAt: string;
  attachmentFilenames: string[];
  pdfAttachments?: Array<{
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }>;
  combinedExtractedTextPreview?: string;
  combinedExtractedTextTruncated?: boolean;
  processingStatus: InboundEmailProcessingStatus;
  reviewStatus: "pending_review";
  parseResult?: {
    importBatchId: string;
    processed: number;
    needsReview: number;
    failed: number;
    total: number;
    reviewRecordIds: string[];
  };
  vendorEmailEventId?: string;
  messageIdHeader?: string;
  inReplyTo?: string;
  references?: string[];
  createdAt: string;
  updatedAt: string;
}

/** Persisted invoice line — spec Table B (review queue). */
export interface VendorInvoiceImportParsedLine {
  lineNumber: number;
  quantityOrdered: number;
  quantityShipped: number;
  quantityBackordered: number;
  vendorProductNumber: string;
  manufacturerOrModelNumber?: string;
  description: string;
  unitOfMeasure?: string;
  lineExtension?: string;
  filteredNotes: string[];
  lineType: string;
  excludeFromExpectedItems: boolean;
}

/** Johnstone invoice import review queue — no auto-apply to deliveries. */
export interface VendorInvoiceImportReview {
  id: string;
  inboundEmailProcessingId: string;
  gmailMessageId: string;
  importBatchId: string;
  pageId: string;
  reviewStatus: "pending_review" | "approved" | "rejected";
  importStatus: string;
  confidenceScore: number;
  humanReviewRequired: boolean;
  duplicate?: boolean;
  duplicateOfPageId?: string;
  parsedHeader?: Record<string, unknown>;
  parsedLines?: VendorInvoiceImportParsedLine[];
  parsedLineCount?: number;
  parseWarnings?: string[];
  orderNotes?: string[];
  /** Human-readable block reason when importStatus is issue. */
  error?: string;
  linkedDeliveryOrderId?: string;
  approvedAt?: string;
  rejectedAt?: string;
  /** Stage 1 — suggested import eligibility (no automatic CF approve). */
  autoImportEligible?: boolean;
  autoImportConfidence?: number;
  autoImportReasons?: string[];
  reviewRequiredReasons?: string[];
  importDecisionMode?: "suggested_import" | "review_required" | "blocked";
  suggestedAction?: string;
  importDecisionLog?: Array<{
    action: "approve" | "reject" | "link" | "create_shell" | "reopen";
    at: string;
    by: string;
    importDecisionMode: string;
    autoImportEligible: boolean;
    autoImportReasons: string[];
    reviewRequiredReasons: string[];
    deliveryOrderId?: string;
  }>;
  parserFormatId?: "johnstone" | "first_supply" | "generic" | "unknown";
  parserRouteConfidence?: number;
  detectedVendorId?: string;
  detectedVendorName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceDeliveryMatchCandidate {
  deliveryId: string;
  orderNumber: string;
  jobId: string;
  vendorId: string;
  purchaseOrderId?: string;
  confidenceScore: number;
  matchReasons: string[];
}

export interface InvoiceMatchResult {
  vendorInvoiceImportId: string;
  purchaseOrderId?: string;
  jobId?: string;
  vendorId?: string;
  deliveryOrderId?: string;
  candidates: InvoiceDeliveryMatchCandidate[];
  confidenceScore: number;
  confidenceReason: string;
  humanReviewRequired: boolean;
  importStatus?: string;
  reviewStatus?: string;
}

export interface ApproveVendorInvoiceImportResult {
  vendorInvoiceImportId: string;
  reviewStatus: "approved" | "rejected" | "pending_review";
  deliveryOrderId?: string;
  itemsApplied?: number;
  /** True when a new dashboard shell delivery was created (review-only approve / create_shell). */
  shellCreated?: boolean;
  /** True when a job was auto-created from invoice P/O hints. */
  jobCreated?: boolean;
  /** Set when shell was expected but could not be created (legacy clients). */
  shellError?: string;
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
  /** Readiness-aware label aligned with drawer / job readiness panel. */
  statusDisplayLabel: string;
  jobNumber: string;
  jobName: string;
  poNumber?: string;
  orderNumber: string;
  vendorName: string;
  deliveryDate: string;
  stagingLocationCode?: string;
  /** Phase 4 — planned ≠ actual staging assignment. */
  plannedActualDivergence?: boolean;
  itemsReceivedLabel: string;
  issueSummary: string;
  openIssueCount: number;
  /** Dispatcher table: dark-orange action row when staging zone is unassigned. */
  missingStagingAssignment: boolean;
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
