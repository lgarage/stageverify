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
  pending: "bg-accent-amber/15 text-accent-amber border border-accent-amber/40",
  arrived: "bg-accent/15 text-accent border border-accent/40",
  partial:
    "bg-accent-purple/15 text-accent-purple border border-accent-purple/40",
  complete:
    "bg-accent-green/15 text-accent-green border border-accent-green/40",
  issue: "bg-accent-red/15 text-accent-red border border-accent-red/40",
  picked_up: "bg-bg-surface text-text-primary border border-border",
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
    setListLoading(true);
    setListError(null);

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
    } catch {
      setListError("Could not load deliveries. Please try again.");
    } finally {
      setListLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void fetchList();
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
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <div className="max-w-[1700px] mx-auto px-4 md:px-8 py-6">
        <header className="mb-4">
          <h1 className="text-2xl md:text-3xl font-bold">
            Dispatcher Dashboard
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Delivery staging and verification overview
          </p>
          <p className="text-xs text-text-secondary mt-2">
            Last updated: {lastUpdated ?? "Loading..."}
          </p>
        </header>

        <div className="sticky top-0 z-30 bg-bg-primary pb-3">
          <div className="rounded-xl border border-border bg-bg-card p-3 md:p-4 shadow-lg">
            <input
              value={query.search}
              onChange={(e) =>
                setQuery((prev) => ({
                  ...prev,
                  page: 1,
                  search: e.target.value,
                }))
              }
              placeholder="Search by Job #, Job Name, PO #, Order #, Vendor, Staging Location"
              className="w-full rounded-lg border border-border bg-bg-surface px-4 py-3 text-sm md:text-base focus:outline-none focus:ring-2 focus:ring-accent"
            />

            <div className="mt-3 flex flex-wrap gap-2 items-center">
              {STATUS_ORDER.map((status) => {
                const active = query.statuses.includes(status);
                return (
                  <button
                    key={status}
                    onClick={() => toggleStatus(status)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold tracking-wide border transition-colors ${
                      active
                        ? STATUS_STYLE[status]
                        : "bg-bg-surface text-text-secondary border-border hover:text-text-primary"
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
                  className="ml-auto text-xs px-3 py-1.5 rounded border border-border text-text-secondary hover:text-text-primary"
                >
                  Clear Filters
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-4">
          <section className="rounded-xl border border-border bg-bg-card overflow-hidden min-w-0">
            <div className="overflow-auto max-h-[70vh]">
              <table className="w-full min-w-[1200px] text-sm">
                <thead className="sticky top-0 z-20 bg-bg-secondary text-text-secondary shadow-sm">
                  <tr>
                    {SORT_COLUMNS.map((column) => {
                      const isSorted =
                        column.key && query.sortBy === column.key;
                      return (
                        <th
                          key={column.label}
                          className={`px-3 py-3 text-left font-semibold whitespace-nowrap ${column.className ?? ""}`}
                        >
                          {column.key ? (
                            <button
                              className="inline-flex items-center gap-1 hover:text-text-primary"
                              onClick={() =>
                                toggleSort(column.key as DeliverySortField)
                              }
                            >
                              {column.label}
                              <span className="text-[10px]">
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

                <tbody>
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
                        className={`border-t border-border cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 ${
                          selected
                            ? "bg-accent/10"
                            : "hover:bg-bg-secondary/50 active:bg-bg-secondary/70"
                        }`}
                      >
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex px-2 py-1 rounded text-[10px] font-semibold tracking-wider ${STATUS_STYLE[row.status]}`}
                          >
                            {STATUS_LABEL(row.status)}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono">{row.jobNumber}</td>
                        <td className="px-3 py-2">{row.jobName}</td>
                        <td className="px-3 py-2 font-mono">
                          {row.poNumber ?? "—"}
                        </td>
                        <td className="px-3 py-2 font-mono">
                          {row.orderNumber}
                        </td>
                        <td className="px-3 py-2">{row.vendorName}</td>
                        <td className="px-3 py-2">{row.deliveryDate}</td>
                        <td className="px-3 py-2 font-mono">
                          {row.stagingLocationCode ?? "—"}
                        </td>
                        <td className="px-3 py-2 font-mono">
                          {row.itemsReceivedLabel}
                        </td>
                        <td className="px-3 py-2">{row.issueSummary || "—"}</td>
                        <td className="px-3 py-2 text-right">
                          <span className="text-accent underline text-xs">
                            Open
                          </span>
                        </td>
                      </tr>
                    );
                  })}

                  {!listLoading && !listError && paged.items.length === 0 && (
                    <tr>
                      <td colSpan={11} className="p-10 text-center">
                        <p className="text-text-primary font-medium">
                          No matching deliveries
                        </p>
                        <p className="text-sm text-text-secondary mt-1">
                          Try adjusting search text or status filters.
                        </p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="border-t border-border p-3 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
              <span>
                Showing {paged.items.length} of {paged.totalItems}
              </span>

              <div className="ml-auto flex items-center gap-1">
                <button
                  onClick={() =>
                    setQuery((prev) => ({
                      ...prev,
                      page: Math.max(1, prev.page - 1),
                    }))
                  }
                  disabled={paged.page <= 1 || listLoading}
                  className="px-2 py-1 rounded border border-border disabled:opacity-40"
                >
                  Prev
                </button>

                {pageNumbers.map((pageNumber) => (
                  <button
                    key={pageNumber}
                    onClick={() =>
                      setQuery((prev) => ({ ...prev, page: pageNumber }))
                    }
                    className={`px-2 py-1 rounded border ${
                      pageNumber === paged.page
                        ? "border-accent text-accent"
                        : "border-border"
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
                  className="px-2 py-1 rounded border border-border disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>

            {(listLoading || listError) && (
              <div className="border-t border-border px-4 py-3 text-sm">
                {listLoading && (
                  <p className="text-text-secondary">Loading deliveries…</p>
                )}
                {listError && <p className="text-accent-red">{listError}</p>}
              </div>
            )}
          </section>

          <aside className="hidden xl:block rounded-xl border border-border bg-bg-card overflow-hidden">
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
          className="xl:hidden fixed inset-0 z-50 bg-black/60"
          onClick={() => setSelectedDeliveryId(null)}
        >
          <div
            className="absolute right-0 top-0 h-full w-full max-w-[92vw] bg-bg-card border-l border-border overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-bg-card z-10">
              <h2 className="font-semibold">Delivery Details</h2>
              <button
                className="text-sm border border-border rounded px-2 py-1"
                onClick={() => setSelectedDeliveryId(null)}
              >
                Close
              </button>
            </div>

            <div className="p-4">
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
    <div className="h-full max-h-[70vh] overflow-y-auto sticky top-[148px]">
      <div className="p-4 border-b border-border">
        <h2 className="font-semibold">Delivery Details</h2>
        <p className="text-xs text-text-secondary mt-1">
          {selectedDeliveryId
            ? `Selected: ${selectedDeliveryId}`
            : "Select a row to view details"}
        </p>
      </div>

      <div className="p-4">
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
    return <p className="text-sm text-text-secondary">Loading detail panel…</p>;
  }

  if (error) {
    return <p className="text-sm text-accent-red">{error}</p>;
  }

  if (!details) {
    return (
      <p className="text-sm text-text-secondary">
        No delivery selected. Click a row in the table.
      </p>
    );
  }

  return (
    <div className="space-y-4 text-sm">
      <section className="rounded-lg border border-border bg-bg-secondary/30 p-3">
        <h3 className="font-semibold mb-2">Delivery + Vendor</h3>
        <div className="space-y-1 text-text-secondary text-xs">
          <p>
            <span className="text-text-primary font-medium">Order:</span>{" "}
            {details.delivery.orderNumber}
          </p>
          <p>
            <span className="text-text-primary font-medium">Vendor:</span>{" "}
            {details.vendor.name}
          </p>
          <p>
            <span className="text-text-primary font-medium">PO:</span>{" "}
            {details.purchaseOrder?.poNumber ?? "—"}
          </p>
          <p>
            <span className="text-text-primary font-medium">Staging:</span>{" "}
            {details.stagingLocation?.code ?? "—"}{" "}
            {details.stagingLocation?.label ?? ""}
          </p>
          <p>
            <span className="text-text-primary font-medium">Notes:</span>{" "}
            {details.delivery.notes || "—"}
          </p>
          <p>
            <span className="text-text-primary font-medium">Issue:</span>{" "}
            {details.delivery.issueSummary || "—"}
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-bg-secondary/30 p-3">
        <h3 className="font-semibold mb-2">Items</h3>
        <div className="space-y-2 text-xs">
          {details.items.map((item) => (
            <div key={item.id} className="border border-border rounded p-2">
              <p className="text-text-primary font-medium">
                {item.description}
              </p>
              <p className="text-text-secondary">
                SKU: {item.sku ?? "—"} · Ordered {item.qtyOrdered} · Received{" "}
                {item.qtyReceived}
              </p>
              <p className="text-text-secondary">
                Missing {item.qtyMissing} · Damaged {item.qtyDamaged} ·
                Backordered {item.qtyBackordered}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-bg-secondary/30 p-3">
        <h3 className="font-semibold mb-2">Status History</h3>
        <ul className="space-y-2 text-xs text-text-secondary">
          {details.statusHistory.length ? (
            details.statusHistory.map((event) => (
              <li key={event.id} className="border-l-2 border-border pl-2">
                <p className="text-text-primary">
                  {event.entityType} → {event.toStatus}
                </p>
                <p>
                  {event.actorType}
                  {event.actorName ? ` (${event.actorName})` : ""} ·{" "}
                  {event.createdAt}
                </p>
                <p>{event.reason ?? "No reason provided"}</p>
              </li>
            ))
          ) : (
            <li>No status history found.</li>
          )}
        </ul>
      </section>

      <section className="rounded-lg border border-border bg-bg-secondary/30 p-3">
        <h3 className="font-semibold mb-2">Pickup Events</h3>
        <ul className="space-y-2 text-xs text-text-secondary">
          {details.pickupEvents.length ? (
            details.pickupEvents.map((pickup) => (
              <li key={pickup.id} className="border border-border rounded p-2">
                <p className="text-text-primary">
                  {pickup.technicianName} · {pickup.pickedUpAt}
                </p>
                <p>{pickup.itemsPickedSummary}</p>
                <p>{pickup.notes ?? "No notes"}</p>
              </li>
            ))
          ) : (
            <li>No pickup events recorded yet.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
