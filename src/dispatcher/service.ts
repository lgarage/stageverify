import type {
  DeliveryDetails,
  DeliveryListRow,
  DeliveryStatus,
  StagingLocation,
} from "./models";

export const VALID_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  pending: ["arrived", "issue"],
  arrived: ["partial", "complete", "issue"],
  partial: ["complete", "issue", "picked_up"],
  complete: ["picked_up"],
  issue: ["arrived", "partial", "complete"],
  picked_up: [],
};

/** Vendor revert: only undo a check-in submission (goes back to arrived) */
export const VENDOR_REVERT_TARGETS: Partial<Record<DeliveryStatus, DeliveryStatus>> = {
  partial: "arrived",
  complete: "arrived",
};

/** Dispatcher revert: superset — can also undo arrived→pending and picked_up→complete */
export const DISPATCHER_REVERT_TARGETS: Partial<Record<DeliveryStatus, DeliveryStatus>> = {
  arrived: "pending",
  partial: "arrived",
  complete: "arrived",
  picked_up: "complete",
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
    actorType?: "dispatcher" | "technician",
    actorName?: string,
  ): Promise<DeliveryDetails | null>;
  recordPickupEvent(
    deliveryId: string,
    technicianName: string,
    itemsPickedSummary: string,
    notes?: string,
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
