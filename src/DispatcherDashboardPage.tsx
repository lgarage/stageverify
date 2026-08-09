import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CreateDeliveryModal } from "./CreateDeliveryModal";
import { DispatcherPortalTopBar } from "./DispatcherPortalTopBar";
import { firestoreDataService, listTechnicians } from "./dispatcher/firestoreService";
import {
  loadTodayJobReleasedToEntries,
  type ReleasedToEntry,
  unassignJobFromTechniciansForToday,
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
import { PortalShell } from "./PortalShell";
import { PortalSidebar } from "./PortalSidebar";
import {
  PORTAL_MAIN_CLASS,
  PORTAL_SCROLL_CLASS,
} from "./dispatcherPortalLayout";
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
  UNPLANNED_BADGE,
  WILL_CALL_PICKUP_BADGE,
} from "./dispatcher/deliveryDisplayHelpers";
import {
  AWAITING_DELIVERY_STATUS_LABEL,
  UNPLANNED_STATUS_LABEL,
  WILL_CALL_PICKUP_STATUS_LABEL,
} from "./dispatcher/jobReadinessDisplay";
import { DeliveryListStagingChips } from "./dispatcher/DeliveryListStagingChips";
import { DeliveryDetailDrawer } from "./dispatcher/drawer/DeliveryDetailDrawer";

/* ─── Constants ─────────────────────────────────────────────────────────── */

const NAVY = "#0a3161";
const COMPLETE_FILTER_BADGE_RED = "#bf0a30";

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

const STATUS_ORDER: DeliveryOverviewFilterStatus[] =
  DELIVERY_OVERVIEW_STATUS_ORDER;

const STATUS_BADGE: Record<
  DeliveryOverviewFilterStatus,
  { bg: string; text: string; border: string; dot: string }
> = {
  pending: {
    bg: "var(--admin-surface-2)",
    text: "var(--admin-text)",
    border: "var(--admin-border)",
    dot: "var(--admin-text-muted)",
  },
  shipped: {
    bg: "var(--admin-info-bg)",
    text: "var(--admin-info-text)",
    border: "var(--admin-info-border)",
    dot: "#1976d2",
  },
  arrived: {
    bg: "var(--admin-info-bg)",
    text: "var(--admin-info-text)",
    border: "var(--admin-info-border)",
    dot: "#42a5f5",
  },
  partial: {
    bg: "var(--admin-purple-bg)",
    text: "var(--admin-purple-text)",
    border: "var(--admin-purple-border)",
    dot: "#ab47bc",
  },
  ready_for_pickup: {
    bg: "var(--admin-success-bg)",
    text: "var(--admin-success-text)",
    border: "var(--admin-success-border)",
    dot: "#66bb6a",
  },
  complete: {
    bg: "var(--admin-success-bg)",
    text: "var(--admin-success-text)",
    border: "var(--admin-success-border)",
    dot: "#66bb6a",
  },
  issue: { bg: "var(--admin-danger-bg)", text: "var(--admin-danger-text)", border: "var(--admin-danger-border)", dot: "#ef5350" },
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

type ListStatusBadgeStyle =
  | (typeof STATUS_BADGE)[DeliveryOverviewFilterStatus]
  | typeof UNPLANNED_BADGE
  | typeof WILL_CALL_PICKUP_BADGE;

function listStatusBadge(row: DeliveryListRow): ListStatusBadgeStyle {
  const label = row.statusDisplayLabel;
  if (label === UNPLANNED_STATUS_LABEL || label === "Unplanned") {
    return UNPLANNED_BADGE;
  }
  if (
    label === WILL_CALL_PICKUP_STATUS_LABEL ||
    row.stagingLocationListNotApplicable === true
  ) {
    return WILL_CALL_PICKUP_BADGE;
  }
  if (label === "Picked Up") return STATUS_BADGE.complete;
  if (label === "Staged — Ready for Pickup") return STATUS_BADGE.ready_for_pickup;
  if (label === "Issue / Review Required") return STATUS_BADGE.issue;
  if (label === "Partial") return STATUS_BADGE.partial;
  if (label === "Reserved") {
    return row.status === "shipped"
      ? STATUS_BADGE.shipped
      : STATUS_BADGE.pending;
  }
  if (
    label === AWAITING_DELIVERY_STATUS_LABEL ||
    label === "Awaiting Delivery" ||
    label === "Awaiting Vendor Delivery" ||
    label === "Pending Delivery"
  ) {
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
  minWidth?: number;
}> = [
  { label: "Status", key: "status", minWidth: 150 },
  {
    label: "Fulfillment",
    key: "fulfillmentDisplayLabel",
    minWidth: 190,
  },
  { label: "Vendor", key: "vendorName", minWidth: 150 },
  { label: "Job Name", key: "jobName", minWidth: 180 },
  { label: "Invoice #", key: "vendorInvoiceNumber", minWidth: 120 },
  { label: "PO #", key: "poNumber", minWidth: 110 },
  {
    label: "Staging Location",
    key: "stagingLocationCode",
    minWidth: 150,
  },
  { label: "Items", key: "itemsReceivedLabel", minWidth: 70 },
  {
    label: "Delivery / Pickup Date",
    key: "deliveryDate",
    minWidth: 150,
  },
  { label: "Issue", key: "issueSummary", minWidth: 220 },
  { label: "Assigned Technician", minWidth: 180 },
  { label: "Action", className: "text-right", minWidth: 80 },
];

type ListQueryState = {
  search: string;
  statuses: DeliveryOverviewFilterStatus[];
  unplannedOnly: boolean;
  willCallOnly: boolean;
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
    unplannedOnly: false,
    willCallOnly: false,
    sortBy: "deliveryDate",
    sortDirection: "desc",
    page: 1,
    pageSize: 20,
  });
  const [paged, setPaged] =
    useState<PagedResult<DeliveryListRow>>(INITIAL_PAGED);
  const [completeOverviewCount, setCompleteOverviewCount] = useState(0);
  const [willCallOverviewCount, setWillCallOverviewCount] = useState(0);
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

  const hasActiveFilters =
    query.statuses.length > 0 ||
    !!query.search.trim() ||
    query.unplannedOnly ||
    query.willCallOnly;

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

  const handleUnassignJobFromTable = useCallback(
    async (jobId: string, technicianIds: string[]) => {
      if (technicianIds.length === 0) return;
      await unassignJobFromTechniciansForToday(jobId, technicianIds);
      await fetchReleaseMap();
    },
    [fetchReleaseMap],
  );

  /* ── Data fetching ── */
  const fetchAllData = useCallback(async () => {
    setListLoading(true);
    try {
      const [pagedResult, completeCountResult, willCallCountResult] =
        await Promise.all([
          firestoreDataService.listDeliveries({
            search: query.search,
            statuses: query.statuses.length ? query.statuses : undefined,
            unplannedOnly: query.unplannedOnly || undefined,
            willCallOnly: query.willCallOnly || undefined,
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
          firestoreDataService.listDeliveries({
            willCallOnly: true,
            page: 1,
            pageSize: 1,
          }),
        ]);
      setPaged(pagedResult);
      setCompleteOverviewCount(completeCountResult.totalItems);
      setWillCallOverviewCount(willCallCountResult.totalItems);
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
    <PortalShell style={{ fontFamily: FONT }}>
      <PortalSidebar />

      {/* ── Main Content ─────────────────────────────────────────── */}
      <div
        className={PORTAL_MAIN_CLASS}
        style={{ backgroundColor: "var(--admin-bg)" }}
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
          style={{ backgroundColor: "var(--admin-bg)" }}
        >
        <div
          style={{
            padding: "30px",
            display: "flex",
            flexDirection: "column",
            gap: 24,
            width: "100%",
            maxWidth: 1440,
            margin: "0 auto",
          }}
        >
          {/* ── Page header ── */}
          <div>
            <h1
              data-testid="dispatcher-page-heading"
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: "var(--admin-accent-soft)",
                margin: 0,
                lineHeight: "1.2",
              }}
            >
              Delivery Overview
            </h1>
            <p style={{ fontSize: 13, color: "var(--admin-text-muted)", marginTop: 4 }}>
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
          <div className="admin-section">
            <div
              className="admin-card"
              style={{
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
                    color: "var(--admin-text-muted)",
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
                    stroke="var(--admin-text-muted)"
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
                    className="admin-control"
                    value={query.search}
                    onChange={(e) =>
                      setQuery((prev) => ({
                        ...prev,
                        page: 1,
                        search: e.target.value,
                      }))
                    }
                    placeholder="Job #, name, PO, invoice, order, vendor, staging location…"
                    style={{
                      width: "100%",
                      padding: "12px 14px 12px 40px",
                      border: "1.5px solid var(--admin-border)",
                      borderRadius: "var(--admin-control-radius)",
                      fontSize: 16,
                      color: "var(--admin-text)",
                      outline: "none",
                      backgroundColor: "var(--admin-surface)",
                      fontFamily: FONT,
                      transition: "border-color 0.15s, box-shadow 0.15s",
                    }}
                    onFocus={(e) => {
                      e.target.style.borderColor = NAVY;
                      e.target.style.boxShadow = `0 0 0 2px ${NAVY}20`;
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = "var(--admin-border)";
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
                    color: "var(--admin-text-muted)",
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
                        className="admin-chip"
                        data-testid={`deliveries-status-filter-${status}`}
                        onClick={() => toggleStatus(status)}
                        style={{
                          padding: showCompleteBadge
                            ? "4px 22px 4px 10px"
                            : "4px 10px",
                          borderRadius: "var(--admin-radius-pill)",
                          fontSize: 12,
                          fontWeight: 700,
                          letterSpacing: "normal",
                          boxSizing: "border-box",
                          border: `2px solid ${active ? b.border : "var(--admin-border)"}`,
                          backgroundColor: active ? b.bg : "var(--admin-surface-2)",
                          color: active ? b.text : "var(--admin-text-label)",
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
                            backgroundColor: active ? b.dot : "var(--admin-border)",
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
                                color: "var(--admin-on-navy)",
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
                  <div
                    style={{
                      position: "relative",
                      display: "inline-flex",
                    }}
                  >
                    <button
                      type="button"
                      className="admin-chip"
                      data-testid="deliveries-will-call-filter"
                      onClick={() =>
                        setQuery((prev) => ({
                          ...prev,
                          page: 1,
                          willCallOnly: !prev.willCallOnly,
                        }))
                      }
                      style={{
                        padding:
                          willCallOverviewCount > 0
                            ? "4px 22px 4px 10px"
                            : "4px 10px",
                        borderRadius: "var(--admin-radius-pill)",
                        fontSize: 12,
                        fontWeight: 700,
                        letterSpacing: "normal",
                        boxSizing: "border-box",
                        border: `2px solid ${
                          query.willCallOnly
                            ? WILL_CALL_PICKUP_BADGE.border
                            : "var(--admin-border)"
                        }`,
                        backgroundColor: query.willCallOnly
                          ? WILL_CALL_PICKUP_BADGE.bg
                          : "var(--admin-surface-2)",
                        color: query.willCallOnly
                          ? WILL_CALL_PICKUP_BADGE.text
                          : "var(--admin-text-label)",
                        cursor: "pointer",
                        fontFamily: FONT,
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          backgroundColor: query.willCallOnly
                            ? WILL_CALL_PICKUP_BADGE.dot
                            : "var(--admin-border)",
                          flexShrink: 0,
                        }}
                      />
                      {WILL_CALL_PICKUP_STATUS_LABEL}
                    </button>
                    {willCallOverviewCount > 0 ? (
                      <span
                        data-testid="deliveries-will-call-filter-badge"
                        aria-label={`${willCallOverviewCount} Will-Call / Pickup deliver${willCallOverviewCount === 1 ? "y" : "ies"}`}
                        style={{
                          position: "absolute",
                          top: -6,
                          right: -4,
                          minWidth: 18,
                          height: 18,
                          padding: "0 4px",
                          borderRadius: 999,
                          backgroundColor: COMPLETE_FILTER_BADGE_RED,
                          color: "var(--admin-on-navy)",
                          fontSize: 11,
                          fontWeight: 800,
                          lineHeight: "18px",
                          textAlign: "center",
                          fontFamily: FONT,
                          pointerEvents: "none",
                        }}
                      >
                        {willCallOverviewCount}
                      </span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="admin-chip"
                    data-testid="deliveries-unplanned-filter"
                    onClick={() =>
                      setQuery((prev) => ({
                        ...prev,
                        page: 1,
                        unplannedOnly: !prev.unplannedOnly,
                      }))
                    }
                    style={{
                      padding: "4px 10px",
                      borderRadius: "var(--admin-radius-pill)",
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: "normal",
                      boxSizing: "border-box",
                      border: `2px solid ${
                        query.unplannedOnly
                          ? UNPLANNED_BADGE.border
                          : "var(--admin-border)"
                      }`,
                      backgroundColor: query.unplannedOnly
                        ? UNPLANNED_BADGE.bg
                        : "var(--admin-surface-2)",
                      color: query.unplannedOnly
                        ? UNPLANNED_BADGE.text
                        : "var(--admin-text-label)",
                      cursor: "pointer",
                      fontFamily: FONT,
                    }}
                  >
                    Unplanned
                  </button>
                  <button
                    type="button"
                    className="admin-chip"
                    disabled={!hasActiveFilters}
                    onClick={() =>
                      setQuery((prev) => ({
                        ...prev,
                        search: "",
                        statuses: [],
                        unplannedOnly: false,
                        willCallOnly: false,
                        page: 1,
                      }))
                    }
                    style={{
                      marginLeft: 2,
                      padding: "4px 10px",
                      borderRadius: "var(--admin-radius-pill)",
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: "normal",
                      boxSizing: "border-box",
                      border: "2px solid var(--admin-border)",
                      backgroundColor: "var(--admin-surface)",
                      color: hasActiveFilters ? "#ef4444" : "var(--admin-border)",
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
          </div>

          {/* ── Table card ── */}
          <div className="admin-section">
            <div
              id="portal-deliveries"
              className="admin-table-wrap"
              style={{
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
                borderBottom: "1px solid var(--admin-border)",
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
                <span style={{ fontWeight: 700, fontSize: 15, color: "var(--admin-accent-soft)" }}>
                  Deliveries
                </span>
                {!listLoading && (
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--admin-text-muted)",
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
                        testId: "assigned-planned",
                        swatch: AWAITING_DELIVERY_BADGE.bg,
                        label: "Assigned / Planned",
                      },
                      {
                        testId: "staged-ready-for-pickup",
                        swatch: "#66bb6a",
                        label: "Staged — Ready for Pickup",
                      },
                      {
                        testId: "will-call-pickup",
                        swatch: "var(--admin-willcall-bg)",
                        label: WILL_CALL_PICKUP_STATUS_LABEL,
                      },
                      {
                        testId: "unplanned",
                        swatch: UNPLANNED_BADGE.bg,
                        label: "Unplanned",
                      },
                      {
                        testId: "shop-stock",
                        swatch: "#6b7280",
                        label: "Shop Stock",
                      },
                    ] as const
                  ).map(({ testId, swatch, label }) => (
                    <span
                      key={testId}
                      data-testid={`deliveries-legend-${testId}`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        fontSize: 11,
                        color: "var(--admin-text-label)",
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
                  <span style={{ fontSize: 12, color: "var(--admin-text-muted)" }}>
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
                className="admin-table"
                style={{
                  minWidth: 1750,
                  fontSize: 14,
                  fontFamily: FONT,
                }}
              >
                <thead>
                  <tr data-testid="dispatcher-deliveries-table-header">
                    {SORT_COLUMNS.map((col) => {
                      const isSorted = col.key && query.sortBy === col.key;
                      return (
                        <th
                          key={col.label}
                          style={{
                            fontWeight: 700,
                            fontSize: 12,
                            color: "var(--admin-table-header-text)",
                            textAlign: col.className?.includes("text-right")
                              ? "right"
                              : "left",
                            whiteSpace: "nowrap",
                            letterSpacing: "normal",
                            userSelect: "none",
                            minWidth: col.minWidth,
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
                    const defaultRowBg = idx % 2 === 0 ? "var(--admin-row-even)" : "var(--admin-row-odd)";
                    const rowBg = selected ? "var(--admin-row-selected)" : defaultRowBg;
                    const cellMuted = "var(--admin-text-data)";
                    const cellStrong = "var(--admin-text-data)";
                    const cellBody = "var(--admin-text-data)";
                    const issueSummaryColor = row.issueSummary
                      ? "var(--admin-danger-text)"
                      : "var(--admin-text-muted)";
                    const cellBorder = "1px solid var(--admin-border)";
                    return (
                      <tr
                        key={row.deliveryId}
                        data-testid={`dispatcher-delivery-row-${row.deliveryId}`}
                        data-order-number={row.orderNumber}
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
                            ).style.backgroundColor = "var(--admin-row-hover)";
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
                            ? "var(--admin-row-selected)"
                            : "var(--admin-row-hover)";
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
                            className="admin-chip"
                            data-testid={`delivery-status-chip-${row.deliveryId}`}
                            style={{
                              gap: 5,
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
                          {row.creditReturnLinked ? (
                            <span
                              className="admin-chip"
                              data-testid={`delivery-list-credit-return-badge-${row.deliveryId}`}
                              title="Credit/return — do not stage or pickup"
                              style={{
                                display: "inline-flex",
                                marginTop: 4,
                                fontSize: 10,
                                fontWeight: 700,
                                color: "var(--admin-danger-text)",
                                backgroundColor: "var(--admin-danger-bg)",
                                border: "1px solid var(--admin-danger-border)",
                                whiteSpace: "nowrap",
                              }}
                            >
                              Credit/Return
                            </span>
                          ) : null}
                        </td>
                        <td
                          style={{
                            padding: "14px 12px",
                            borderBottom: cellBorder,
                            fontWeight: 600,
                            color: cellBody,
                            minWidth: 190,
                          }}
                        >
                          {row.fulfillmentDisplayLabel}
                        </td>
                        <td
                          style={{
                            padding: "14px 12px",
                            borderBottom: cellBorder,
                            color: cellBody,
                            minWidth: 150,
                          }}
                        >
                          {row.vendorName}
                        </td>
                        <td
                          style={{
                            padding: "14px 12px",
                            borderBottom: cellBorder,
                            fontWeight: 600,
                            color: cellStrong,
                            minWidth: 180,
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
                          {row.vendorInvoiceNumber ?? "—"}
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
                              needsStagingAssignment={
                                row.missingStagingAssignment === true
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
                                  backgroundColor: "var(--admin-warning-bg)",
                                  color: "var(--admin-warning-text)",
                                  fontSize: 10,
                                  fontWeight: 800,
                                  letterSpacing: "0.04em",
                                  textTransform: "uppercase",
                                  border: "1px solid var(--admin-warning-border)",
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
                                backgroundColor: "var(--admin-danger-bg)",
                                color: "var(--admin-danger-text)",
                                border: "1px solid var(--admin-danger-border)",
                                fontSize: 11,
                                fontWeight: 700,
                              }}
                            >
                              {DISPATCHER_STAGING_ACTION_ISSUE_SUMMARY}
                            </span>
                          )}
                          {row.openIssueCount > 0 && (
                            <span
                              data-testid={`open-issue-badge-${row.deliveryId}`}
                              style={{
                                display: "inline-block",
                                marginBottom: row.issueSummary ? 6 : 0,
                                padding: "2px 8px",
                                borderRadius: 999,
                                backgroundColor: "var(--admin-danger-bg)",
                                color: "var(--admin-danger-text)",
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
                              <span style={{ flexShrink: 0, marginTop: 1 }}>
                                ⚠
                              </span>
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
                                <span style={{ color: "var(--admin-text-muted)" }}>—</span>
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
                                <button
                                  type="button"
                                  data-testid={`released-to-unassign-${row.deliveryId}`}
                                  title="Unassign from technician"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const techIds = entries.map(
                                      (entry) => entry.technicianId,
                                    );
                                    void handleUnassignJobFromTable(
                                      row.jobId,
                                      techIds,
                                    );
                                  }}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    width: 22,
                                    height: 22,
                                    padding: 0,
                                    borderRadius: 999,
                                    border: "1px solid var(--admin-border)",
                                    backgroundColor: "var(--admin-surface)",
                                    color: "var(--admin-text-muted)",
                                    fontSize: 14,
                                    fontWeight: 700,
                                    lineHeight: 1,
                                    cursor: "pointer",
                                    fontFamily: FONT,
                                    flexShrink: 0,
                                  }}
                                >
                                  ×
                                </button>
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
                            data-testid="dispatcher-delivery-view"
                            className="admin-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              void selectDelivery(row.deliveryId);
                            }}
                            style={{
                              backgroundColor: selected ? NAVY : "var(--admin-surface)",
                              color: selected
                                ? "var(--admin-on-navy)"
                                : "var(--admin-accent-soft)",
                              border: selected
                                ? `1.5px solid ${NAVY}`
                                : "1.5px solid var(--admin-accent-soft)",
                              borderRadius: "var(--admin-control-radius)",
                              padding: "0 14px",
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
                              el.style.color = "var(--admin-on-navy)";
                              el.style.borderColor = NAVY;
                            }}
                            onMouseLeave={(e) => {
                              const el = e.currentTarget as HTMLElement;
                              if (!selected) {
                                el.style.backgroundColor = "var(--admin-surface)";
                                el.style.color = "var(--admin-accent-soft)";
                                el.style.borderColor = "var(--admin-accent-soft)";
                              } else {
                                el.style.backgroundColor = NAVY;
                                el.style.color = "var(--admin-on-navy)";
                                el.style.borderColor = NAVY;
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
                        colSpan={12}
                        style={{ padding: "60px 24px", textAlign: "center" }}
                      >
                        <div
                          style={{
                            color: "var(--admin-text-muted)",
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
                            color: "var(--admin-text)",
                            margin: 0,
                          }}
                        >
                          No deliveries found
                        </p>
                        <p
                          style={{
                            fontSize: 13,
                            color: "var(--admin-text-muted)",
                            marginTop: 6,
                          }}
                        >
                          Try adjusting your search or status filters.
                        </p>
                        {hasActiveFilters && (
                          <button
                            className="admin-btn"
                            onClick={() =>
                              setQuery((prev) => ({
                                ...prev,
                                search: "",
                                statuses: [],
                                unplannedOnly: false,
                                willCallOnly: false,
                                page: 1,
                              }))
                            }
                            style={{
                              marginTop: 16,
                              padding: "8px 18px",
                              borderRadius: "var(--admin-control-radius)",
                              border: `1.5px solid ${NAVY}`,
                              backgroundColor: "var(--admin-surface)",
                              color: "var(--admin-accent-soft)",
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
                borderTop: "1px solid var(--admin-border)",
                backgroundColor: "var(--admin-surface-2)",
              }}
            >
              <span style={{ fontSize: 13, color: "var(--admin-text-muted)" }}>
                Showing{" "}
                <strong style={{ color: "var(--admin-text)" }}>{paged.items.length}</strong>{" "}
                of <strong style={{ color: "var(--admin-text)" }}>{paged.totalItems}</strong>{" "}
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
    </PortalShell>
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
      className="admin-btn"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "5px 10px",
        borderRadius: "var(--admin-control-radius)",
        border: active ? `2px solid ${navy}` : "1px solid var(--admin-border)",
        backgroundColor: active ? navy : "var(--admin-surface)",
        color: active ? "var(--admin-text)" : disabled ? "var(--admin-text-muted)" : "var(--admin-text)",
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
