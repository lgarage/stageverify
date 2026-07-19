import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CreateDeliveryModal } from "./CreateDeliveryModal";
import { DispatcherPortalTopBar } from "./DispatcherPortalTopBar";
import { firestoreDataService } from "./dispatcher/firestoreService";
import { useDispatcherPortal } from "./dispatcher/DispatcherPortalContext";
import {
  type DeliveryListRow,
  type DeliverySortField,
  type PagedResult,
  type SortDirection,
} from "./dispatcher";
import {
  PORTAL_SHELL_CLASS,
  PORTAL_MAIN_CLASS,
  PORTAL_SCROLL_CLASS,
} from "./dispatcherPortalLayout";
import { PortalSidebar } from "./PortalSidebar";
import { NeedsReviewSection } from "./dispatcher/email/NeedsReviewSection";
import { portalNavFocus } from "./dispatcherPortalNav";
import {
  DELIVERY_OVERVIEW_FILTER_LABEL,
  DELIVERY_OVERVIEW_STATUS_ORDER,
  incrementOverviewStatusCounts,
  STAGING_PLAN_MISMATCH_LABEL,
  STAGING_PLAN_MISMATCH_TITLE,
  type DeliveryOverviewFilterStatus,
} from "./dispatcher/deliveryDisplayHelpers";
import { DeliveryDetailDrawer } from "./dispatcher/drawer/DeliveryDetailDrawer";

/* ─── Constants ─────────────────────────────────────────────────────────── */

const NAVY = "#0a3161";
/** Dark orange — dispatcher table rows needing staging assignment. */
const DISPATCHER_ACTION_REQUIRED_BG = "#c2410c";
const DISPATCHER_ACTION_REQUIRED_HOVER = "#b45309";
const DISPATCHER_ACTION_REQUIRED_SELECTED = "#9a3412";

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

const STATUS_ORDER: DeliveryOverviewFilterStatus[] =
  DELIVERY_OVERVIEW_STATUS_ORDER;

const STATUS_BADGE: Record<
  DeliveryOverviewFilterStatus,
  { bg: string; text: string; border: string; dot: string }
> = {
  pending: {
    bg: "#f8f9fa",
    text: "#495057",
    border: "#ced4da",
    dot: "#adb5bd",
  },
  shipped: {
    bg: "#e3f2fd",
    text: "#0d47a1",
    border: "#90caf9",
    dot: "#1976d2",
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
  ready_for_pickup: {
    bg: "#e8f5e9",
    text: "#2e7d32",
    border: "#a5d6a7",
    dot: "#66bb6a",
  },
  complete: {
    bg: "#e8f5e9",
    text: "#2e7d32",
    border: "#a5d6a7",
    dot: "#66bb6a",
  },
  delivered: {
    bg: "#e0f2f1",
    text: "#00695c",
    border: "#80cbc4",
    dot: "#00897b",
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
  DeliveryOverviewFilterStatus,
  { bg: string; text: string; accent: string }
> = {
  pending: { bg: "#fff8e1", text: "#f59104", accent: "#f59104" },
  arrived: { bg: "#e3f2fd", text: "#1565c0", accent: "#1976d2" },
  partial: { bg: "#f3e5f5", text: "#7b1fa2", accent: "#9c27b0" },
  ready_for_pickup: { bg: "#e8f5e9", text: "#2e7d32", accent: "#388e3c" },
  complete: { bg: "#e8f5e9", text: "#2e7d32", accent: "#388e3c" },
  delivered: { bg: "#e0f2f1", text: "#00695c", accent: "#00897b" },
  issue: { bg: "#ffebee", text: "#c62828", accent: "#d32f2f" },
  picked_up: { bg: "#f5f5f5", text: "#424242", accent: "#757575" },
  shipped: { bg: "#e3f2fd", text: "#0d47a1", accent: "#1976d2" },
};

const STATUS_LABEL = (status: DeliveryOverviewFilterStatus): string =>
  DELIVERY_OVERVIEW_FILTER_LABEL[status];

function listStatusBadge(
  row: DeliveryListRow,
): (typeof STATUS_BADGE)[DeliveryOverviewFilterStatus] {
  const label = row.statusDisplayLabel;
  if (label === "Delivered") return STATUS_BADGE.delivered;
  if (label === "Complete") return STATUS_BADGE.complete;
  if (label === "Ready for Pickup") return STATUS_BADGE.ready_for_pickup;
  if (label === "Issue / Review Required") return STATUS_BADGE.issue;
  if (label === "Picked Up") return STATUS_BADGE.picked_up;
  if (label === "Partial") return STATUS_BADGE.partial;
  if (label === "Reserved") {
    return row.status === "shipped"
      ? STATUS_BADGE.shipped
      : STATUS_BADGE.pending;
  }
  if (label === "Pending Delivery" || label === "Awaiting Vendor Delivery") {
    return row.status === "shipped"
      ? STATUS_BADGE.shipped
      : STATUS_BADGE.pending;
  }
  if (label === "Incomplete") return STATUS_BADGE.partial;
  if (row.status === "installed") return STATUS_BADGE.picked_up;
  return STATUS_BADGE[row.status as DeliveryOverviewFilterStatus];
}

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
  statuses: DeliveryOverviewFilterStatus[];
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

/* ─── Main Component ─────────────────────────────────────────────────────── */

export function DispatcherDashboardPage() {
  const navigate = useNavigate();
  const location = useLocation();

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

  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(
    null,
  );
  const [showCreateModal, setShowCreateModal] = useState(false);
  const fetchAllDataRef = useRef<() => Promise<void>>(async () => {});
  const lastRefreshGeneration = useRef(0);
  const {
    refreshBusy,
    gmailSyncMessage,
    lastUpdated: refreshLastUpdated,
    setLastUpdated,
    handleRefreshNow,
    refreshGeneration,
    invoiceImports,
    invoiceShellBackfillErrors,
    refreshPortalData,
  } = useDispatcherPortal();

  const focusNeedsReview = portalNavFocus(location.search) === "needs-review";

  const hasActiveFilters = query.statuses.length > 0 || !!query.search.trim();

  /* ── Status summary tile counts (from full unfiltered list) ── */
  const statusCounts = useMemo<Record<DeliveryOverviewFilterStatus, number>>(() => {
    const counts = Object.fromEntries(
      STATUS_ORDER.map((s) => [s, 0]),
    ) as Record<DeliveryOverviewFilterStatus, number>;
    for (const row of allRows) {
      incrementOverviewStatusCounts(counts, row);
    }
    return counts;
  }, [allRows]);

  /* ── Data fetching ── */
  const fetchAllData = useCallback(async () => {
    setListLoading(true);
    try {
      const [pagedResult, allResult] = await Promise.all([
        firestoreDataService.listDeliveries({
          search: query.search,
          statuses: query.statuses.length ? query.statuses : undefined,
          sortBy: query.sortBy,
          sortDirection: query.sortDirection,
          page: query.page,
          pageSize: query.pageSize,
        }),
        firestoreDataService.listDeliveries({ page: 1, pageSize: 1000 }),
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
    fetchAllDataRef.current = fetchAllData;
  }, [fetchAllData]);

  useEffect(() => {
    if (refreshGeneration > lastRefreshGeneration.current) {
      lastRefreshGeneration.current = refreshGeneration;
      void fetchAllData();
    }
  }, [refreshGeneration, fetchAllData]);

  useEffect(() => {
    const state = location.state as { openNewDelivery?: boolean } | null;
    if (state?.openNewDelivery) {
      setShowCreateModal(true);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.pathname, location.state, navigate]);

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

  useEffect(() => {
    const intervalId = setInterval(() => {
      void fetchAllData();
    }, 30000);
    return () => {
      clearInterval(intervalId);
    };
  }, [fetchAllData]);

  const selectDelivery = (deliveryId: string) => {
    setSelectedDeliveryId(deliveryId);
  };

  /* Deep-link drawer for verify harnesses when seed demo rows are hidden on prod. */
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const openId = params.get("openDelivery")?.trim();
    if (!openId || selectedDeliveryId === openId) return;
    selectDelivery(openId);
  }, [location.search, selectedDeliveryId]);

  /* ── Filter / sort helpers ── */
  const toggleStatus = (status: DeliveryOverviewFilterStatus) => {
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
    <div style={{ fontFamily: FONT }} className={PORTAL_SHELL_CLASS}>
      <PortalSidebar />

      {/* ── Main Content ─────────────────────────────────────────── */}
      <div
        className={PORTAL_MAIN_CLASS}
        style={{ backgroundColor: "#f0f2f5" }}
      >
        <DispatcherPortalTopBar
          title="Dispatcher Dashboard"
          subtitle="Delivery Overview"
          lastUpdated={refreshLastUpdated}
          refreshBusy={refreshBusy}
          refreshDisabled={listLoading}
          gmailSyncMessage={gmailSyncMessage}
          onRefreshNow={handleRefreshNow}
          onNewDelivery={() => setShowCreateModal(true)}
        />

        {/* Page content — scrolls independently of sidebar and top bar */}
        <div
          className={PORTAL_SCROLL_CLASS}
          style={{ backgroundColor: "#f0f2f5" }}
        >
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

          <NeedsReviewSection
            syncedImports={invoiceImports}
            refreshGeneration={refreshGeneration}
            backfillErrors={invoiceShellBackfillErrors}
            onApproveSuccess={refreshPortalData}
            focusOnMount={focusNeedsReview}
          />

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
            id="portal-deliveries"
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
                    const actionRequired = row.missingStagingAssignment;
                    const b = listStatusBadge(row);
                    const defaultRowBg = idx % 2 === 0 ? "#fff" : "#fafbfc";
                    const rowBg = selected
                      ? actionRequired
                        ? DISPATCHER_ACTION_REQUIRED_SELECTED
                        : "#eef4ff"
                      : actionRequired
                        ? DISPATCHER_ACTION_REQUIRED_BG
                        : defaultRowBg;
                    const cellText = actionRequired ? "#fff" : undefined;
                    const cellMuted = actionRequired ? "rgba(255,255,255,0.75)" : "#666";
                    const cellStrong = actionRequired ? "#fff" : "#111";
                    const cellBody = actionRequired ? "#fff" : "#333";
                    const issueSummaryColor =
                      row.issueSummary === "Pickup Scheduled" ||
                      row.issueSummary.startsWith("Delivered to ")
                        ? actionRequired
                          ? "#fff"
                          : NAVY
                        : row.issueSummary.startsWith("Confirm delivery") ||
                            row.issueSummary === "Confirm site delivery"
                          ? actionRequired
                            ? "#fff"
                            : "#c62828"
                          : row.issueSummary
                          ? actionRequired
                            ? "#fff"
                            : "#c62828"
                          : actionRequired
                            ? "rgba(255,255,255,0.75)"
                            : "#9ca3af";
                    return (
                      <tr
                        key={row.deliveryId}
                        className={
                          actionRequired ? "dispatcher-action-required" : undefined
                        }
                        data-testid={
                          actionRequired
                            ? `dispatcher-action-required-${row.deliveryId}`
                            : undefined
                        }
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
                          backgroundColor: rowBg,
                          cursor: "pointer",
                          outline: "none",
                          borderLeft: selected
                            ? `3px solid ${actionRequired ? "#fff" : NAVY}`
                            : "3px solid transparent",
                          transition: "background-color 0.1s",
                          color: cellText,
                        }}
                        onMouseEnter={(e) => {
                          if (!selected) {
                            (
                              e.currentTarget as HTMLElement
                            ).style.backgroundColor = actionRequired
                              ? DISPATCHER_ACTION_REQUIRED_HOVER
                              : "#f5f8ff";
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!selected) {
                            (
                              e.currentTarget as HTMLElement
                            ).style.backgroundColor = actionRequired
                              ? DISPATCHER_ACTION_REQUIRED_BG
                              : defaultRowBg;
                          }
                        }}
                        onFocus={(e) => {
                          (
                            e.currentTarget as HTMLElement
                          ).style.backgroundColor = actionRequired
                            ? DISPATCHER_ACTION_REQUIRED_HOVER
                            : selected
                              ? "#eef4ff"
                              : "#f5f8ff";
                        }}
                        onBlur={(e) => {
                          (
                            e.currentTarget as HTMLElement
                          ).style.backgroundColor = rowBg;
                        }}
                      >
                        {/* Status badge */}
                        <td
                          style={{
                            padding: "14px 12px",
                            borderBottom: actionRequired
                              ? "1px solid rgba(255,255,255,0.2)"
                              : "1px solid #eaecf0",
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
                            {row.statusDisplayLabel}
                          </span>
                        </td>
                        <td
                          style={{
                            padding: "14px 12px",
                            borderBottom: actionRequired
                              ? "1px solid rgba(255,255,255,0.2)"
                              : "1px solid #eaecf0",
                            fontFamily: "monospace",
                            color: cellMuted,
                            fontWeight: 600,
                            fontSize: 13,
                          }}
                        >
                          {row.jobNumber}
                        </td>
                        <td
                          style={{
                            padding: "14px 12px",
                            borderBottom: actionRequired
                              ? "1px solid rgba(255,255,255,0.2)"
                              : "1px solid #eaecf0",
                            fontWeight: 600,
                            color: cellStrong,
                          }}
                        >
                          {row.jobName}
                        </td>
                        <td
                          style={{
                            padding: "14px 12px",
                            borderBottom: actionRequired
                              ? "1px solid rgba(255,255,255,0.2)"
                              : "1px solid #eaecf0",
                            fontFamily: "monospace",
                            color: cellMuted,
                            fontSize: 13,
                          }}
                        >
                          {row.poNumber ?? "—"}
                        </td>
                        <td
                          style={{
                            padding: "14px 12px",
                            borderBottom: actionRequired
                              ? "1px solid rgba(255,255,255,0.2)"
                              : "1px solid #eaecf0",
                            fontFamily: "monospace",
                            color: cellMuted,
                            fontSize: 13,
                          }}
                        >
                          {row.orderNumber}
                        </td>
                        <td
                          style={{
                            padding: "14px 12px",
                            borderBottom: actionRequired
                              ? "1px solid rgba(255,255,255,0.2)"
                              : "1px solid #eaecf0",
                            color: cellBody,
                          }}
                        >
                          {row.vendorName}
                        </td>
                        <td
                          style={{
                            padding: "14px 12px",
                            borderBottom: actionRequired
                              ? "1px solid rgba(255,255,255,0.2)"
                              : "1px solid #eaecf0",
                            color: cellBody,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {row.deliveryDate}
                        </td>
                        <td
                          style={{
                            padding: "14px 12px",
                            borderBottom: actionRequired
                              ? "1px solid rgba(255,255,255,0.2)"
                              : "1px solid #eaecf0",
                          }}
                        >
                          {row.stagingLocationCode ? (
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                flexWrap: "wrap",
                              }}
                            >
                              <span
                                style={{
                                  display: "inline-block",
                                  padding: "3px 8px",
                                  borderRadius: 4,
                                  backgroundColor: actionRequired
                                    ? "rgba(255,255,255,0.2)"
                                    : "#eef2ff",
                                  color: actionRequired ? "#fff" : NAVY,
                                  fontSize: 12,
                                  fontWeight: 700,
                                  fontFamily: "monospace",
                                  border: actionRequired
                                    ? "1px solid rgba(255,255,255,0.45)"
                                    : `1px solid #c7d4f0`,
                                }}
                              >
                                {row.stagingLocationCode}
                              </span>
                              {row.plannedActualDivergence ? (
                                <span
                                  data-testid={`staging-divergence-badge-${row.deliveryId}`}
                                  title={STAGING_PLAN_MISMATCH_TITLE}
                                  style={{
                                    display: "inline-block",
                                    padding: "2px 6px",
                                    borderRadius: 4,
                                    backgroundColor: "#fff7ed",
                                    color: "#9a3412",
                                    fontSize: 10,
                                    fontWeight: 800,
                                    letterSpacing: "0.04em",
                                    textTransform: "uppercase",
                                    border: "1px solid #fdba74",
                                  }}
                                >
                                  {STAGING_PLAN_MISMATCH_LABEL}
                                </span>
                              ) : null}
                            </span>
                          ) : row.plannedActualDivergence ? (
                            <span
                              data-testid={`staging-divergence-badge-${row.deliveryId}`}
                              title={STAGING_PLAN_MISMATCH_TITLE}
                              style={{
                                display: "inline-block",
                                padding: "2px 6px",
                                borderRadius: 4,
                                backgroundColor: "#fff7ed",
                                color: "#9a3412",
                                fontSize: 10,
                                fontWeight: 800,
                                letterSpacing: "0.04em",
                                textTransform: "uppercase",
                                border: "1px solid #fdba74",
                              }}
                            >
                              {STAGING_PLAN_MISMATCH_LABEL}
                            </span>
                          ) : (
                            <span
                              style={{
                                color: actionRequired
                                  ? "rgba(255,255,255,0.75)"
                                  : "#9ca3af",
                              }}
                            >
                              —
                            </span>
                          )}
                        </td>
                        <td
                          style={{
                            padding: "14px 12px",
                            borderBottom: actionRequired
                              ? "1px solid rgba(255,255,255,0.2)"
                              : "1px solid #eaecf0",
                            fontFamily: "monospace",
                            color: cellBody,
                            fontWeight: 600,
                          }}
                        >
                          {row.itemsReceivedLabel}
                        </td>
                        <td
                          style={{
                            padding: "14px 12px",
                            borderBottom: actionRequired
                              ? "1px solid rgba(255,255,255,0.2)"
                              : "1px solid #eaecf0",
                            color: issueSummaryColor,
                            maxWidth: 200,
                          }}
                        >
                          {row.openIssueCount > 0 && row.issueSummary !== "Pickup Scheduled" && (
                            <span
                              data-testid={`open-issue-badge-${row.deliveryId}`}
                              style={{
                                display: "inline-block",
                                marginBottom: row.issueSummary ? 6 : 0,
                                padding: "2px 8px",
                                borderRadius: 999,
                                backgroundColor: actionRequired
                                  ? "rgba(255,255,255,0.2)"
                                  : "#ffebee",
                                color: actionRequired ? "#fff" : "#c62828",
                                fontSize: 11,
                                fontWeight: 700,
                                border: actionRequired
                                  ? "1px solid rgba(255,255,255,0.35)"
                                  : undefined,
                              }}
                            >
                              Issues ({row.openIssueCount})
                            </span>
                          )}
                          {row.issueSummary ? (
                            <span
                              style={{
                                display: "flex",
                                alignItems: "flex-start",
                                gap: 5,
                              }}
                            >
                              {row.issueSummary !== "Pickup Scheduled" ? (
                                <span style={{ flexShrink: 0, marginTop: 1 }}>
                                  ⚠
                                </span>
                              ) : null}
                              {row.issueSummary}
                            </span>
                          ) : row.openIssueCount > 0 ? null : (
                            "—"
                          )}
                        </td>
                        <td
                          style={{
                            padding: "14px 12px",
                            borderBottom: actionRequired
                              ? "1px solid rgba(255,255,255,0.2)"
                              : "1px solid #eaecf0",
                            textAlign: "right",
                          }}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void selectDelivery(row.deliveryId);
                            }}
                            style={{
                              backgroundColor: actionRequired
                                ? selected
                                  ? "#fff"
                                  : "rgba(255,255,255,0.15)"
                                : selected
                                  ? NAVY
                                  : "#fff",
                              color: actionRequired
                                ? DISPATCHER_ACTION_REQUIRED_BG
                                : selected
                                  ? "#fff"
                                  : NAVY,
                              border: actionRequired
                                ? "1.5px solid #fff"
                                : `1.5px solid ${NAVY}`,
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
                              if (actionRequired) {
                                el.style.backgroundColor = "#fff";
                                el.style.color = DISPATCHER_ACTION_REQUIRED_BG;
                              } else {
                                el.style.backgroundColor = NAVY;
                                el.style.color = "#fff";
                              }
                            }}
                            onMouseLeave={(e) => {
                              const el = e.currentTarget as HTMLElement;
                              if (actionRequired) {
                                el.style.backgroundColor = selected
                                  ? "#fff"
                                  : "rgba(255,255,255,0.15)";
                                el.style.color = DISPATCHER_ACTION_REQUIRED_BG;
                              } else if (!selected) {
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
      </div>

      <DeliveryDetailDrawer
        deliveryId={selectedDeliveryId}
        onClose={() => setSelectedDeliveryId(null)}
        onDataChanged={() => void fetchAllData()}
        onOpenDelivery={(id) => setSelectedDeliveryId(id)}
      />

      <CreateDeliveryModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={() => void fetchAllData()}
      />
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
