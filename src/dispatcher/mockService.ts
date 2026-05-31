import {
  deliveryOrders,
  items,
  jobs,
  pickupEvents,
  purchaseOrders,
  stagingLocations,
  statusHistory,
  vendors,
} from "./mockData";
import type {
  DeliveryDetails,
  DeliveryListRow,
  DeliveryOrder,
  Job,
  PurchaseOrder,
  StagingLocation,
  Vendor,
} from "./models";
import type {
  DeliveryQuery,
  DeliverySortField,
  DispatcherDataService,
  PagedResult,
  SortDirection,
} from "./service";
import { VALID_TRANSITIONS } from "./service";
import type { DeliveryStatus } from "./models";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 25;

interface DeliveryJoin {
  delivery: DeliveryOrder;
  job: Job;
  vendor: Vendor;
  purchaseOrder: PurchaseOrder | undefined;
  stagingLocation: StagingLocation | undefined;
}

const compareText = (
  a: string,
  b: string,
  direction: SortDirection,
): number => {
  const result = a.localeCompare(b, undefined, {
    sensitivity: "base",
    numeric: true,
  });
  return direction === "asc" ? result : result * -1;
};

const safe = (value?: string): string => value ?? "";

const itemsReceivedLabel = (deliveryId: string): string => {
  const lineItems = items.filter((item) => item.deliveryOrderId === deliveryId);
  const ordered = lineItems.reduce((sum, item) => sum + item.qtyOrdered, 0);
  const received = lineItems.reduce((sum, item) => sum + item.qtyReceived, 0);
  return `${received}/${ordered}`;
};

const toRow = (join: DeliveryJoin): DeliveryListRow => ({
  deliveryId: join.delivery.id,
  status: join.delivery.status,
  jobNumber: join.job.jobNumber,
  jobName: join.job.jobName,
  poNumber: join.purchaseOrder?.poNumber,
  orderNumber: join.delivery.orderNumber,
  vendorName: join.vendor.name,
  deliveryDate: join.delivery.deliveryDate,
  stagingLocationCode: join.stagingLocation?.code,
  itemsReceivedLabel: itemsReceivedLabel(join.delivery.id),
  issueSummary: join.delivery.issueSummary ?? "",
});

const sortRows = (
  rows: DeliveryListRow[],
  sortBy: DeliverySortField,
  sortDirection: SortDirection,
): DeliveryListRow[] => {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    switch (sortBy) {
      case "deliveryDate":
        return compareText(a.deliveryDate, b.deliveryDate, sortDirection);
      case "status":
        return compareText(a.status, b.status, sortDirection);
      case "jobNumber":
        return compareText(a.jobNumber, b.jobNumber, sortDirection);
      case "jobName":
        return compareText(a.jobName, b.jobName, sortDirection);
      case "poNumber":
        return compareText(safe(a.poNumber), safe(b.poNumber), sortDirection);
      case "orderNumber":
        return compareText(a.orderNumber, b.orderNumber, sortDirection);
      case "vendorName":
        return compareText(a.vendorName, b.vendorName, sortDirection);
      case "stagingLocationCode":
        return compareText(
          safe(a.stagingLocationCode),
          safe(b.stagingLocationCode),
          sortDirection,
        );
      case "itemsReceivedLabel":
        return compareText(
          a.itemsReceivedLabel,
          b.itemsReceivedLabel,
          sortDirection,
        );
      case "issueSummary":
        return compareText(a.issueSummary, b.issueSummary, sortDirection);
      default:
        return 0;
    }
  });

  return sorted;
};

const asPagedResult = <T>(
  allItems: T[],
  page: number,
  pageSize: number,
): PagedResult<T> => {
  const safePage = Math.max(DEFAULT_PAGE, page);
  const safePageSize = Math.max(1, pageSize);
  const totalItems = allItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const boundedPage = Math.min(safePage, totalPages);
  const start = (boundedPage - 1) * safePageSize;
  const end = start + safePageSize;

  return {
    items: allItems.slice(start, end),
    page: boundedPage,
    pageSize: safePageSize,
    totalItems,
    totalPages,
  };
};

const buildJoins = (): DeliveryJoin[] => {
  return deliveryOrders
    .map((delivery) => {
      const job = jobs.find((entry) => entry.id === delivery.jobId);
      const vendor = vendors.find((entry) => entry.id === delivery.vendorId);

      if (!job || !vendor) {
        return null;
      }

      const purchaseOrder = delivery.purchaseOrderId
        ? purchaseOrders.find((entry) => entry.id === delivery.purchaseOrderId)
        : undefined;
      const stagingLocation = delivery.stagingLocationId
        ? stagingLocations.find(
            (entry) => entry.id === delivery.stagingLocationId,
          )
        : undefined;

      return {
        delivery,
        job,
        vendor,
        purchaseOrder,
        stagingLocation,
      };
    })
    .filter((join): join is DeliveryJoin => join !== null);
};

const includesSearch = (row: DeliveryListRow, search: string): boolean => {
  const normalized = search.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return [
    row.jobNumber,
    row.jobName,
    row.poNumber,
    row.orderNumber,
    row.vendorName,
    row.stagingLocationCode,
  ].some((value) => safe(value).toLowerCase().includes(normalized));
};

export class MockDispatcherDataService implements DispatcherDataService {
  async listDeliveries(
    query: DeliveryQuery = {},
  ): Promise<PagedResult<DeliveryListRow>> {
    const sortBy = query.sortBy ?? "deliveryDate";
    const sortDirection = query.sortDirection ?? "desc";
    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const rows = buildJoins().map(toRow);

    const filtered = rows.filter((row) => {
      if (query.statuses?.length && !query.statuses.includes(row.status)) {
        return false;
      }

      if (
        query.vendorIds?.length &&
        !query.vendorIds.includes(
          deliveryOrders.find((entry) => entry.id === row.deliveryId)
            ?.vendorId ?? "",
        )
      ) {
        return false;
      }

      if (
        query.stagingLocationIds?.length &&
        !query.stagingLocationIds.includes(
          deliveryOrders.find((entry) => entry.id === row.deliveryId)
            ?.stagingLocationId ?? "",
        )
      ) {
        return false;
      }

      if (query.search && !includesSearch(row, query.search)) {
        return false;
      }

      return true;
    });

    const sorted = sortRows(filtered, sortBy, sortDirection);
    return asPagedResult(sorted, page, pageSize);
  }

  async getDeliveryDetails(
    deliveryId: string,
  ): Promise<DeliveryDetails | null> {
    const delivery = deliveryOrders.find((entry) => entry.id === deliveryId);
    if (!delivery) {
      return null;
    }

    const job = jobs.find((entry) => entry.id === delivery.jobId);
    const vendor = vendors.find((entry) => entry.id === delivery.vendorId);
    if (!job || !vendor) {
      return null;
    }

    return {
      delivery,
      job,
      vendor,
      purchaseOrder: delivery.purchaseOrderId
        ? purchaseOrders.find((entry) => entry.id === delivery.purchaseOrderId)
        : undefined,
      stagingLocation: delivery.stagingLocationId
        ? stagingLocations.find(
            (entry) => entry.id === delivery.stagingLocationId,
          )
        : undefined,
      items: items.filter((entry) => entry.deliveryOrderId === delivery.id),
      statusHistory: statusHistory.filter(
        (entry) =>
          (entry.entityType === "delivery_order" &&
            entry.entityId === delivery.id) ||
          (entry.entityType === "item" &&
            items
              .filter((item) => item.deliveryOrderId === delivery.id)
              .some((item) => item.id === entry.entityId)),
      ),
      pickupEvents: pickupEvents.filter(
        (entry) => entry.deliveryOrderId === delivery.id,
      ),
    };
  }

  async updateDeliveryStatus(
    deliveryId: string,
    toStatus: DeliveryStatus,
    reason?: string,
  ): Promise<DeliveryDetails | null> {
    const delivery = deliveryOrders.find((entry) => entry.id === deliveryId);
    if (!delivery) {
      return null;
    }

    const fromStatus = delivery.status;
    const isValidTransition = VALID_TRANSITIONS[fromStatus]?.includes(toStatus);

    if (!isValidTransition) {
      console.error(`Invalid status transition: ${fromStatus} -> ${toStatus}`);
      return this.getDeliveryDetails(deliveryId); // Return current state
    }

    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 500));

    delivery.status = toStatus;
    delivery.updatedAt = new Date().toISOString();

    if (toStatus === "issue" && reason) {
      delivery.issueSummary = reason;
    } else if (fromStatus === "issue") {
      delivery.issueSummary = "";
    }

    statusHistory.push({
      id: `event-${Date.now()}`,
      entityType: "delivery_order",
      entityId: deliveryId,
      fromStatus,
      toStatus,
      reason,
      actorType: "dispatcher",
      actorName: "Dispatcher",
      createdAt: new Date().toISOString(),
    });

    return this.getDeliveryDetails(deliveryId);
  }
}

export const mockDispatcherDataService: DispatcherDataService =
  new MockDispatcherDataService();
