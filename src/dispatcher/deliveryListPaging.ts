export const DELIVERY_LIST_PAGE_SIZE_OPTIONS = [25, 50, 100, "all"] as const;

export type DeliveryListPageSize = (typeof DELIVERY_LIST_PAGE_SIZE_OPTIONS)[number];

export const DEFAULT_DELIVERY_LIST_PAGE_SIZE: DeliveryListPageSize = 25;

const DEFAULT_PAGE = 1;

export interface PagedSliceResult<T> {
  items: T[];
  page: number;
  pageSize: number | "all";
  totalItems: number;
  totalPages: number;
}

export function asPagedResult<T>(
  allItems: T[],
  page: number,
  pageSize: number | "all",
): PagedSliceResult<T> {
  if (pageSize === "all") {
    return {
      items: allItems,
      page: 1,
      pageSize: "all",
      totalItems: allItems.length,
      totalPages: 1,
    };
  }

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
}
