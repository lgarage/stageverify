import type {
  DeliveryDetails,
  DeliveryListRow,
  DeliveryStatus,
  Job,
  StagingLocation,
} from "./models";

export const VALID_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  pending: ["arrived", "issue"],
  shipped: ["arrived", "issue"],
  arrived: ["partial", "ready_for_pickup", "issue"],
  partial: ["ready_for_pickup", "issue", "picked_up"],
  ready_for_pickup: ["picked_up"],
  complete: ["picked_up"],
  issue: ["arrived", "partial", "ready_for_pickup"],
  picked_up: ["installed"],
  installed: [],
};

/** Vendor revert: only undo a check-in submission (goes back to arrived) */
export const VENDOR_REVERT_TARGETS: Partial<Record<DeliveryStatus, DeliveryStatus>> = {
  partial: "arrived",
  ready_for_pickup: "arrived",
  complete: "arrived",
};

/** Dispatcher revert: superset — can also undo arrived→pending and picked_up→ready_for_pickup */
export const DISPATCHER_REVERT_TARGETS: Partial<Record<DeliveryStatus, DeliveryStatus>> = {
  shipped: "pending",
  arrived: "pending",
  partial: "arrived",
  ready_for_pickup: "arrived",
  complete: "arrived",
  picked_up: "ready_for_pickup",
};

export type DeliverySortField =
  | "status"
  | "jobNumber"
  | "jobName"
  | "poNumber"
  | "orderNumber"
  | "vendorName"
  | "deliveryDate"
  | "stagingLocationCode"
  | "itemsReceivedLabel"
  | "issueSummary";

export type SortDirection = "asc" | "desc";

export interface DeliveryQuery {
  search?: string;
  statuses?: DeliveryStatus[];
  vendorIds?: string[];
  stagingLocationIds?: string[];
  jobId?: string;
  sortBy?: DeliverySortField;
  sortDirection?: SortDirection;
  page?: number;
  pageSize?: number;
}

export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface DispatcherDataService {
  listDeliveries(query?: DeliveryQuery): Promise<PagedResult<DeliveryListRow>>;
  getDeliveryDetails(deliveryId: string): Promise<DeliveryDetails | null>;
  updateDeliveryStatus(
    deliveryId: string,
    toStatus: DeliveryStatus,
    reason?: string,
    actorType?: "dispatcher" | "technician" | "vendor",
    actorName?: string,
  ): Promise<DeliveryDetails | null>;
  recordPickupEvent(
    deliveryId: string,
    technicianName: string,
    itemsPickedSummary: string,
    notes?: string,
    clientOperationId?: string,
    stagingLocationIds?: string[],
  ): Promise<void>;
  updateIssueSummary(
    deliveryId: string,
    summary: string,
  ): Promise<DeliveryDetails | null>;
  listStagingLocations(): Promise<StagingLocation[]>;
  updateStagingLocation(
    deliveryId: string,
    stagingLocationId: string | null,
  ): Promise<DeliveryDetails | null>;
  updatePurchaseOrder(
    deliveryId: string,
    poNumber: string,
  ): Promise<DeliveryDetails | null>;
  updateJobPickupScheduled(
    jobId: string,
    scheduled: boolean,
    scheduledBy?: string,
  ): Promise<Job | null>;
  updateShopStockPickList(
    deliveryId: string,
    items: string[],
    locationNote: string,
  ): Promise<DeliveryDetails | null>;
  submitCheckin(
    deliveryId: string,
    driverName: string,
    itemUpdates: Array<{
      id: string;
      qtyReceived: number;
      qtyMissing: number;
      qtyDamaged: number;
    }>,
  ): Promise<DeliveryDetails | null>;
  markVendorDelivered(
    deliveryId: string,
    actorName?: string,
  ): Promise<DeliveryDetails | null>;
  revertDeliveryStatus(
    deliveryId: string,
    actorType: "vendor" | "dispatcher",
    vendorRevertWindowMinutes?: number,
  ): Promise<DeliveryDetails | null>;
  updateItemQty(
    deliveryId: string,
    itemId: string,
    qtyOrdered: number,
    qtyReceived: number,
    qtyMissing: number,
  ): Promise<void>;
}
