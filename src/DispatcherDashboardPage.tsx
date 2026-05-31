import { useCallback, useEffect, useMemo, useState } from "react";
import {
  mockDispatcherDataService,
  VALID_TRANSITIONS,
  type DeliveryDetails,
  type DeliveryListRow,
  type DeliverySortField,
  type DeliveryStatus,
  type PagedResult,
  type SortDirection,
} from "./dispatcher";

/* ─── Constants ─────────────────────────────────────────────────────────── */

const NAVY = "#0a3161";
const RED = "#bf0a30";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

const STATUS_ORDER: DeliveryStatus[] = [
  "pending",
  "arrived",
  "partial",
  "complete",
  "issue",
  "picked_up",
];

const STATUS_BADGE: Record<
  DeliveryStatus,
  { bg: string; text: string; border: string; dot: string }
> = {
  pending: {
    bg: "#f8f9fa",
    text: "#495057",
    border: "#ced4da",
    dot: "#adb5bd",
  },
  arrived: {
    bg: "#e8f4fd",
    text: "#1565c0",
    border: "#90caf9",
    dot: "#42a5f5",
  },
  partial: {
    bg: "#f3e5f5",
    text: "#6a1b9a",
    border: "#ce93d8",
    dot: "#ab47bc",
  },
  complete: {
    bg: "#e8f5e9",
    text: "#2e7d32",
    border: "#a5d6a7",
    dot: "#66bb6a",
  },
  issue: { bg: "#ffebee", text: "#c62828", border: "#ef9a9a", dot: "#ef5350" },
  picked_up: {
    bg: "#f5f5f5",
    text: "#616161",
    border: "#e0e0e0",
    dot: "#9e9e9e",
  },
};

const STATUS_COUNT_COLORS: Record<
  DeliveryStatus,
  { bg: string; text: string; accent: string }
> = {
  pending: { bg: "#fff8e1", text: "#f59104", accent: "#f59104" },
  arrived: { bg: "#e3f2fd", text: "#1565c0", accent: "#1976d2" },
  partial: { bg: "#f3e5f5", text: "#7b1fa2", accent: "#9c27b0" },
  complete: { bg: "#e8f5e9", text: "#2e7d32", accent: "#388e3c" },
  issue: { bg: "#ffebee", text: "#c62828", accent: "#d32f2f" },
  picked_up: { bg: "#f5f5f5", text: "#424242", accent: "#757575" },
};

const STATUS_LABEL = (status: DeliveryStatus): string =>
  status === "picked_up"
    ? "Picked Up"
    : status.charAt(0).toUpperCase() + status.slice(1);

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
  { label: "Staging Loc.", key: "stagingLocationCode" },
  { label: "Items Recv.", key: "itemsReceivedLabel" },
  { label: "Issue Summary", key: "issueSummary" },
  { label: "Action", className: "text-right" },
];

type ListQueryState = {
  search: string;
  statuses: DeliveryStatus[];
  sortBy: DeliverySortField;
  sortDirection: SortDirection;
  page: number;
  pageSize: number;
};

const INITIAL_PAGED: PagedResult<DeliveryListRow> = {
  items: [],
  page: 1,
  pageSize: 20,
  totalItems: 0,
  totalPages: 1,
};

/* ─── Nav Items ──────────────────────────────────────────────────────────── */

const NAV_ITEMS = [
  {
    label: "Dispatcher Dashboard",
    icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
    active: true,
  },
  {
    label: "Deliveries",
    icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
    active: false,
  },
  {
    label: "Staging Map",
    icon: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7",
    active: false,
  },
  {
    label: "Vendors",
    icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
    active: false,
  },
];

const SETTINGS_ITEM = {
  label: "Settings",
  icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
  active: false,
};

/* ─── Main Component ─────────────────────────────────────────────────────── */

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
  const [allRows, setAllRows] = useState<DeliveryListRow[]>([]);
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

  const [mutationLoading, setMutationLoading] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const hasActiveFilters = query.statuses.length > 0 || !!query.search.trim();

  /* ── Status summary tile counts (from full unfiltered list) ── */
  const statusCounts = useMemo<Record<DeliveryStatus, number>>(() => {
    const counts = Object.fromEntries(
      STATUS_ORDER.map((s) => [s, 0]),
    ) as Record<DeliveryStatus, number>;
    for (const row of allRows) {
      counts[row.status] = (counts[row.status] ?? 0) + 1;
    }
    return counts;
  }, [allRows]);

  /* ── Data fetching ── */
  const fetchAllData = useCallback(async () => {
    setListLoading(true);
    try {
      const [pagedResult, allResult] = await Promise.all([
        mockDispatcherDataService.listDeliveries({
          search: query.search,
          statuses: query.statuses.length ? query.statuses : undefined,
          sortBy: query.sortBy,
          sortDirection: query.sortDirection,
          page: query.page,
          pageSize: query.pageSize,
        }),
        mockDispatcherDataService.listDeliveries({ page: 1, pageSize: 1000 }),
      ]);
      setPaged(pagedResult);
      setAllRows(allResult.items);
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
      await fetchAllData();
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [fetchAllData]);

  /* ── Esc to close drawer ── */
  useEffect(() => {
    if (!selectedDeliveryId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedDeliveryId(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedDeliveryId]);

  /* ── Detail drawer ── */
  const handleUpdateStatus = async (
    toStatus: DeliveryStatus,
    reason?: string,
  ) => {
    if (!selectedDeliveryId) return;

    setMutationLoading(true);
    setMutationError(null);

    try {
      const updatedDetails =
        await mockDispatcherDataService.updateDeliveryStatus(
          selectedDeliveryId,
          toStatus,
          reason,
        );

      if (updatedDetails) {
        setSelectedDetails(updatedDetails);
        await fetchAllData(); // Refresh dashboard data
      } else {
        setMutationError(
          "Failed to update status. The transition may be invalid.",
        );
      }
    } catch (e) {
      setMutationError("An unexpected error occurred while updating status.");
      console.error(e);
    } finally {
      setMutationLoading(false);
    }
  };

  const selectDelivery = async (deliveryId: string) => {
    setSelectedDeliveryId(deliveryId);
    setDetailLoading(true);
    setDetailError(null);
    setMutationError(null); // Clear mutation error on new selection
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

  /* ── Filter / sort helpers ── */
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
      return { ...prev, sortBy: field, sortDirection: "asc" };
    });
  };

  const pageNumbers = useMemo(() => {
    return Array.from({ length: paged.totalPages }, (_, i) => i + 1).slice(
      Math.max(0, paged.page - 3),
      Math.max(5, paged.page + 2),
    );
  }, [paged.page, paged.totalPages]);

  /* ── Render ── */
  return (
    <div style={{ fontFamily: FONT }} className="min-h-screen flex">
      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside
        style={{
          backgroundColor: NAVY,
          minHeight: "100vh",
          boxShadow: "rgba(0,0,0,0.15) 2px 0px 10px 0px",
        }}
        className="w-60 flex-shrink-0 hidden md:flex flex-col z-20"
      >
        {/* Brand */}
        <div
          className="flex flex-col items-center px-6 pt-7 pb-5"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.10)" }}
        >
          <div
            className="flex items-center justify-center rounded-full mb-3"
            style={{
              width: 60,
              height: 60,
              backgroundColor: "#fff",
              border: `3px solid ${RED}`,
              boxShadow: "0 2px 12px rgba(0,0,0,0.20)",
            }}
          >
            <span
              style={{
                color: NAVY,
                fontWeight: 900,
                fontSize: 20,
                letterSpacing: "-0.04em",
              }}
            >
              SV
            </span>
          </div>
          <span
            style={{
              color: "#fff",
              fontWeight: 700,
              fontSize: 14,
              letterSpacing: "0.08em",
            }}
          >
            STAGEVERIFY
          </span>
          <span
            style={{
              color: "rgba(255,255,255,0.45)",
              fontSize: 11,
              marginTop: 2,
            }}
          >
            Dispatcher Portal
          </span>
        </div>

        {/* Nav label */}
        <div className="px-5 pt-5 pb-1">
          <span
            style={{
              color: "rgba(255,255,255,0.35)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Main Menu
          </span>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-3 pb-4 space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.label}
              href="#"
              onClick={(e) => e.preventDefault()}
              style={
                item.active
                  ? {
                      backgroundColor: RED,
                      color: "#fff",
                      borderRadius: 6,
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "18px 20px",
                      fontWeight: 700,
                      fontSize: 15,
                      textDecoration: "none",
                      boxShadow: `0 2px 8px rgba(191,10,48,0.35)`,
                    }
                  : {
                      color: "rgba(255,255,255,0.60)",
                      borderRadius: 6,
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "18px 20px",
                      fontWeight: 700,
                      fontSize: 15,
                      textDecoration: "none",
                      transition: "background 0.15s, color 0.15s",
                    }
              }
              onMouseEnter={(e) => {
                if (!item.active) {
                  (e.currentTarget as HTMLElement).style.backgroundColor =
                    "rgba(255,255,255,0.08)";
                  (e.currentTarget as HTMLElement).style.color = "#fff";
                }
              }}
              onMouseLeave={(e) => {
                if (!item.active) {
                  (e.currentTarget as HTMLElement).style.backgroundColor =
                    "transparent";
                  (e.currentTarget as HTMLElement).style.color =
                    "rgba(255,255,255,0.60)";
                }
              }}
            >
              <svg
                width={16}
                height={16}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.9}
                strokeLinecap="round"
                strokeLinejoin="round"
                viewBox="0 0 24 24"
                style={{ flexShrink: 0 }}
              >
                {item.icon.split(" M").map((part, i) => (
                  <path key={i} d={i === 0 ? part : "M" + part} />
                ))}
              </svg>
              {item.label}
            </a>
          ))}
        </nav>

        {/* Settings — pinned to bottom */}
        <div
          className="px-3 pb-2"
          style={{
            borderTop: "1px solid rgba(255,255,255,0.08)",
            paddingTop: 8,
          }}
        >
          <a
            href="#"
            onClick={(e) => e.preventDefault()}
            style={{
              color: "rgba(255,255,255,0.60)",
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "18px 20px",
              fontWeight: 700,
              fontSize: 15,
              textDecoration: "none",
              transition: "background 0.15s, color 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor =
                "rgba(255,255,255,0.08)";
              (e.currentTarget as HTMLElement).style.color = "#fff";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor =
                "transparent";
              (e.currentTarget as HTMLElement).style.color =
                "rgba(255,255,255,0.60)";
            }}
          >
            <svg
              width={16}
              height={16}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.9}
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
              style={{ flexShrink: 0 }}
            >
              {SETTINGS_ITEM.icon.split(" M").map((part, i) => (
                <path key={i} d={i === 0 ? part : "M" + part} />
              ))}
            </svg>
            {SETTINGS_ITEM.label}
          </a>
        </div>

        {/* Footer */}
        <div
          className="px-5 py-4 text-center"
          style={{
            borderTop: "1px solid rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.30)",
            fontSize: 11,
          }}
        >
          v1.0 &nbsp;·&nbsp; StageVerify
        </div>
      </aside>

      {/* ── Main Content ─────────────────────────────────────────── */}
      <div
        className="flex-1 flex flex-col min-w-0 overflow-y-auto"
        style={{ backgroundColor: "#f0f2f5" }}
      >
        {/* Top bar */}
        <div
          className="sticky top-0 z-10 flex items-center justify-between"
          style={{
            backgroundColor: "#fff",
            borderBottom: "1px solid #e0e3e8",
            height: 52,
            padding: "0 20px",
            boxShadow: "rgba(0,0,0,0.08) 0px 2px 6px 0px",
          }}
        >
          <div className="flex items-center gap-3">
            <span style={{ color: NAVY, fontWeight: 700, fontSize: 15 }}>
              Dispatcher Dashboard
            </span>
            <span style={{ color: "#9ca3af", fontSize: 13 }}>
              / Delivery Overview
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              Last updated:{" "}
              <span style={{ fontWeight: 600, color: "#374151" }}>
                {lastUpdated ?? "Loading…"}
              </span>
            </div>
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                backgroundColor: NAVY,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: 13,
                flexShrink: 0,
              }}
            >
              D
            </div>
          </div>
        </div>

        {/* Page content */}
        <div
          style={{
            padding: "30px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            width: "100%",
            maxWidth: 1440,
            margin: "0 auto",
          }}
        >
          {/* ── Page header ── */}
          <div>
            <h1
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: NAVY,
                margin: 0,
                lineHeight: "1.2",
              }}
            >
              Delivery Overview
            </h1>
            <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
              Manage incoming deliveries, staging assignments, and verification
              status.
            </p>
          </div>

          {/* ── Summary tiles ── */}
          {allRows.length > 0 && (
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
              {STATUS_ORDER.map((status) => {
                const c = STATUS_COUNT_COLORS[status];
                const count = statusCounts[status];
                const isFiltered = query.statuses.includes(status);
                return (
                  <button
                    key={status}
                    onClick={() => toggleStatus(status)}
                    style={{
                      backgroundColor: isFiltered ? c.accent : "#fff",
                      border: isFiltered
                        ? `2px solid ${c.accent}`
                        : "1px solid #dde1e7",
                      borderRadius: 8,
                      padding: "18px 20px",
                      textAlign: "left",
                      cursor: "pointer",
                      boxShadow: "rgba(0,0,0,0.15) 0px 4px 12px 0px",
                      transition: "all 0.15s",
                      outline: "none",
                      minHeight: 90,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 32,
                        fontWeight: 800,
                        color: isFiltered ? "#fff" : c.accent,
                        lineHeight: 1,
                      }}
                    >
                      {count}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: isFiltered
                          ? "rgba(255,255,255,0.85)"
                          : "#374151",
                        marginTop: 10,
                        textTransform: "none",
                        letterSpacing: "normal",
                        fontFamily: FONT,
                      }}
                    >
                      {STATUS_LABEL(status)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* ── Search / Filter card ── */}
          <div
            style={{
              backgroundColor: "#fff",
              border: "1px solid #dde1e7",
              borderRadius: 8,
              boxShadow: "rgba(0,0,0,0.15) 0px 4px 12px 0px",
              padding: "15px 20px",
            }}
          >
            <div className="flex flex-col md:flex-row gap-5 items-start">
              {/* Search */}
              <div style={{ flex: 1 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#6b7280",
                    textTransform: "none",
                    letterSpacing: "normal",
                    marginBottom: 6,
                  }}
                >
                  Search Deliveries
                </label>
                <div style={{ position: "relative" }}>
                  <svg
                    width={18}
                    height={18}
                    fill="none"
                    stroke="#9ca3af"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    viewBox="0 0 24 24"
                    style={{
                      position: "absolute",
                      left: 13,
                      top: "50%",
                      transform: "translateY(-50%)",
                      pointerEvents: "none",
                    }}
                  >
                    <circle cx={11} cy={11} r={8} />
                    <path d="M21 21l-4.35-4.35" />
                  </svg>
                  <input
                    value={query.search}
                    onChange={(e) =>
                      setQuery((prev) => ({
                        ...prev,
                        page: 1,
                        search: e.target.value,
                      }))
                    }
                    placeholder="Job #, name, PO, order, vendor, staging location…"
                    style={{
                      width: "100%",
                      padding: "12px 14px 12px 40px",
                      border: "1.5px solid #ccd0d7",
                      borderRadius: 6,
                      fontSize: 16,
                      color: "#333",
                      outline: "none",
                      backgroundColor: "#fff",
                      fontFamily: FONT,
                      transition: "border-color 0.15s, box-shadow 0.15s",
                    }}
                    onFocus={(e) => {
                      e.target.style.borderColor = NAVY;
                      e.target.style.boxShadow = `0 0 0 2px ${NAVY}20`;
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = "#ccd0d7";
                      e.target.style.boxShadow = "none";
                    }}
                  />
                </div>
              </div>

              {/* Status filters */}
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#6b7280",
                    textTransform: "none",
                    letterSpacing: "normal",
                    marginBottom: 6,
                  }}
                >
                  Filter by Status
                </label>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 5,
                    alignItems: "center",
                  }}
                >
                  {STATUS_ORDER.map((status) => {
                    const active = query.statuses.includes(status);
                    const b = STATUS_BADGE[status];
                    return (
                      <button
                        key={status}
                        onClick={() => toggleStatus(status)}
                        style={{
                          padding: "4px 10px",
                          borderRadius: 4,
                          fontSize: 12,
                          fontWeight: 700,
                          letterSpacing: "normal",
                          border: active
                            ? `2px solid ${b.border}`
                            : `1px solid #ccd0d7`,
                          backgroundColor: active ? b.bg : "#f9fafb",
                          color: active ? b.text : "#6b7280",
                          cursor: "pointer",
                          transition: "all 0.12s",
                          outline: "none",
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                          fontFamily: FONT,
                        }}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            backgroundColor: active ? b.dot : "#ccd0d7",
                            flexShrink: 0,
                          }}
                        />
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
                      style={{
                        marginLeft: 2,
                        padding: "4px 10px",
                        borderRadius: 4,
                        fontSize: 12,
                        fontWeight: 600,
                        border: "1px solid #ccd0d7",
                        backgroundColor: "#fff",
                        color: "#ef4444",
                        cursor: "pointer",
                        outline: "none",
                        fontFamily: FONT,
                      }}
                    >
                      ✕ Clear
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── Table card ── */}
          <div
            style={{
              backgroundColor: "#fff",
              border: "1px solid #dde1e7",
              borderRadius: 8,
              boxShadow: "rgba(0,0,0,0.15) 0px 4px 12px 0px",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Table card header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "15px 20px",
                borderBottom: "1px solid #eaecf0",
              }}
            >
              <div>
                <span style={{ fontWeight: 700, fontSize: 15, color: NAVY }}>
                  Deliveries
                </span>
                {!listLoading && (
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 12,
                      color: "#9ca3af",
                      fontWeight: 500,
                    }}
                  >
                    {paged.totalItems}{" "}
                    {paged.totalItems === 1 ? "record" : "records"}
                    {hasActiveFilters ? " (filtered)" : ""}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {listLoading && (
                  <span style={{ fontSize: 12, color: "#9ca3af" }}>
                    Loading…
                  </span>
                )}
                {listError && (
                  <span style={{ fontSize: 12, color: "#ef4444" }}>
                    {listError}
                  </span>
                )}
              </div>
            </div>

            {/* Scrollable table */}
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  minWidth: 1100,
                  borderCollapse: "collapse",
                  fontSize: 14,
                  fontFamily: FONT,
                }}
              >
                <thead>
                  <tr style={{ backgroundColor: NAVY }}>
                    {SORT_COLUMNS.map((col) => {
                      const isSorted = col.key && query.sortBy === col.key;
                      return (
                        <th
                          key={col.label}
                          style={{
                            padding: "12px",
                            fontWeight: 700,
                            fontSize: 14,
                            color: "#ffffff",
                            textAlign: col.className?.includes("text-right")
                              ? "right"
                              : "left",
                            whiteSpace: "nowrap",
                            letterSpacing: "normal",
                            userSelect: "none",
                          }}
                        >
                          {col.key ? (
                            <button
                              onClick={() =>
                                toggleSort(col.key as DeliverySortField)
                              }
                              style={{
                                background: "none",
                                border: "none",
                                color: "inherit",
                                font: "inherit",
                                cursor: "pointer",
                                padding: 0,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                outline: "none",
                              }}
                            >
                              {col.label}
                              <span
                                style={{
                                  fontSize: 10,
                                  opacity: isSorted ? 1 : 0.6,
                                }}
                              >
                                {isSorted
                                  ? query.sortDirection === "asc"
                                    ? "▲"
                                    : "▼"
                                  : "↕"}
                              </span>
                            </button>
                          ) : (
                            col.label
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>

                <tbody>
                  {paged.items.map((row, idx) => {
                    const selected = selectedDeliveryId === row.deliveryId;
                    const b = STATUS_BADGE[row.status];
                    return (
                      <tr
                        key={row.deliveryId}
                        tabIndex={0}
                        role="button"
                        onClick={() => void selectDelivery(row.deliveryId)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            void selectDelivery(row.deliveryId);
                          }
                        }}
                        style={{
                          backgroundColor: selected
                            ? "#eef4ff"
                            : idx % 2 === 0
                              ? "#fff"
                              : "#fafbfc",
                          cursor: "pointer",
                          outline: "none",
                          borderLeft: selected
                            ? `3px solid ${NAVY}`
                            : "3px solid transparent",
                          transition: "background-color 0.1s",
                        }}
                        onMouseEnter={(e) => {
                          if (!selected)
                            (
                              e.currentTarget as HTMLElement
                            ).style.backgroundColor = "#f5f8ff";
                        }}
                        onMouseLeave={(e) => {
                          if (!selected)
                            (
                              e.currentTarget as HTMLElement
                            ).style.backgroundColor =
                              idx % 2 === 0 ? "#fff" : "#fafbfc";
                        }}
                      >
                        {/* Status badge */}
                        <td
                          style={{
                            padding: "14px 12px",
                            borderBottom: "1px solid #eaecf0",
                          }}
                        >
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              padding: "3px 8px",
                              borderRadius: 4,
                              fontSize: 11,
                              fontWeight: 700,
                              letterSpacing: "normal",
                              backgroundColor: b.bg,
                              color: b.text,
                              border: `1px solid ${b.border}`,
                              whiteSpace: "nowrap",
                            }}
                          >
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                backgroundColor: b.dot,
                                flexShrink: 0,
                              }}
                            />
                            {STATUS_LABEL(row.status)}
                          </span>
                        </td>
                        <td
                          style={{
                            padding: "14px 12px",
                            borderBottom: "1px solid #eaecf0",
                            fontFamily: "monospace",
                            color: "#333",
                            fontWeight: 600,
                            fontSize: 13,
                          }}
                        >
                          {row.jobNumber}
                        </td>
                        <td
                          style={{
                            padding: "14px 12px",
                            borderBottom: "1px solid #eaecf0",
                            fontWeight: 600,
                            color: "#111",
                          }}
                        >
                          {row.jobName}
                        </td>
                        <td
                          style={{
                            padding: "14px 12px",
                            borderBottom: "1px solid #eaecf0",
                            fontFamily: "monospace",
                            color: "#666",
                            fontSize: 13,
                          }}
                        >
                          {row.poNumber ?? "—"}
                        </td>
                        <td
                          style={{
                            padding: "14px 12px",
                            borderBottom: "1px solid #eaecf0",
                            fontFamily: "monospace",
                            color: "#666",
                            fontSize: 13,
                          }}
                        >
                          {row.orderNumber}
                        </td>
                        <td
                          style={{
                            padding: "14px 12px",
                            borderBottom: "1px solid #eaecf0",
                            color: "#333",
                          }}
                        >
                          {row.vendorName}
                        </td>
                        <td
                          style={{
                            padding: "14px 12px",
                            borderBottom: "1px solid #eaecf0",
                            color: "#333",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {row.deliveryDate}
                        </td>
                        <td
                          style={{
                            padding: "14px 12px",
                            borderBottom: "1px solid #eaecf0",
                          }}
                        >
                          {row.stagingLocationCode ? (
                            <span
                              style={{
                                display: "inline-block",
                                padding: "3px 8px",
                                borderRadius: 4,
                                backgroundColor: "#eef2ff",
                                color: NAVY,
                                fontSize: 12,
                                fontWeight: 700,
                                fontFamily: "monospace",
                                border: `1px solid #c7d4f0`,
                              }}
                            >
                              {row.stagingLocationCode}
                            </span>
                          ) : (
                            <span style={{ color: "#9ca3af" }}>—</span>
                          )}
                        </td>
                        <td
                          style={{
                            padding: "14px 12px",
                            borderBottom: "1px solid #eaecf0",
                            fontFamily: "monospace",
                            color: "#333",
                            fontWeight: 600,
                          }}
                        >
                          {row.itemsReceivedLabel}
                        </td>
                        <td
                          style={{
                            padding: "14px 12px",
                            borderBottom: "1px solid #eaecf0",
                            color: row.issueSummary ? "#c62828" : "#9ca3af",
                            maxWidth: 200,
                          }}
                        >
                          {row.issueSummary ? (
                            <span
                              style={{
                                display: "flex",
                                alignItems: "flex-start",
                                gap: 5,
                              }}
                            >
                              <span style={{ flexShrink: 0, marginTop: 1 }}>
                                ⚠
                              </span>
                              {row.issueSummary}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td
                          style={{
                            padding: "14px 12px",
                            borderBottom: "1px solid #eaecf0",
                            textAlign: "right",
                          }}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void selectDelivery(row.deliveryId);
                            }}
                            style={{
                              backgroundColor: selected ? NAVY : "#fff",
                              color: selected ? "#fff" : NAVY,
                              border: `1.5px solid ${NAVY}`,
                              borderRadius: 4,
                              padding: "4px 10px",
                              fontSize: 12,
                              fontWeight: 700,
                              cursor: "pointer",
                              letterSpacing: "normal",
                              transition: "all 0.13s",
                              outline: "none",
                              fontFamily: FONT,
                            }}
                            onMouseEnter={(e) => {
                              const el = e.currentTarget as HTMLElement;
                              el.style.backgroundColor = NAVY;
                              el.style.color = "#fff";
                            }}
                            onMouseLeave={(e) => {
                              const el = e.currentTarget as HTMLElement;
                              if (!selected) {
                                el.style.backgroundColor = "#fff";
                                el.style.color = NAVY;
                              }
                            }}
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}

                  {/* Empty state */}
                  {!listLoading && !listError && paged.items.length === 0 && (
                    <tr>
                      <td
                        colSpan={11}
                        style={{ padding: "60px 24px", textAlign: "center" }}
                      >
                        <div
                          style={{
                            color: "#9ca3af",
                            fontSize: 48,
                            marginBottom: 16,
                          }}
                        >
                          📦
                        </div>
                        <p
                          style={{
                            fontSize: 16,
                            fontWeight: 700,
                            color: "#333",
                            margin: 0,
                          }}
                        >
                          No deliveries found
                        </p>
                        <p
                          style={{
                            fontSize: 13,
                            color: "#9ca3af",
                            marginTop: 6,
                          }}
                        >
                          Try adjusting your search or status filters.
                        </p>
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
                            style={{
                              marginTop: 16,
                              padding: "8px 18px",
                              borderRadius: 4,
                              border: `1.5px solid ${NAVY}`,
                              backgroundColor: "#fff",
                              color: NAVY,
                              fontWeight: 600,
                              fontSize: 13,
                              cursor: "pointer",
                              fontFamily: FONT,
                            }}
                          >
                            Clear Filters
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination footer */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 12,
                padding: "12px 20px",
                borderTop: "1px solid #eaecf0",
                backgroundColor: "#fafbfc",
              }}
            >
              <span style={{ fontSize: 13, color: "#6b7280" }}>
                Showing{" "}
                <strong style={{ color: "#333" }}>{paged.items.length}</strong>{" "}
                of <strong style={{ color: "#333" }}>{paged.totalItems}</strong>{" "}
                deliveries
              </span>

              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <PagBtn
                  onClick={() =>
                    setQuery((p) => ({ ...p, page: Math.max(1, p.page - 1) }))
                  }
                  disabled={paged.page <= 1 || listLoading}
                  label="← Prev"
                  navy={NAVY}
                  font={FONT}
                />

                {pageNumbers.map((n) => (
                  <PagBtn
                    key={n}
                    onClick={() => setQuery((p) => ({ ...p, page: n }))}
                    disabled={listLoading}
                    label={String(n)}
                    navy={NAVY}
                    font={FONT}
                    active={n === paged.page}
                  />
                ))}

                <PagBtn
                  onClick={() =>
                    setQuery((p) => ({
                      ...p,
                      page: Math.min(paged.totalPages, p.page + 1),
                    }))
                  }
                  disabled={paged.page >= paged.totalPages || listLoading}
                  label="Next →"
                  navy={NAVY}
                  font={FONT}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Detail Drawer ──────────────────────────────────────────── */}
      {selectedDeliveryId && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            backgroundColor: "rgba(10,15,30,0.55)",
            backdropFilter: "blur(3px)",
            display: "flex",
            justifyContent: "flex-end",
          }}
          onClick={() => setSelectedDeliveryId(null)}
        >
          <div
            style={{
              height: "100%",
              width: "100%",
              maxWidth: 480,
              backgroundColor: "#fff",
              borderLeft: "1px solid #e0e3e8",
              boxShadow: "-8px 0 40px rgba(0,0,0,0.18)",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              fontFamily: FONT,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "15px 20px",
                borderBottom: "1px solid #e0e3e8",
                position: "sticky",
                top: 0,
                backgroundColor: "#fff",
                zIndex: 10,
                boxShadow: "rgba(0,0,0,0.08) 0px 2px 6px 0px",
              }}
            >
              <div>
                <h2
                  style={{
                    margin: 0,
                    fontSize: 16,
                    fontWeight: 700,
                    color: NAVY,
                  }}
                >
                  Delivery Details
                </h2>
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    color: "#9ca3af",
                    marginTop: 2,
                  }}
                >
                  Click outside or press Esc to close
                </p>
              </div>
              <button
                onClick={() => setSelectedDeliveryId(null)}
                style={{
                  padding: "5px 12px",
                  border: "1px solid #ccd0d7",
                  borderRadius: 4,
                  backgroundColor: "#f9fafb",
                  color: "#333",
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: "pointer",
                  outline: "none",
                  transition: "all 0.12s",
                  fontFamily: FONT,
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor =
                    "#fee2e2";
                  (e.currentTarget as HTMLElement).style.borderColor =
                    "#fca5a5";
                  (e.currentTarget as HTMLElement).style.color = "#b91c1c";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor =
                    "#f9fafb";
                  (e.currentTarget as HTMLElement).style.borderColor =
                    "#ccd0d7";
                  (e.currentTarget as HTMLElement).style.color = "#333";
                }}
              >
                ✕ Close
              </button>
            </div>

            <div style={{ padding: "20px", flex: 1 }}>
              <DetailContent
                loading={detailLoading}
                error={detailError}
                details={selectedDetails}
                navy={NAVY}
                font={FONT}
                mutationLoading={mutationLoading}
                mutationError={mutationError}
                onUpdateStatus={handleUpdateStatus}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Pagination Button ──────────────────────────────────────────────────── */

function PagBtn({
  onClick,
  disabled,
  label,
  navy,
  font,
  active = false,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  navy: string;
  font: string;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "5px 10px",
        borderRadius: 4,
        border: active ? `2px solid ${navy}` : "1px solid #ccd0d7",
        backgroundColor: active ? navy : "#fff",
        color: active ? "#fff" : disabled ? "#9ca3af" : "#333",
        fontWeight: active ? 700 : 500,
        fontSize: 13,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        outline: "none",
        transition: "all 0.12s",
        fontFamily: font,
      }}
    >
      {label}
    </button>
  );
}

/* ─── Detail Content ─────────────────────────────────────────────────────── */

function DetailContent({
  loading,
  error,
  details,
  navy,
  font,
  mutationLoading,
  mutationError,
  onUpdateStatus,
}: {
  loading: boolean;
  error: string | null;
  details: DeliveryDetails | null;
  navy: string;
  font: string;
  mutationLoading: boolean;
  mutationError: string | null;
  onUpdateStatus: (toStatus: DeliveryStatus, reason?: string) => Promise<void>;
}) {
  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "48px 0" }}>
        <div style={{ color: "#9ca3af", fontSize: 14 }}>
          Loading detail panel…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          backgroundColor: "#fee2e2",
          borderRadius: 6,
          padding: "15px",
          color: "#b91c1c",
          fontSize: 14,
        }}
      >
        {error}
      </div>
    );
  }

  if (!details) {
    return (
      <div style={{ textAlign: "center", padding: "64px 0" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
        <p style={{ fontWeight: 700, fontSize: 16, color: "#333", margin: 0 }}>
          No delivery selected
        </p>
        <p style={{ fontSize: 13, color: "#9ca3af", marginTop: 6 }}>
          Click a row in the table to view details.
        </p>
      </div>
    );
  }

  const STATUS_BADGE_LOCAL: Record<
    string,
    { bg: string; text: string; border: string }
  > = {
    pending: { bg: "#f8f9fa", text: "#495057", border: "#ced4da" },
    received: { bg: "#e8f5e9", text: "#2e7d32", border: "#a5d6a7" },
    partial: { bg: "#f3e5f5", text: "#6a1b9a", border: "#ce93d8" },
    backordered: { bg: "#fff8e1", text: "#f57c00", border: "#ffcc02" },
    damaged: { bg: "#ffebee", text: "#c62828", border: "#ef9a9a" },
  };

  return (
    <>
      <StatusActionPanel
        details={details}
        loading={mutationLoading}
        error={mutationError}
        onUpdateStatus={onUpdateStatus}
        navy={navy}
        font={font}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 20,
          fontSize: 14,
          fontFamily: font,
        }}
      >
        {[
          {
            title: "Delivery & Vendor",
            content: (
              <div
                style={{
                  backgroundColor: "#f8fafc",
                  border: "1px solid #e0e3e8",
                  borderRadius: 8,
                  padding: "15px",
                  display: "flex",
                  flexDirection: "column" as const,
                  gap: 10,
                }}
              >
                {[
                  {
                    label: "Order #",
                    value: (
                      <span
                        style={{ fontFamily: "monospace", fontWeight: 700 }}
                      >
                        {details.delivery.orderNumber}
                      </span>
                    ),
                  },
                  { label: "Vendor", value: details.vendor.name },
                  {
                    label: "PO #",
                    value: (
                      <span style={{ fontFamily: "monospace" }}>
                        {details.purchaseOrder?.poNumber ?? "—"}
                      </span>
                    ),
                  },
                  {
                    label: "Staging",
                    value: details.stagingLocation ? (
                      <>
                        <span
                          style={{
                            fontFamily: "monospace",
                            fontWeight: 700,
                            backgroundColor: "#eef2ff",
                            padding: "2px 7px",
                            borderRadius: 4,
                            color: navy,
                            border: "1px solid #c7d2fe",
                          }}
                        >
                          {details.stagingLocation.code}
                        </span>{" "}
                        <span style={{ color: "#9ca3af", fontSize: 12 }}>
                          {details.stagingLocation.label}
                        </span>
                      </>
                    ) : (
                      "—"
                    ),
                  },
                ].map(({ label, value }) => (
                  <div
                    key={label}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <span
                      style={{
                        color: "#6b7280",
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      {label}
                    </span>
                    <span style={{ color: "#333", textAlign: "right" }}>
                      {value}
                    </span>
                  </div>
                ))}

                {details.delivery.notes && (
                  <div
                    style={{
                      borderTop: "1px solid #eaecf0",
                      paddingTop: 10,
                      marginTop: 2,
                    }}
                  >
                    <span
                      style={{
                        color: "#6b7280",
                        fontWeight: 600,
                        fontSize: 12,
                        display: "block",
                        marginBottom: 5,
                      }}
                    >
                      Notes
                    </span>
                    <p
                      style={{
                        margin: 0,
                        color: "#333",
                        backgroundColor: "#fff",
                        padding: "8px 12px",
                        borderRadius: 4,
                        border: "1px solid #e0e3e8",
                      }}
                    >
                      {details.delivery.notes}
                    </p>
                  </div>
                )}
                {details.delivery.issueSummary && (
                  <div
                    style={{
                      borderTop: "1px solid #eaecf0",
                      paddingTop: 10,
                      marginTop: 2,
                    }}
                  >
                    <span
                      style={{
                        color: "#c62828",
                        fontWeight: 600,
                        fontSize: 12,
                        display: "block",
                        marginBottom: 5,
                      }}
                    >
                      ⚠ Issue
                    </span>
                    <p
                      style={{
                        margin: 0,
                        color: "#c62828",
                        backgroundColor: "#ffebee",
                        padding: "8px 12px",
                        borderRadius: 4,
                        border: "1px solid #ef9a9a",
                      }}
                    >
                      {details.delivery.issueSummary}
                    </p>
                  </div>
                )}
              </div>
            ),
          },
          {
            title: `Items (${details.items.length})`,
            content: (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column" as const,
                  gap: 8,
                }}
              >
                {details.items.map((item) => {
                  const sb = STATUS_BADGE_LOCAL[item.status] ?? {
                    bg: "#f8f9fa",
                    text: "#495057",
                    border: "#ced4da",
                  };
                  return (
                    <div
                      key={item.id}
                      style={{
                        border: "1px solid #e0e3e8",
                        borderRadius: 8,
                        padding: "12px",
                        backgroundColor: "#fff",
                        boxShadow: "rgba(0,0,0,0.08) 0px 2px 6px 0px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: 8,
                          marginBottom: 8,
                        }}
                      >
                        <div>
                          <p
                            style={{
                              margin: 0,
                              fontWeight: 700,
                              color: "#111",
                            }}
                          >
                            {item.description}
                          </p>
                          <p
                            style={{
                              margin: "3px 0 0",
                              fontSize: 11,
                              color: "#9ca3af",
                              fontFamily: "monospace",
                            }}
                          >
                            SKU: {item.sku ?? "—"}
                          </p>
                        </div>
                        <span
                          style={{
                            flexShrink: 0,
                            padding: "3px 8px",
                            borderRadius: 4,
                            fontSize: 10,
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            backgroundColor: sb.bg,
                            color: sb.text,
                            border: `1px solid ${sb.border}`,
                          }}
                        >
                          {item.status}
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr 1fr",
                          gap: 8,
                        }}
                      >
                        {[
                          {
                            label: "Ordered",
                            value: item.qtyOrdered,
                            bg: "#f8f9fa",
                            text: "#333",
                            border: "#e0e3e8",
                          },
                          {
                            label: "Received",
                            value: item.qtyReceived,
                            bg: "#e8f5e9",
                            text: "#2e7d32",
                            border: "#a5d6a7",
                          },
                          {
                            label: "Missing",
                            value: item.qtyMissing,
                            bg: "#ffebee",
                            text: "#c62828",
                            border: "#ef9a9a",
                          },
                        ].map(({ label, value, bg, text, border }) => (
                          <div
                            key={label}
                            style={{
                              backgroundColor: bg,
                              border: `1px solid ${border}`,
                              borderRadius: 4,
                              padding: "8px 4px",
                              textAlign: "center",
                            }}
                          >
                            <div
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                color: text,
                                marginBottom: 2,
                                textTransform: "uppercase",
                                letterSpacing: "0.06em",
                              }}
                            >
                              {label}
                            </div>
                            <div
                              style={{
                                fontSize: 16,
                                fontWeight: 700,
                                fontFamily: "monospace",
                                color: text,
                              }}
                            >
                              {value}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ),
          },
          {
            title: "Status History",
            content: (
              <div
                style={{
                  position: "relative",
                  paddingLeft: 20,
                  borderLeft: `2px solid #e0e3e8`,
                  marginLeft: 8,
                  display: "flex",
                  flexDirection: "column" as const,
                  gap: 16,
                }}
              >
                {details.statusHistory.length ? (
                  details.statusHistory.map((event) => (
                    <div key={event.id} style={{ position: "relative" }}>
                      <div
                        style={{
                          position: "absolute",
                          left: -27,
                          top: 4,
                          width: 14,
                          height: 14,
                          borderRadius: "50%",
                          backgroundColor: "#fff",
                          border: `2px solid ${navy}`,
                          boxShadow: `0 0 0 3px #eef2ff`,
                        }}
                      />
                      <p style={{ margin: 0, fontWeight: 700, color: "#111" }}>
                        {event.entityType}{" "}
                        <span
                          style={{
                            color: "#9ca3af",
                            fontWeight: 400,
                            fontSize: 12,
                          }}
                        >
                          →
                        </span>{" "}
                        <span
                          style={{
                            textTransform: "uppercase",
                            fontSize: 11,
                            letterSpacing: "0.06em",
                            color: navy,
                            fontWeight: 700,
                          }}
                        >
                          {event.toStatus}
                        </span>
                      </p>
                      <p
                        style={{
                          margin: "3px 0 0",
                          fontSize: 12,
                          color: "#9ca3af",
                        }}
                      >
                        {event.actorType}
                        {event.actorName ? ` · ${event.actorName}` : ""} ·{" "}
                        {new Date(event.createdAt).toLocaleString()}
                      </p>
                      {event.reason && (
                        <p
                          style={{
                            margin: "6px 0 0",
                            fontSize: 13,
                            color: "#333",
                            backgroundColor: "#f8fafc",
                            padding: "7px 10px",
                            borderRadius: 4,
                            border: "1px solid #e0e3e8",
                          }}
                        >
                          {event.reason}
                        </p>
                      )}
                    </div>
                  ))
                ) : (
                  <p style={{ color: "#9ca3af", fontSize: 13 }}>
                    No status history found.
                  </p>
                )}
              </div>
            ),
          },
          {
            title: "Pickup Events",
            content: (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column" as const,
                  gap: 8,
                }}
              >
                {details.pickupEvents.length ? (
                  details.pickupEvents.map((pickup) => (
                    <div
                      key={pickup.id}
                      style={{
                        border: "1px solid #e0e3e8",
                        borderRadius: 8,
                        padding: "12px",
                        backgroundColor: "#fff",
                        boxShadow: "rgba(0,0,0,0.08) 0px 2px 6px 0px",
                      }}
                    >
                      <p style={{ margin: 0, fontWeight: 700, color: "#111" }}>
                        {pickup.technicianName}
                      </p>
                      <p
                        style={{
                          margin: "3px 0 8px",
                          fontSize: 12,
                          color: "#9ca3af",
                        }}
                      >
                        {new Date(pickup.pickedUpAt).toLocaleString()}
                      </p>
                      <p
                        style={{
                          margin: 0,
                          backgroundColor: "#f8fafc",
                          padding: "8px 12px",
                          borderRadius: 4,
                          border: "1px solid #e0e3e8",
                          color: "#333",
                        }}
                      >
                        {pickup.itemsPickedSummary}
                      </p>
                      {pickup.notes && (
                        <p
                          style={{
                            margin: "8px 0 0",
                            fontSize: 12,
                            color: "#6b7280",
                            fontStyle: "italic",
                          }}
                        >
                          Note: {pickup.notes}
                        </p>
                      )}
                    </div>
                  ))
                ) : (
                  <p style={{ color: "#9ca3af", fontSize: 13 }}>
                    No pickup events recorded yet.
                  </p>
                )}
              </div>
            ),
          },
        ].map(({ title, content }) => (
          <section key={title}>
            <h3
              style={{
                margin: "0 0 10px",
                fontSize: 11,
                fontWeight: 700,
                color: "#9ca3af",
                textTransform: "uppercase",
                letterSpacing: "0.10em",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 16,
                  height: 2,
                  backgroundColor: navy,
                  borderRadius: 2,
                  flexShrink: 0,
                }}
              />
              {title}
            </h3>
            {content}
          </section>
        ))}
      </div>
    </>
  );
}

/* ─── Status Action Panel ────────────────────────────────────────────────── */

function StatusActionPanel({
  details,
  loading,
  error,
  onUpdateStatus,
  navy,
  font,
}: {
  details: DeliveryDetails;
  loading: boolean;
  error: string | null;
  onUpdateStatus: (toStatus: DeliveryStatus, reason?: string) => Promise<void>;
  navy: string;
  font: string;
}) {
  const [reason, setReason] = useState("");
  const [showReasonInput, setShowReasonInput] = useState(false);

  const currentStatus = details.delivery.status;
  const possibleNext = VALID_TRANSITIONS[currentStatus] ?? [];

  const handleActionClick = (nextStatus: DeliveryStatus) => {
    if (nextStatus === "issue") {
      setShowReasonInput(true);
    } else {
      void onUpdateStatus(nextStatus);
    }
  };

  const handleConfirmIssue = () => {
    if (reason.trim()) {
      void onUpdateStatus("issue", reason.trim());
      setShowReasonInput(false);
      setReason("");
    }
  };

  const b = STATUS_BADGE[currentStatus];

  return (
    <section
      style={{
        border: "1px solid #dde1e7",
        borderRadius: 8,
        backgroundColor: "#f8fafc",
        padding: "15px",
        marginBottom: 20,
      }}
    >
      <h3
        style={{
          margin: "0 0 12px",
          fontSize: 11,
          fontWeight: 700,
          color: "#9ca3af",
          textTransform: "uppercase",
          letterSpacing: "0.10em",
        }}
      >
        Current Status
      </h3>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 12px",
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: "normal",
            backgroundColor: b.bg,
            color: b.text,
            border: `1px solid ${b.border}`,
            whiteSpace: "nowrap",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: b.dot,
              flexShrink: 0,
            }}
          />
          {STATUS_LABEL(currentStatus)}
        </span>
      </div>

      {possibleNext.length > 0 && !showReasonInput && (
        <div>
          <h3
            style={{
              margin: "16px 0 8px",
              fontSize: 11,
              fontWeight: 700,
              color: "#9ca3af",
              textTransform: "uppercase",
              letterSpacing: "0.10em",
            }}
          >
            Update Status
          </h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {possibleNext.map((status) => (
              <button
                key={status}
                onClick={() => handleActionClick(status)}
                disabled={loading}
                style={{
                  backgroundColor: loading ? "#f3f4f6" : "#fff",
                  color: loading ? "#9ca3af" : navy,
                  border: `1.5px solid ${loading ? "#d1d5db" : navy}`,
                  borderRadius: 4,
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: loading ? "not-allowed" : "pointer",
                  fontFamily: font,
                  transition: "all 0.13s",
                }}
              >
                {loading ? "Updating…" : `Mark ${STATUS_LABEL(status)}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {showReasonInput && (
        <div>
          <h3
            style={{
              margin: "16px 0 8px",
              fontSize: 11,
              fontWeight: 700,
              color: "#c62828",
              textTransform: "uppercase",
              letterSpacing: "0.10em",
            }}
          >
            Report Issue
          </h3>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Briefly describe the issue..."
            disabled={false}
            style={{
              width: "100%",
              minHeight: 60,
              padding: "8px 12px",
              border: "1.5px solid #ccd0d7",
              borderRadius: 6,
              fontSize: 14,
              fontFamily: font,
              outline: "none",
              marginBottom: 8,
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleConfirmIssue}
              disabled={loading || !reason.trim()}
              style={{
                backgroundColor:
                  loading || !reason.trim() ? "#f3f4f6" : "#c62828",
                color: loading || !reason.trim() ? "#9ca3af" : "#fff",
                border: `1.5px solid ${
                  loading || !reason.trim() ? "#d1d5db" : "#c62828"
                }`,
                borderRadius: 4,
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 700,
                cursor: loading || !reason.trim() ? "not-allowed" : "pointer",
                fontFamily: font,
              }}
            >
              {loading ? "Saving..." : "Confirm Issue"}
            </button>
            <button
              onClick={() => setShowReasonInput(false)}
              disabled={loading}
              style={{
                backgroundColor: "#fff",
                color: "#374151",
                border: "1.5px solid #d1d5db",
                borderRadius: 4,
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: font,
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <div
          style={{
            marginTop: 12,
            backgroundColor: "#fee2e2",
            borderRadius: 6,
            padding: "10px 15px",
            color: "#b91c1c",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      )}
    </section>
  );
}
