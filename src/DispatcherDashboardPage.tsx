import { useCallback, useEffect, useMemo, useState } from "react";
import {
  mockDispatcherDataService,
  type DeliveryDetails,
  type DeliveryListRow,
  type DeliverySortField,
  type DeliveryStatus,
  type PagedResult,
  type SortDirection,
} from "./dispatcher";

const STATUS_ORDER: DeliveryStatus[] = [
  "pending",
  "arrived",
  "partial",
  "complete",
  "issue",
  "picked_up",
];

const STATUS_STYLE: Record<DeliveryStatus, string> = {
  pending: "bg-white border border-gray-300 text-gray-700 shadow-sm",
  arrived: "bg-blue-50 border border-blue-200 text-blue-700 shadow-sm",
  partial: "bg-purple-50 border border-purple-200 text-purple-700 shadow-sm",
  complete: "bg-green-50 border border-green-200 text-green-700 shadow-sm",
  issue: "bg-red-50 border border-red-200 text-red-700 shadow-sm",
  picked_up: "bg-gray-100 border border-gray-200 text-gray-600 shadow-sm",
};

type ListQueryState = {
  search: string;
  statuses: DeliveryStatus[];
  sortBy: DeliverySortField;
  sortDirection: SortDirection;
  page: number;
  pageSize: number;
};

const STATUS_LABEL = (status: DeliveryStatus): string =>
  status.replace("_", " ").toUpperCase();

const SORT_COLUMNS: Array<{
  label: string;
  key?: DeliverySortField;
  className?: string;
}> = [
  { label: "Status", key: "status" },
  { label: "Job #", key: "jobNumber" },
  { label: "Job Name", key: "jobName" },
  { label: "PO #", key: "poNumber" },
  { label: "Order #", key: "orderNumber" },
  { label: "Vendor", key: "vendorName" },
  { label: "Delivery Date", key: "deliveryDate" },
  { label: "Staging Location", key: "stagingLocationCode" },
  { label: "Items Received", key: "itemsReceivedLabel" },
  { label: "Issue Summary", key: "issueSummary" },
  { label: "Action", className: "text-right" },
];

const INITIAL_PAGED: PagedResult<DeliveryListRow> = {
  items: [],
  page: 1,
  pageSize: 20,
  totalItems: 0,
  totalPages: 1,
};

export function DispatcherDashboardPage() {
  const [query, setQuery] = useState<ListQueryState>({
    search: "",
    statuses: [],
    sortBy: "deliveryDate",
    sortDirection: "desc",
    page: 1,
    pageSize: 20,
  });
  const [paged, setPaged] =
    useState<PagedResult<DeliveryListRow>>(INITIAL_PAGED);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(
    null,
  );
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [selectedDetails, setSelectedDetails] =
    useState<DeliveryDetails | null>(null);

  const hasActiveFilters = query.statuses.length > 0 || !!query.search.trim();

  const fetchList = useCallback(async () => {
    try {
      const result = await mockDispatcherDataService.listDeliveries({
        search: query.search,
        statuses: query.statuses.length ? query.statuses : undefined,
        sortBy: query.sortBy,
        sortDirection: query.sortDirection,
        page: query.page,
        pageSize: query.pageSize,
      });

      setPaged(result);
      setLastUpdated(new Date().toLocaleString());
      setListError(null);
    } catch {
      setListError("Could not load deliveries. Please try again.");
    } finally {
      setListLoading(false);
    }
  }, [query]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      await Promise.resolve();
      if (!mounted) return;
      setListLoading(true);
      await fetchList();
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [fetchList]);

  const selectDelivery = async (deliveryId: string) => {
    setSelectedDeliveryId(deliveryId);
    setDetailLoading(true);
    setDetailError(null);

    try {
      const detail =
        await mockDispatcherDataService.getDeliveryDetails(deliveryId);
      if (!detail) {
        setDetailError("Delivery details not found.");
        setSelectedDetails(null);
        return;
      }
      setSelectedDetails(detail);
    } catch {
      setDetailError("Unable to load delivery details.");
      setSelectedDetails(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const toggleStatus = (status: DeliveryStatus) => {
    setQuery((prev) => ({
      ...prev,
      page: 1,
      statuses: prev.statuses.includes(status)
        ? prev.statuses.filter((s) => s !== status)
        : [...prev.statuses, status],
    }));
  };

  const toggleSort = (field: DeliverySortField) => {
    setQuery((prev) => {
      if (prev.sortBy === field) {
        return {
          ...prev,
          sortDirection: prev.sortDirection === "asc" ? "desc" : "asc",
        };
      }

      return {
        ...prev,
        sortBy: field,
        sortDirection: "asc",
      };
    });
  };

  const pageNumbers = useMemo(() => {
    return Array.from(
      { length: paged.totalPages },
      (_, index) => index + 1,
    ).slice(Math.max(0, paged.page - 3), Math.max(5, paged.page + 2));
  }, [paged.page, paged.totalPages]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
      <div className="max-w-[1700px] mx-auto px-4 md:px-8 py-8">
        <header className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-[#0f294d]">
              StageVerify Dashboard
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Delivery staging and verification overview
            </p>
          </div>
          <div className="text-sm text-gray-500 bg-white px-4 py-2 rounded-md border border-gray-200 shadow-sm">
            Last updated:{" "}
            <span className="font-medium text-gray-700">
              {lastUpdated ?? "Loading..."}
            </span>
          </div>
        </header>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6 p-4 md:p-5">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Search
              </label>
              <input
                value={query.search}
                onChange={(e) =>
                  setQuery((prev) => ({
                    ...prev,
                    page: 1,
                    search: e.target.value,
                  }))
                }
                placeholder="Job #, Job Name, PO #, Order #, Vendor, Staging Location..."
                className="w-full rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Filter by Status
              </label>
              <div className="flex flex-wrap gap-2 items-center">
                {STATUS_ORDER.map((status) => {
                  const active = query.statuses.includes(status);
                  return (
                    <button
                      key={status}
                      onClick={() => toggleStatus(status)}
                      className={`px-3 py-2 rounded-md text-xs font-semibold tracking-wide transition-colors ${
                        active
                          ? STATUS_STYLE[status]
                          : "bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100"
                      }`}
                    >
                      {STATUS_LABEL(status)}
                    </button>
                  );
                })}

                {hasActiveFilters && (
                  <button
                    onClick={() =>
                      setQuery((prev) => ({
                        ...prev,
                        search: "",
                        statuses: [],
                        page: 1,
                      }))
                    }
                    className="ml-2 text-xs px-3 py-2 rounded-md border border-gray-200 text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_450px] gap-6">
          <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden min-w-0 flex flex-col">
            <div className="overflow-auto max-h-[70vh]">
              <table className="w-full min-w-[1200px] text-sm text-left border-collapse">
                <thead className="sticky top-0 z-20 bg-[#0f294d] text-white shadow-sm">
                  <tr>
                    {SORT_COLUMNS.map((column) => {
                      const isSorted =
                        column.key && query.sortBy === column.key;
                      return (
                        <th
                          key={column.label}
                          className={`px-4 py-3.5 font-semibold whitespace-nowrap ${column.className ?? ""}`}
                        >
                          {column.key ? (
                            <button
                              className="inline-flex items-center gap-1.5 hover:text-blue-200 transition-colors focus:outline-none"
                              onClick={() =>
                                toggleSort(column.key as DeliverySortField)
                              }
                            >
                              {column.label}
                              <span className="text-[10px] opacity-70">
                                {isSorted
                                  ? query.sortDirection === "asc"
                                    ? "▲"
                                    : "▼"
                                  : "↕"}
                              </span>
                            </button>
                          ) : (
                            column.label
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>

                <tbody className="divide-y divide-gray-100">
                  {paged.items.map((row) => {
                    const selected = selectedDeliveryId === row.deliveryId;

                    return (
                      <tr
                        key={row.deliveryId}
                        tabIndex={0}
                        role="button"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            void selectDelivery(row.deliveryId);
                          }
                        }}
                        onClick={() => void selectDelivery(row.deliveryId)}
                        className={`cursor-pointer transition-colors focus-visible:outline-none focus-visible:bg-blue-50 ${
                          selected ? "bg-blue-50" : "hover:bg-gray-50"
                        }`}
                      >
                        <td className="px-4 py-3.5">
                          <span
                            className={`inline-flex px-2.5 py-1 rounded-md text-[11px] font-bold tracking-wider ${STATUS_STYLE[row.status]}`}
                          >
                            {STATUS_LABEL(row.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 font-mono text-gray-600">
                          {row.jobNumber}
                        </td>
                        <td className="px-4 py-3.5 font-medium text-gray-900">
                          {row.jobName}
                        </td>
                        <td className="px-4 py-3.5 font-mono text-gray-600">
                          {row.poNumber ?? "—"}
                        </td>
                        <td className="px-4 py-3.5 font-mono text-gray-600">
                          {row.orderNumber}
                        </td>
                        <td className="px-4 py-3.5 text-gray-700">
                          {row.vendorName}
                        </td>
                        <td className="px-4 py-3.5 text-gray-700">
                          {row.deliveryDate}
                        </td>
                        <td className="px-4 py-3.5 font-mono text-gray-600">
                          {row.stagingLocationCode ?? "—"}
                        </td>
                        <td className="px-4 py-3.5 font-mono text-gray-600">
                          {row.itemsReceivedLabel}
                        </td>
                        <td className="px-4 py-3.5 text-gray-700">
                          {row.issueSummary || "—"}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <button className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-xs font-medium transition-colors">
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}

                  {!listLoading && !listError && paged.items.length === 0 && (
                    <tr>
                      <td colSpan={11} className="p-12 text-center">
                        <p className="text-gray-900 font-medium text-lg">
                          No matching deliveries
                        </p>
                        <p className="text-sm text-gray-500 mt-1">
                          Try adjusting search text or status filters.
                        </p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="border-t border-gray-200 bg-gray-50 p-4 flex flex-wrap items-center gap-4 text-sm text-gray-600 mt-auto">
              <span>
                Showing{" "}
                <span className="font-medium text-gray-900">
                  {paged.items.length}
                </span>{" "}
                of{" "}
                <span className="font-medium text-gray-900">
                  {paged.totalItems}
                </span>
              </span>

              <div className="ml-auto flex items-center gap-1.5">
                <button
                  onClick={() =>
                    setQuery((prev) => ({
                      ...prev,
                      page: Math.max(1, prev.page - 1),
                    }))
                  }
                  disabled={paged.page <= 1 || listLoading}
                  className="px-3 py-1.5 rounded-md border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:hover:bg-white transition-colors font-medium"
                >
                  Prev
                </button>

                {pageNumbers.map((pageNumber) => (
                  <button
                    key={pageNumber}
                    onClick={() =>
                      setQuery((prev) => ({ ...prev, page: pageNumber }))
                    }
                    className={`px-3 py-1.5 rounded-md border font-medium transition-colors ${
                      pageNumber === paged.page
                        ? "border-blue-600 bg-blue-50 text-blue-700"
                        : "border-gray-300 bg-white hover:bg-gray-50 text-gray-700"
                    }`}
                  >
                    {pageNumber}
                  </button>
                ))}

                <button
                  onClick={() =>
                    setQuery((prev) => ({
                      ...prev,
                      page: Math.min(paged.totalPages, prev.page + 1),
                    }))
                  }
                  disabled={paged.page >= paged.totalPages || listLoading}
                  className="px-3 py-1.5 rounded-md border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:hover:bg-white transition-colors font-medium"
                >
                  Next
                </button>
              </div>
            </div>

            {(listLoading || listError) && (
              <div className="border-t border-gray-200 bg-white px-4 py-3 text-sm">
                {listLoading && (
                  <p className="text-gray-500">Loading deliveries…</p>
                )}
                {listError && <p className="text-red-600">{listError}</p>}
              </div>
            )}
          </section>

          <aside className="hidden xl:block rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <DesktopDetailDrawer
              loading={detailLoading}
              error={detailError}
              details={selectedDetails}
              selectedDeliveryId={selectedDeliveryId}
            />
          </aside>
        </div>
      </div>

      {selectedDeliveryId && (
        <div
          className="xl:hidden fixed inset-0 z-50 bg-gray-900/60 backdrop-blur-sm"
          onClick={() => setSelectedDeliveryId(null)}
        >
          <div
            className="absolute right-0 top-0 h-full w-full max-w-[92vw] sm:max-w-md bg-white border-l border-gray-200 shadow-2xl overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-gray-200 sticky top-0 bg-white z-10">
              <h2 className="text-lg font-bold text-gray-900">
                Delivery Details
              </h2>
              <button
                className="text-sm font-medium text-gray-500 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-md px-3 py-1.5 transition-colors"
                onClick={() => setSelectedDeliveryId(null)}
              >
                Close
              </button>
            </div>

            <div className="p-5">
              <DetailContent
                loading={detailLoading}
                error={detailError}
                details={selectedDetails}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DesktopDetailDrawer({
  loading,
  error,
  details,
  selectedDeliveryId,
}: {
  loading: boolean;
  error: string | null;
  details: DeliveryDetails | null;
  selectedDeliveryId: string | null;
}) {
  return (
    <div className="h-full max-h-[70vh] overflow-y-auto sticky top-[148px] flex flex-col">
      <div className="p-5 border-b border-gray-200 bg-gray-50">
        <h2 className="text-lg font-bold text-gray-900">Delivery Details</h2>
        <p className="text-sm text-gray-500 mt-1">
          {selectedDeliveryId
            ? `Selected: ${selectedDeliveryId}`
            : "Select a row to view details"}
        </p>
      </div>

      <div className="p-5 flex-1">
        <DetailContent loading={loading} error={error} details={details} />
      </div>
    </div>
  );
}

function DetailContent({
  loading,
  error,
  details,
}: {
  loading: boolean;
  error: string | null;
  details: DeliveryDetails | null;
}) {
  if (loading) {
    return <p className="text-sm text-gray-500">Loading detail panel…</p>;
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  if (!details) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center">
        <svg
          className="w-12 h-12 text-gray-300 mb-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
          />
        </svg>
        <p className="text-sm text-gray-500">
          No delivery selected.
          <br />
          Click a row in the table to view details.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-sm">
      <section>
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
          Delivery & Vendor
        </h3>
        <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 space-y-2 text-gray-600">
          <p className="flex justify-between">
            <span className="font-medium text-gray-900">Order:</span>
            <span className="font-mono">{details.delivery.orderNumber}</span>
          </p>
          <p className="flex justify-between">
            <span className="font-medium text-gray-900">Vendor:</span>
            <span>{details.vendor.name}</span>
          </p>
          <p className="flex justify-between">
            <span className="font-medium text-gray-900">PO:</span>
            <span className="font-mono">
              {details.purchaseOrder?.poNumber ?? "—"}
            </span>
          </p>
          <p className="flex justify-between">
            <span className="font-medium text-gray-900">Staging:</span>
            <span className="font-mono">
              {details.stagingLocation?.code ?? "—"}{" "}
              <span className="text-gray-500 font-sans text-xs ml-1">
                {details.stagingLocation?.label ?? ""}
              </span>
            </span>
          </p>
          <div className="pt-2 mt-2 border-t border-gray-200">
            <p className="font-medium text-gray-900 mb-1">Notes:</p>
            <p className="text-gray-700 bg-white p-2 rounded border border-gray-200">
              {details.delivery.notes || "—"}
            </p>
          </div>
          <div className="pt-2">
            <p className="font-medium text-gray-900 mb-1">Issue:</p>
            <p className="text-red-700 bg-red-50 p-2 rounded border border-red-100">
              {details.delivery.issueSummary || "—"}
            </p>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
          Items
        </h3>
        <div className="space-y-3">
          {details.items.map((item) => (
            <div
              key={item.id}
              className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm"
            >
              <div className="flex justify-between items-start mb-2">
                <p className="font-bold text-gray-900">{item.description}</p>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200">
                  {item.status}
                </span>
              </div>
              <p className="text-xs text-gray-500 mb-2">
                SKU:{" "}
                <span className="font-mono text-gray-700">
                  {item.sku ?? "—"}
                </span>
              </p>
              <div className="grid grid-cols-3 gap-2 text-xs text-center">
                <div className="bg-gray-50 rounded p-1.5 border border-gray-100">
                  <div className="text-gray-500 mb-0.5">Ordered</div>
                  <div className="font-mono font-medium text-gray-900">
                    {item.qtyOrdered}
                  </div>
                </div>
                <div className="bg-blue-50 rounded p-1.5 border border-blue-100">
                  <div className="text-blue-600 mb-0.5">Received</div>
                  <div className="font-mono font-medium text-blue-700">
                    {item.qtyReceived}
                  </div>
                </div>
                <div className="bg-red-50 rounded p-1.5 border border-red-100">
                  <div className="text-red-600 mb-0.5">Missing</div>
                  <div className="font-mono font-medium text-red-700">
                    {item.qtyMissing}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
          Status History
        </h3>
        <div className="relative border-l-2 border-gray-200 ml-3 space-y-4 pb-2">
          {details.statusHistory.length ? (
            details.statusHistory.map((event) => (
              <div key={event.id} className="relative pl-4">
                <div className="absolute -left-[9px] top-1 w-4 h-4 rounded-full bg-white border-2 border-blue-500"></div>
                <p className="text-sm font-medium text-gray-900">
                  {event.entityType} &rarr;{" "}
                  <span className="uppercase text-xs tracking-wider">
                    {event.toStatus}
                  </span>
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {event.actorType}
                  {event.actorName ? ` (${event.actorName})` : ""} &middot;{" "}
                  {new Date(event.createdAt).toLocaleString()}
                </p>
                {event.reason && (
                  <p className="text-sm text-gray-700 mt-1 bg-gray-50 p-2 rounded border border-gray-200">
                    {event.reason}
                  </p>
                )}
              </div>
            ))
          ) : (
            <p className="pl-4 text-gray-500 text-sm">
              No status history found.
            </p>
          )}
        </div>
      </section>

      <section>
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
          Pickup Events
        </h3>
        <div className="space-y-3">
          {details.pickupEvents.length ? (
            details.pickupEvents.map((pickup) => (
              <div
                key={pickup.id}
                className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm"
              >
                <p className="font-medium text-gray-900">
                  {pickup.technicianName}
                </p>
                <p className="text-xs text-gray-500 mb-2">
                  {new Date(pickup.pickedUpAt).toLocaleString()}
                </p>
                <p className="text-sm text-gray-700 bg-gray-50 p-2 rounded border border-gray-200 mb-2">
                  {pickup.itemsPickedSummary}
                </p>
                {pickup.notes && (
                  <p className="text-xs text-gray-600 italic">
                    Note: {pickup.notes}
                  </p>
                )}
              </div>
            ))
          ) : (
            <p className="text-gray-500 text-sm italic">
              No pickup events recorded yet.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
