import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CreateDeliveryModal } from "./CreateDeliveryModal";
import { DispatcherPortalTopBar } from "./DispatcherPortalTopBar";
import { firestoreDataService, listTechnicians } from "./dispatcher/firestoreService";
import {
  loadTodayJobReleasedToEntries,
  type ReleasedToEntry,
} from "./dispatcher/technicianReleaseHelpers";
import { resolveTechnicianBadgeStyle } from "./dispatcher/technicianBadgeColors";
import type { Technician } from "./dispatcher/models";
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
  DISPATCHER_STAGING_ACTION_ISSUE_SUMMARY,
  STAGING_PLAN_MISMATCH_LABEL,
  STAGING_PLAN_MISMATCH_TITLE,
  type DeliveryOverviewFilterStatus,
  isCompleteOverviewRow,
} from "./dispatcher/deliveryDisplayHelpers";
import { DeliveryListStagingChips } from "./dispatcher/DeliveryListStagingChips";
import { DeliveryDetailDrawer } from "./dispatcher/drawer/DeliveryDetailDrawer";
import { NAVY } from "./theme/brandColors";

/* ─── Constants ─────────────────────────────────────────────────────────── */

const COMPLETE_FILTER_BADGE_RED = "#bf0a30";

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
  issue: { bg: "#ffebee", text: "#c62828", border: "#ef9a9a", dot: "#ef5350" },
};

/** Yellow badge — shop waiting for vendor delivery (0 received). */
const AWAITING_DELIVERY_BADGE = {
  bg: "#facc15",
  text: "#422006",
  border: "#ca8a04",
  dot: "#eab308",
} as const;

const STATUS_LABEL = (status: DeliveryOverviewFilterStatus): string =>
  DELIVERY_OVERVIEW_FILTER_LABEL[status];

function listStatusBadge(
  row: DeliveryListRow,
): (typeof STATUS_BADGE)[DeliveryOverviewFilterStatus] {
  const label = row.statusDisplayLabel;
  if (label === "Complete") return STATUS_BADGE.complete;
  if (label === "Ready for Pickup") return STATUS_BADGE.ready_for_pickup;
  if (label === "Issue / Review Required") return STATUS_BADGE.issue;
  if (label === "Partial") return STATUS_BADGE.partial;
  if (label === "Reserved") {
    return row.status === "shipped"
      ? STATUS_BADGE.shipped
      : STATUS_BADGE.pending;
  }
  if (label === "Awaiting Delivery" || label === "Awaiting Vendor Delivery") {
    return AWAITING_DELIVERY_BADGE;
  }
  if (label === "Pending Delivery") {
    return AWAITING_DELIVERY_BADGE;
  }
  if (label === "Incomplete") return STATUS_BADGE.partial;
  if (isCompleteOverviewRow(row)) return STATUS_BADGE.complete;
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
  { label: "Released To" },
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
  const [completeOverviewCount, setCompleteOverviewCount] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [jobReleasedToEntries, setJobReleasedToEntries] = useState<
    Map<string, ReleasedToEntry[]>
  >(new Map());
  const [technicians, setTechnicians] = useState<Technician[]>([]);

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
    zonesSnapshot,
  } = useDispatcherPortal();

  const stagingOccupancyReady = zonesSnapshot != null;
  const occupancyByZoneCode = zonesSnapshot?.occupancyByZoneCode ?? {};
  const shopStockByCode = zonesSnapshot?.shopStockByCode ?? {};

  const focusNeedsReview = portalNavFocus(location.search) === "needs-review";

  const hasActiveFilters = query.statuses.length > 0 || !!query.search.trim();

  const techById = useMemo(
    () => new Map(technicians.map((t) => [t.id, t])),
    [technicians],
  );

  const fetchReleaseMap = useCallback(async () => {
    try {
      const techs = await listTechnicians();
      const map = await loadTodayJobReleasedToEntries(techs);
      setTechnicians(techs);
      setJobReleasedToEntries(map);
    } catch {
      setTechnicians([]);
      setJobReleasedToEntries(new Map());
    }
  }, []);

  /* ── Data fetching ── */
  const fetchAllData = useCallback(async () => {
    setListLoading(true);
    try {
      const [pagedResult, completeCountResult] = await Promise.all([
        firestoreDataService.listDeliveries({
          search: query.search,
          statuses: query.statuses.length ? query.statuses : undefined,
          sortBy: query.sortBy,
          sortDirection: query.sortDirection,
          page: query.page,
          pageSize: query.pageSize,
        }),
        firestoreDataService.listDeliveries({
          statuses: ["complete"],
          page: 1,
          pageSize: 1,
        }),
      ]);
      setPaged(pagedResult);
      setCompleteOverviewCount(completeCountResult.totalItems);
      setLastUpdated(new Date().toLocaleString());
      setListError(null);
      await fetchReleaseMap();
    } catch {
      setListError("Could not load deliveries. Please try again.");
    } finally {
      setListLoading(false);
    }
  }, [query, fetchReleaseMap]);

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
        style={{ backgroundColor: "var(--color-bg-primary)" }}
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
          style={{ backgroundColor: "var(--color-bg-primary)" }}
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

          {/* ── Search / Filter card ── */}
          <div
            style={{
              backgroundColor: "var(--color-panel-bg)",
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
                      color: "var(--color-panel-text)",
                      outline: "none",
                      backgroundColor: "var(--color-panel-bg)",
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
                    const showCompleteBadge =
                      status === "complete" && completeOverviewCount > 0;
                    const chipButton = (
                      <button
                        type="button"
                        onClick={() => toggleStatus(status)}
                        style={{
                          padding: showCompleteBadge
                            ? "4px 22px 4px 10px"
                            : "4px 10px",
                          borderRadius: 4,
                          fontSize: 12,
                          fontWeight: 700,
                          letterSpacing: "normal",
                          boxSizing: "border-box",
                          border: `2px solid ${active ? b.border : "#ccd0d7"}`,
                          backgroundColor: active ? b.bg : "#f9fafb",
                          color: active ? b.text : "#6b7280",
                          cursor: "pointer",
                          transition:
                            "background-color 0.12s, color 0.12s, border-color 0.12s",
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
                    if (status === "complete") {
                      return (
                        <div
                          key={status}
                          style={{
                            position: "relative",
                            display: "inline-flex",
                          }}
                        >
                          {chipButton}
                          {showCompleteBadge ? (
                            <span
                              data-testid="deliveries-complete-filter-badge"
                              aria-label={`${completeOverviewCount} complete deliver${completeOverviewCount === 1 ? "y" : "ies"}`}
                              style={{
                                position: "absolute",
                                top: -6,
                                right: -4,
                                minWidth: 18,
                                height: 18,
                                padding: "0 4px",
                                borderRadius: 999,
                                backgroundColor: COMPLETE_FILTER_BADGE_RED,
                                color: "#fff",
                                fontSize: 11,
                                fontWeight: 800,
                                lineHeight: "18px",
                                textAlign: "center",
                                fontFamily: FONT,
                                pointerEvents: "none",
                              }}
                            >
                              {completeOverviewCount}
                            </span>
                          ) : null}
                        </div>
                      );
                    }
                    return (
                      <span key={status} style={{ display: "inline-flex" }}>
                        {chipButton}
                      </span>
                    );
                  })}
                  <button
                    type="button"
                    disabled={!hasActiveFilters}
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
                      fontWeight: 700,
                      letterSpacing: "normal",
                      boxSizing: "border-box",
                      border: "2px solid #ccd0d7",
                      backgroundColor: "var(--color-panel-bg)",
                      color: hasActiveFilters ? "#ef4444" : "#d1d5db",
                      cursor: hasActiveFilters ? "pointer" : "default",
                      outline: "none",
                      fontFamily: FONT,
                      opacity: hasActiveFilters ? 1 : 0.55,
                    }}
                  >
                    ✕ Clear
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ── Table card ── */}
          <div
            id="portal-deliveries"
            style={{
              backgroundColor: "var(--color-panel-bg)",
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
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <span style={{ fontWeight: 700, fontSize: 15, color: NAVY }}>
                  Deliveries
                </span>
                {!listLoading && (
                  <span
                    style={{
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
                <div
                  data-testid="deliveries-staging-legend"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 12,
                    marginLeft: 4,
                  }}
                >
                  {(
                    [
                      {
                        swatch: "#facc15",
                        label: "Assigned / planned (yellow)",
                      },
                      { swatch: "#7c3aed", label: "Ready for pickup" },
                      { swatch: "#6b7280", label: "Shop stock" },
                    ] as const
                  ).map(({ swatch, label }) => (
                    <span
                      key={label}
                      data-testid={`deliveries-legend-${label}`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        fontSize: 11,
                        color: "#4b5563",
                        fontWeight: 600,
                      }}
                    >
                      <span
                        aria-hidden
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 2,
                          backgroundColor: swatch,
                          border: "1px solid rgba(0,0,0,0.12)",
                          flexShrink: 0,
                        }}
                      />
                      {label}
                    </span>
                  ))}
                </div>
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
                    const b = listStatusBadge(row);
                    const defaultRowBg = idx % 2 === 0 ? "var(--color-panel-bg)" : "var(--color-bg-surface)";
                    const rowBg = selected ? "#eef4ff" : defaultRowBg;
                    const cellMuted = "#666";
                    const cellStrong = "#111";
                    const cellBody = "#333";
                    const calmIssueSummary =
                      row.issueSummary === "Pickup Scheduled" ||
                      row.issueSummary === "Will-Call Pickup" ||
                      row.issueSummary.startsWith("Delivered to ");
                    const issueSummaryColor = calmIssueSummary
                      ? NAVY
                      : row.issueSummary.startsWith("Confirm delivery") ||
                          row.issueSummary === "Confirm site delivery"
                        ? "#c62828"
                        : row.issueSummary
                          ? "#c62828"
                          : "#9ca3af";
                    const cellBorder = "1px solid #eaecf0";
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
                          backgroundColor: rowBg,
                          cursor: "pointer",
                          outline: "none",
                          borderLeft: selected
                            ? `3px solid ${NAVY}`
                            : "3px solid transparent",
                          transition: "background-color 0.1s",
                        }}
                        onMouseEnter={(e) => {
                          if (!selected) {
                            (
                              e.currentTarget as HTMLElement
                            ).style.backgroundColor = "#f5f8ff";
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!selected) {
                            (
                              e.currentTarget as HTMLElement
                            ).style.backgroundColor = defaultRowBg;
                          }
                        }}
                        onFocus={(e) => {
                          (
                            e.currentTarget as HTMLElement
                          ).style.backgroundColor = selected
                            ? "#eef4ff"
                            : "var(--color-bg-surface)";
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
                            borderBottom: cellBorder,
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
                            borderBottom: cellBorder,
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
                            borderBottom: cellBorder,
                            fontWeight: 600,
                            color: cellStrong,
                          }}
                        >
                          {row.jobName}
                        </td>
                        <td
                          style={{
                            padding: "14px 12px",
                            borderBottom: cellBorder,
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
                            borderBottom: cellBorder,
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
                            borderBottom: cellBorder,
                            color: cellBody,
                          }}
                        >
                          {row.vendorName}
                        </td>
                        <td
                          style={{
                            padding: "14px 12px",
                            borderBottom: cellBorder,
                            color: cellBody,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {row.deliveryDate}
                        </td>
                        <td
                          style={{
                            padding: "14px 12px",
                            borderBottom: cellBorder,
                            maxWidth: 180,
                            verticalAlign: "middle",
                          }}
                        >
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              flexWrap: "wrap",
                            }}
                          >
                            <DeliveryListStagingChips
                              codes={row.stagingLocationCodes}
                              occupancyByZoneCode={occupancyByZoneCode}
                              shopStockByCode={shopStockByCode}
                              occupancyReady={stagingOccupancyReady}
                              deliveryId={row.deliveryId}
                              stagingNotApplicable={
                                row.stagingLocationListNotApplicable === true
                              }
                            />
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
                        </td>
                        <td
                          style={{
                            padding: "14px 12px",
                            borderBottom: cellBorder,
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
                            borderBottom: cellBorder,
                            color: issueSummaryColor,
                            maxWidth: 200,
                          }}
                        >
                          {row.missingStagingAssignment && (
                            <span
                              data-testid={`staging-assignment-pill-${row.deliveryId}`}
                              style={{
                                display: "inline-block",
                                marginBottom:
                                  row.issueSummary || row.openIssueCount > 0
                                    ? 6
                                    : 0,
                                padding: "2px 8px",
                                borderRadius: 999,
                                backgroundColor: "#c62828",
                                color: "#fff",
                                fontSize: 11,
                                fontWeight: 700,
                              }}
                            >
                              {DISPATCHER_STAGING_ACTION_ISSUE_SUMMARY}
                            </span>
                          )}
                          {row.openIssueCount > 0 && !calmIssueSummary && (
                            <span
                              data-testid={`open-issue-badge-${row.deliveryId}`}
                              style={{
                                display: "inline-block",
                                marginBottom: row.issueSummary ? 6 : 0,
                                padding: "2px 8px",
                                borderRadius: 999,
                                backgroundColor: "#ffebee",
                                color: "#c62828",
                                fontSize: 11,
                                fontWeight: 700,
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
                              {!calmIssueSummary ? (
                                <span style={{ flexShrink: 0, marginTop: 1 }}>
                                  ⚠
                                </span>
                              ) : null}
                              {row.issueSummary}
                            </span>
                          ) : row.openIssueCount > 0 || row.missingStagingAssignment ? null : (
                            "—"
                          )}
                        </td>
                        <td
                          data-testid={`released-to-${row.deliveryId}`}
                          style={{
                            padding: "14px 12px",
                            borderBottom: cellBorder,
                          }}
                        >
                          {(() => {
                            const entries =
                              jobReleasedToEntries.get(row.jobId) ?? [];
                            if (entries.length === 0) {
                              return (
                                <span style={{ color: "#9ca3af" }}>—</span>
                              );
                            }
                            return (
                              <span
                                style={{
                                  display: "inline-flex",
                                  flexWrap: "wrap",
                                  gap: 4,
                                  alignItems: "center",
                                  maxWidth: 200,
                                }}
                              >
                                {entries.map((entry) => {
                                  const tech = techById.get(entry.technicianId);
                                  const badgeStyle = resolveTechnicianBadgeStyle(
                                    tech ?? { id: entry.technicianId },
                                  );
                                  return (
                                    <span
                                      key={entry.technicianId}
                                      data-testid={`released-to-badge-${row.deliveryId}-${entry.technicianId}`}
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        padding: "3px 10px",
                                        borderRadius: 999,
                                        fontSize: 12,
                                        fontWeight: 700,
                                        whiteSpace: "nowrap",
                                        maxWidth: 160,
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        backgroundColor: badgeStyle.bg,
                                        color: badgeStyle.text,
                                        border: `1px solid ${badgeStyle.border}`,
                                      }}
                                      title={entry.name}
                                    >
                                      {entry.name}
                                    </span>
                                  );
                                })}
                              </span>
                            );
                          })()}
                        </td>
                        <td
                          style={{
                            padding: "14px 12px",
                            borderBottom: cellBorder,
                            textAlign: "right",
                          }}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void selectDelivery(row.deliveryId);
                            }}
                            style={{
                              backgroundColor: selected ? NAVY : "var(--color-panel-bg)",
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
                                el.style.backgroundColor = "var(--color-panel-bg)";
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
                            color: "var(--color-panel-text)",
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
                              backgroundColor: "var(--color-panel-bg)",
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
                backgroundColor: "var(--color-bg-surface)",
              }}
            >
              <span style={{ fontSize: 13, color: "#6b7280" }}>
                Showing{" "}
                <strong style={{ color: "var(--color-panel-text)" }}>{paged.items.length}</strong>{" "}
                of <strong style={{ color: "var(--color-panel-text)" }}>{paged.totalItems}</strong>{" "}
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
        backgroundColor: active ? navy : "var(--color-panel-bg)",
        color: active ? "#fff" : disabled ? "var(--color-panel-muted)" : "var(--color-panel-text)",
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
