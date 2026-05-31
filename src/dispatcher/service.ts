import type {
  DeliveryDetails,
  DeliveryListRow,
  DeliveryStatus,
  StagingLocation,
} from "./models";

export const VALID_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  pending: ["arrived", "issue"],
  arrived: ["partial", "complete", "issue"],
  partial: ["complete", "issue"],
  complete: ["picked_up"],
  issue: ["arrived", "partial", "complete"],
  picked_up: [],
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
  ): Promise<DeliveryDetails | null>;
  listStagingLocations(): Promise<StagingLocation[]>;
  updateStagingLocation(
    deliveryId: string,
    stagingLocationId: string | null,
  ): Promise<DeliveryDetails | null>;
}
