import type {
  DeliveryDetails,
  DeliveryListRow,
  DeliveryStatus,
} from "./models";

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
}
