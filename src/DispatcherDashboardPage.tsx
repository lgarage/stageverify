import { Fragment, useEffect, useMemo, useState } from "react";
import {
  mockDispatcherDataService,
  type DeliveryDetails,
  type DeliveryListRow,
  type DeliverySortField,
  type DeliveryStatus,
  type SortDirection,
} from "./dispatcher";

const statusStyles: Record<DeliveryStatus, string> = {
  pending: "bg-accent-amber/15 text-accent-amber border border-accent-amber/40",
  arrived: "bg-accent/15 text-accent border border-accent/40",
  partial:
    "bg-accent-purple/15 text-accent-purple border border-accent-purple/40",
  complete:
    "bg-accent-green/15 text-accent-green border border-accent-green/40",
  issue: "bg-accent-red/15 text-accent-red border border-accent-red/40",
  picked_up: "bg-bg-surface text-text-primary border border-border",
};

const statusOrder: DeliveryStatus[] = [
  "pending",
  "arrived",
  "partial",
  "complete",
  "issue",
  "picked_up",
];

const statusLabel = (status: DeliveryStatus): string =>
  status.replace("_", " ").toUpperCase();

const sortColumns: Array<{
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

export function DispatcherDashboardPage() {
  const [search, setSearch] = useState("");
  const [activeStatuses, setActiveStatuses] = useState<DeliveryStatus[]>([]);
  const [sortBy, setSortBy] = useState<DeliverySortField>("deliveryDate");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [rows, setRows] = useState<DeliveryListRow[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailsMap, setDetailsMap] = useState<Record<string, DeliveryDetails>>(
    {},
  );

  const queryStatuses = useMemo(
    () => (activeStatuses.length ? activeStatuses : undefined),
    [activeStatuses],
  );

  useEffect(() => {
    let mounted = true;

    mockDispatcherDataService
      .listDeliveries({
        search,
        statuses: queryStatuses,
        sortBy,
        sortDirection,
        page: 1,
        pageSize: 100,
      })
      .then((result) => {
        if (mounted) {
          setRows(result.items);
        }
      });

    return () => {
      mounted = false;
    };
  }, [search, queryStatuses, sortBy, sortDirection]);

  const toggleStatus = (status: DeliveryStatus) => {
    setActiveStatuses((prev) =>
      prev.includes(status)
        ? prev.filter((s) => s !== status)
        : [...prev, status],
    );
  };

  const toggleSort = (field: DeliverySortField) => {
    setSortBy((prevField) => {
      if (prevField === field) {
        setSortDirection((prevDirection) =>
          prevDirection === "asc" ? "desc" : "asc",
        );
        return prevField;
      }

      setSortDirection("asc");
      return field;
    });
  };

  const openDetails = async (deliveryId: string) => {
    if (expandedId === deliveryId) {
      setExpandedId(null);
      return;
    }

    setExpandedId(deliveryId);
    if (detailsMap[deliveryId]) {
      return;
    }

    const details =
      await mockDispatcherDataService.getDeliveryDetails(deliveryId);
    if (!details) {
      return;
    }

    setDetailsMap((prev) => ({ ...prev, [deliveryId]: details }));
  };

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <div className="max-w-[1500px] mx-auto px-4 md:px-8 py-6">
        <header className="mb-4">
          <h1 className="text-2xl md:text-3xl font-bold">
            Dispatcher Dashboard
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Delivery staging and verification overview
          </p>
        </header>

        <div className="sticky top-0 z-20 bg-bg-primary pb-3">
          <div className="rounded-xl border border-border bg-bg-card p-3 md:p-4 shadow-lg">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by Job #, Job Name, PO #, Order #, Vendor, Staging Location"
              className="w-full rounded-lg border border-border bg-bg-surface px-4 py-3 text-sm md:text-base focus:outline-none focus:ring-2 focus:ring-accent"
            />

            <div className="mt-3 flex flex-wrap gap-2">
              {statusOrder.map((status) => {
                const active = activeStatuses.includes(status);
                return (
                  <button
                    key={status}
                    onClick={() => toggleStatus(status)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold tracking-wide border transition-colors ${
                      active
                        ? statusStyles[status]
                        : "bg-bg-surface text-text-secondary border-border"
                    }`}
                  >
                    {statusLabel(status)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-border bg-bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1200px] text-sm">
              <thead className="bg-bg-secondary text-text-secondary">
                <tr>
                  {sortColumns.map((column) => {
                    const isSorted = column.key && sortBy === column.key;
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
                                ? sortDirection === "asc"
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
                {rows.map((row) => (
                  <Fragment key={row.deliveryId}>
                    <tr
                      className="border-t border-border hover:bg-bg-secondary/40 cursor-pointer"
                      onClick={() => openDetails(row.deliveryId)}
                    >
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex px-2 py-1 rounded text-[10px] font-semibold tracking-wider ${statusStyles[row.status]}`}
                        >
                          {statusLabel(row.status)}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono">{row.jobNumber}</td>
                      <td className="px-3 py-2">{row.jobName}</td>
                      <td className="px-3 py-2 font-mono">
                        {row.poNumber ?? "—"}
                      </td>
                      <td className="px-3 py-2 font-mono">{row.orderNumber}</td>
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
                        <button className="text-accent underline text-xs">
                          View
                        </button>
                      </td>
                    </tr>

                    {expandedId === row.deliveryId && (
                      <tr className="bg-bg-secondary/30 border-t border-border">
                        <td colSpan={11} className="p-4">
                          <DetailPanel details={detailsMap[row.deliveryId]} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}

                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={11}
                      className="p-8 text-center text-text-secondary"
                    >
                      No deliveries match current search/filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailPanel({ details }: { details?: DeliveryDetails }) {
  if (!details) {
    return (
      <div className="text-sm text-text-secondary">Loading details...</div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 text-sm">
      <section className="rounded-lg border border-border bg-bg-card p-4">
        <h3 className="font-semibold mb-2">Delivery + Vendor</h3>
        <div className="space-y-1 text-text-secondary">
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
            {details.stagingLocation?.label}
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

      <section className="rounded-lg border border-border bg-bg-card p-4 xl:col-span-2">
        <h3 className="font-semibold mb-2">Items</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[650px] text-xs">
            <thead className="text-text-secondary">
              <tr>
                <th className="text-left py-1">Description</th>
                <th className="text-left py-1">SKU</th>
                <th className="text-left py-1">Ordered</th>
                <th className="text-left py-1">Received</th>
                <th className="text-left py-1">Missing</th>
                <th className="text-left py-1">Damaged</th>
                <th className="text-left py-1">Backordered</th>
                <th className="text-left py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {details.items.map((item) => (
                <tr key={item.id} className="border-t border-border/70">
                  <td className="py-1.5 text-text-primary">
                    {item.description}
                  </td>
                  <td className="py-1.5 font-mono">{item.sku ?? "—"}</td>
                  <td className="py-1.5 font-mono">{item.qtyOrdered}</td>
                  <td className="py-1.5 font-mono">{item.qtyReceived}</td>
                  <td className="py-1.5 font-mono">{item.qtyMissing}</td>
                  <td className="py-1.5 font-mono">{item.qtyDamaged}</td>
                  <td className="py-1.5 font-mono">{item.qtyBackordered}</td>
                  <td className="py-1.5 uppercase">{item.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-bg-card p-4">
        <h3 className="font-semibold mb-2">Status History</h3>
        <ul className="space-y-2 text-xs text-text-secondary">
          {details.statusHistory.length ? (
            details.statusHistory.map((event) => (
              <li key={event.id} className="border-l-2 border-border pl-3">
                <p className="text-text-primary">
                  {event.entityType} → {event.toStatus}
                </p>
                <p>{event.reason ?? "No reason provided"}</p>
                <p>
                  {event.actorType}
                  {event.actorName ? ` (${event.actorName})` : ""} ·{" "}
                  {event.createdAt}
                </p>
              </li>
            ))
          ) : (
            <li>No status history found.</li>
          )}
        </ul>
      </section>

      <section className="rounded-lg border border-border bg-bg-card p-4 xl:col-span-2">
        <h3 className="font-semibold mb-2">Pickup Events</h3>
        <ul className="space-y-2 text-xs text-text-secondary">
          {details.pickupEvents.length ? (
            details.pickupEvents.map((pickup) => (
              <li key={pickup.id} className="border border-border rounded p-2">
                <p className="text-text-primary font-medium">
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
