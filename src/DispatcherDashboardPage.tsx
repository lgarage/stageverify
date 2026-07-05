import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { buildEslTagQrUrl } from "./receiveQrUrls";
import {
  buildPickupTokenUrl,
  clearPickupTokenForJob,
  readPickupTokenForJob,
  storePickupTokenForJob,
} from "./pickupTokenSession";
import { validatePickupTokenClient } from "./validatePickupTokenClient";
import { EslQrCode } from "./EslQrCode";
import { CreateDeliveryModal } from "./CreateDeliveryModal";
import { NeedMoreSpaceButton } from "./NeedMoreSpaceButton";
import { DispatcherPortalTopBar } from "./DispatcherPortalTopBar";
import {
  firestoreDataService,
  getVendorInvoiceImport,
  markDeliveryShipped,
  mapOccupancyByLocationId,
  resolveMaterialIssue,
  sendVendorEmail,
  listShopStockMappings,
  type StagingLocationOccupant,
} from "./dispatcher/firestoreService";
import { useDispatcherPortal } from "./dispatcher/DispatcherPortalContext";
import { isStagingLocationOccupiedError } from "./dispatcher/stagingOccupancy";
import { isShopStockLocationReservedError } from "./dispatcher/shopStockMapping";
import {
  formatShopStockPickListForEditor,
  parseShopStockPickListLines,
} from "./dispatcher/shopStockPickList";
import {
  buildShopStockLinesFromPickList,
  formatMappingLocationHeader,
  shopStockLocationNoteFromLines,
} from "./dispatcher/shopStockMapping";
import {
  DELIVERY_STATUS_LABEL,
  DISPATCHER_REVERT_TARGETS,
  VALID_TRANSITIONS,
  type DeliveryDetails,
  type DeliveryListRow,
  type DeliveryOrder,
  type DeliverySortField,
  type DeliveryStatus,
  type Item,
  type PickupEvent,
  type PagedResult,
  type SortDirection,
  type StagingLocation,
} from "./dispatcher";
import { getAllStagingLocationIds, ISSUE_RESOLUTION_TYPE_LABEL, MATERIAL_ISSUE_TYPE_LABEL, type IssueResolutionType, type MaterialIssue, type ShopStockLocationMapping, type VendorInvoiceImportReview } from "./dispatcher/models";
import {
  PORTAL_SHELL_CLASS,
  PORTAL_MAIN_CLASS,
  PORTAL_SCROLL_CLASS,
} from "./dispatcherPortalLayout";
import { PortalSidebar } from "./PortalSidebar";
import { NeedsReviewEmailStrip } from "./dispatcher/email/NeedsReviewEmailStrip";
import { ReadinessEvidencePanel } from "./dispatcher/email/ReadinessEvidencePanel";
import { DrawerActionBanner } from "./dispatcher/drawer/DrawerActionBanner";
import { StagingLocationBanner } from "./dispatcher/drawer/StagingLocationBanner";
import { IssueSummaryPanel } from "./dispatcher/drawer/IssueSummaryPanel";
import { shouldShowPickupSummaryPanel, selectTopActivityHistoryEvents, filterCompactActivityHistory, sortActivityHistoryNewestFirst, formatActivityHistoryHeadline, formatActivityHistoryMeta, deliveryHasCopyPickupIdentifyingInfo, buildPickupInformationClipboardText, effectiveItemQtyReceived } from "./dispatcher/deliveryDisplayHelpers";
import { isInvoiceShellNoShopStaging, resolveDeliveryPoNumber } from "./dispatcher/invoice/invoiceShellDisplayHelpers";
import { InvoiceParsedInspectModal } from "./dispatcher/invoice/InvoiceParsedInspectModal";
import {
  buildNeedMoreInfoEmailBody,
  buildNeedMoreInfoEmailSubject,
} from "./dispatcher/drawer/needMoreInfoDraft";
import { ResolveIssueModal } from "./dispatcher/drawer/ResolveIssueModal";
import { VendorCommunicationsPanel } from "./dispatcher/drawer/VendorCommunicationsPanel";
import {
  buildSuggestedResolutionNote,
  defaultResolutionTypeForIssue,
} from "./dispatcher/drawer/resolveIssueDefaults";

/* ─── Constants ─────────────────────────────────────────────────────────── */

const NAVY = "#0a3161";
/** Dark orange — dispatcher table rows needing staging assignment. */
const DISPATCHER_ACTION_REQUIRED_BG = "#c2410c";
const DISPATCHER_ACTION_REQUIRED_HOVER = "#b45309";
const DISPATCHER_ACTION_REQUIRED_SELECTED = "#9a3412";

const DRAWER_ACTION_BTN_BASE = {
  borderRadius: 4,
  padding: "8px 10px",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  transition: "all 0.13s",
  width: "100%",
  textAlign: "center" as const,
  boxSizing: "border-box" as const,
};

function drawerActionBtnMarkPickup(font: string, disabled: boolean) {
  return {
    ...DRAWER_ACTION_BTN_BASE,
    fontFamily: font,
    backgroundColor: "#e3f2fd",
    color: "#1565c0",
    border: "1.5px solid #90caf9",
    cursor: disabled ? "wait" : "pointer",
    opacity: disabled ? 0.7 : 1,
  };
}

function drawerActionBtnClearPickup(font: string, disabled: boolean) {
  return {
    ...DRAWER_ACTION_BTN_BASE,
    fontFamily: font,
    backgroundColor: "#e3f2fd",
    color: "#1565c0",
    border: "1.5px solid #90caf9",
    cursor: disabled ? "wait" : "pointer",
    opacity: disabled ? 0.7 : 1,
  };
}

function drawerActionBtnVendorQr(font: string) {
  return {
    ...DRAWER_ACTION_BTN_BASE,
    fontFamily: font,
    backgroundColor: "#f5f3ff",
    color: "#5b21b6",
    border: "1.5px solid #c4b5fd",
  };
}

function drawerActionBtnRevoke(font: string, disabled: boolean) {
  return {
    ...DRAWER_ACTION_BTN_BASE,
    fontFamily: font,
    backgroundColor: "#fff",
    color: "#b91c1c",
    border: "1.5px solid #b91c1c",
    cursor: disabled ? "wait" : "pointer",
    opacity: disabled ? 0.7 : 1,
  };
}
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

const STATUS_ORDER: DeliveryStatus[] = [
  "pending",
  "shipped",
  "arrived",
  "partial",
  "ready_for_pickup",
  "complete",
  "issue",
  "picked_up",
  "installed",
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
  picked_up: {
    bg: "#f5f5f5",
    text: "#616161",
    border: "#e0e0e0",
    dot: "#9e9e9e",
  },
  installed: {
    bg: "#eceff1",
    text: "#546e7a",
    border: "#cfd8dc",
    dot: "#78909c",
  },
};

const STATUS_COUNT_COLORS: Record<
  DeliveryStatus,
  { bg: string; text: string; accent: string }
> = {
  pending: { bg: "#fff8e1", text: "#f59104", accent: "#f59104" },
  arrived: { bg: "#e3f2fd", text: "#1565c0", accent: "#1976d2" },
  partial: { bg: "#f3e5f5", text: "#7b1fa2", accent: "#9c27b0" },
  ready_for_pickup: { bg: "#e8f5e9", text: "#2e7d32", accent: "#388e3c" },
  complete: { bg: "#e8f5e9", text: "#2e7d32", accent: "#388e3c" },
  issue: { bg: "#ffebee", text: "#c62828", accent: "#d32f2f" },
  picked_up: { bg: "#f5f5f5", text: "#424242", accent: "#757575" },
  shipped: { bg: "#e3f2fd", text: "#0d47a1", accent: "#1976d2" },
  installed: { bg: "#eceff1", text: "#546e7a", accent: "#78909c" },
};

const STATUS_LABEL = (status: DeliveryStatus): string =>
  DELIVERY_STATUS_LABEL[status];

/** Drawer UI simplification (away-080) — sections hidden pending redesign; logic preserved. */
const DRAWER_HIDE_VENDOR_COMMUNICATIONS = false;
const DRAWER_HIDE_RESOLVED_MATERIAL_ISSUES = true;
const DRAWER_HIDE_NEED_MORE_SPACE = true;

function resolvedIssueShortSummary(issue: MaterialIssue): string {
  if (issue.resolutionType) {
    return ISSUE_RESOLUTION_TYPE_LABEL[issue.resolutionType];
  }
  const desc = issue.description?.trim();
  if (desc) return desc.length > 80 ? `${desc.slice(0, 80)}…` : desc;
  return "Issue resolved";
}

function listStatusBadge(
  row: DeliveryListRow,
): (typeof STATUS_BADGE)[DeliveryStatus] {
  const label = row.statusDisplayLabel;
  if (label === "Complete" || label === "Delivered") return STATUS_BADGE.complete;
  if (label === "Ready for Pickup") return STATUS_BADGE.ready_for_pickup;
  if (label === "Issue / Review Required") return STATUS_BADGE.issue;
  if (label === "Picked Up") return STATUS_BADGE.picked_up;
  if (label === "Partial") return STATUS_BADGE.partial;
  if (label === "Pending Delivery" || label === "Awaiting Vendor Delivery") {
    return row.status === "shipped"
      ? STATUS_BADGE.shipped
      : STATUS_BADGE.pending;
  }
  if (label === "Incomplete") return STATUS_BADGE.partial;
  return STATUS_BADGE[row.status];
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
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [selectedDetails, setSelectedDetails] =
    useState<DeliveryDetails | null>(null);

  const [mutationLoading, setMutationLoading] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const pickupOperationIds = useRef<Map<string, string>>(new Map());

  const [availableStagingLocations, setAvailableStagingLocations] = useState<
    StagingLocation[]
  >([]);

  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetchAllDataRef = useRef<() => Promise<void>>(async () => {});
  const lastRefreshGeneration = useRef(0);
  const {
    emailProviderConnected,
    refreshBusy,
    gmailSyncMessage,
    lastUpdated: refreshLastUpdated,
    setLastUpdated,
    handleRefreshNow,
    refreshGeneration,
  } = useDispatcherPortal();

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

  /* ── Fetch staging locations once on mount ── */
  useEffect(() => {
    void firestoreDataService
      .listStagingLocations()
      .then(setAvailableStagingLocations);
  }, []);

  /* ── Staging location assignment ── */
  const handleUpdateStagingLocation = async (
    locationId: string | null,
  ): Promise<void> => {
    if (!selectedDeliveryId) return;
    setMutationLoading(true);
    setMutationError(null);
    try {
      const updated = await firestoreDataService.updateStagingLocation(
        selectedDeliveryId,
        locationId,
      );
      if (updated) {
        setSelectedDetails(updated);
        await fetchAllData();
      } else {
        setMutationError("Failed to update staging location.");
      }
    } catch (e) {
      if (isStagingLocationOccupiedError(e) || isShopStockLocationReservedError(e)) {
        setMutationError(e.message);
      } else {
        setMutationError(
          "An unexpected error occurred while updating staging location.",
        );
        console.error(e);
      }
    } finally {
      setMutationLoading(false);
    }
  };

  const handleUpdateJobPickupScheduled = async (
    scheduled: boolean,
  ): Promise<void> => {
    const jobId = selectedDetails?.job?.id;
    if (!jobId) return;
    setMutationLoading(true);
    setMutationError(null);
    try {
      const updatedJob = await firestoreDataService.updateJobPickupScheduled(
        jobId,
        scheduled,
      );
      if (updatedJob && selectedDeliveryId) {
        const refreshed = await firestoreDataService.getDeliveryDetails(
          selectedDeliveryId,
        );
        if (refreshed) {
          setSelectedDetails(refreshed);
        } else {
          setSelectedDetails((prev) =>
            prev ? { ...prev, job: updatedJob } : prev,
          );
        }
        await fetchAllData();
      } else if (updatedJob) {
        setSelectedDetails((prev) =>
          prev ? { ...prev, job: updatedJob } : prev,
        );
        await fetchAllData();
      } else {
        setMutationError("Failed to update Pickup Scheduled.");
      }
    } catch (e) {
      setMutationError(
        "An unexpected error occurred while updating Pickup Scheduled.",
      );
      console.error(e);
    } finally {
      setMutationLoading(false);
    }
  };

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
        await firestoreDataService.updateDeliveryStatus(
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

  const handleRecordPickup = async (
    technicianName: string,
    itemsSummary: string,
  ) => {
    if (!selectedDeliveryId) return;

    setMutationLoading(true);
    setMutationError(null);

    try {
      let operationId = pickupOperationIds.current.get(selectedDeliveryId);
      if (!operationId) {
        operationId = `pickup-${selectedDeliveryId}-${crypto.randomUUID()}`;
        pickupOperationIds.current.set(selectedDeliveryId, operationId);
      }
      await firestoreDataService.recordPickupEvent(
        selectedDeliveryId,
        technicianName,
        itemsSummary,
        undefined,
        operationId,
      );
      const updatedDetails =
        await firestoreDataService.getDeliveryDetails(selectedDeliveryId);
      if (updatedDetails) {
        setSelectedDetails(updatedDetails);
        await fetchAllData();
      } else {
        setMutationError("Failed to record pickup.");
      }
    } catch (e) {
      setMutationError("An unexpected error occurred while recording pickup.");
      console.error(e);
    } finally {
      setMutationLoading(false);
    }
  };

  const handleResolveMaterialIssue = async (
    issueId: string,
    resolutionType: IssueResolutionType,
    resolutionNote: string,
  ) => {
    if (!selectedDeliveryId) return;

    setMutationLoading(true);
    setMutationError(null);

    try {
      await resolveMaterialIssue({
        issueId,
        resolutionType,
        resolutionNote: resolutionNote.trim() || ISSUE_RESOLUTION_TYPE_LABEL[resolutionType],
      });
      const updatedDetails =
        await firestoreDataService.getDeliveryDetails(selectedDeliveryId);
      if (updatedDetails) {
        setSelectedDetails(updatedDetails);
        await fetchAllData();
      }
    } catch (e) {
      setMutationError("Failed to resolve material issue.");
      console.error(e);
    } finally {
      setMutationLoading(false);
    }
  };

  const handleRevertStatus = async () => {
    if (!selectedDeliveryId) return;

    setMutationLoading(true);
    setMutationError(null);

    try {
      const updatedDetails =
        await firestoreDataService.revertDeliveryStatus(
          selectedDeliveryId,
          "dispatcher",
        );

      if (updatedDetails) {
        setSelectedDetails(updatedDetails);
        await fetchAllData();
      } else {
        setMutationError("Failed to revert status.");
      }
    } catch (e) {
      setMutationError("An unexpected error occurred while reverting status.");
      console.error(e);
    } finally {
      setMutationLoading(false);
    }
  };

  const handleMarkShipped = async () => {
    if (!selectedDeliveryId) return;

    setMutationLoading(true);
    setMutationError(null);

    try {
      await markDeliveryShipped(selectedDeliveryId);
      const updatedDetails =
        await firestoreDataService.getDeliveryDetails(selectedDeliveryId);
      if (updatedDetails) {
        setSelectedDetails(updatedDetails);
        await fetchAllData();
      } else {
        setMutationError("Failed to mark delivery as shipped.");
      }
    } catch (e) {
      setMutationError("An unexpected error occurred while marking shipped.");
      console.error(e);
    } finally {
      setMutationLoading(false);
    }
  };

  const handleUpdateIssueSummary = async (summary: string): Promise<void> => {
    if (!selectedDeliveryId) return;
    setMutationLoading(true);
    setMutationError(null);
    try {
      const updated = await firestoreDataService.updateIssueSummary(
        selectedDeliveryId,
        summary,
      );
      if (updated) setSelectedDetails(updated);
      await fetchAllData();
    } catch (err) {
      setMutationError(
        err instanceof Error ? err.message : "Failed to update issue",
      );
    } finally {
      setMutationLoading(false);
    }
  };

  const handleSetDeliverToSiteConfirmed = async (
    confirmed: boolean,
  ): Promise<void> => {
    if (!selectedDeliveryId) return;
    setMutationLoading(true);
    setMutationError(null);
    try {
      const updated = await firestoreDataService.setDeliverToSiteConfirmed(
        selectedDeliveryId,
        confirmed,
      );
      if (updated) {
        setSelectedDetails(updated);
        await fetchAllData();
      } else {
        setMutationError("Failed to update site delivery confirmation.");
      }
    } catch (err) {
      setMutationError(
        err instanceof Error
          ? err.message
          : "Failed to update site delivery confirmation.",
      );
      console.error(err);
    } finally {
      setMutationLoading(false);
    }
  };

  const handleUpdateShopStockPickList = async (
    items: string[],
    locationNote: string,
    linkedMappingId?: string,
  ): Promise<void> => {
    if (!selectedDeliveryId) return;
    setMutationLoading(true);
    setMutationError(null);
    try {
      const mappings = await listShopStockMappings();
      const shopStockLines = buildShopStockLinesFromPickList(
        items,
        mappings,
        linkedMappingId,
      );
      const resolvedNote =
        locationNote.trim() ||
        shopStockLocationNoteFromLines(shopStockLines, mappings);
      const updated = await firestoreDataService.updateShopStockPickList(
        selectedDeliveryId,
        items,
        resolvedNote,
        shopStockLines,
      );
      if (updated) setSelectedDetails(updated);
      await fetchAllData();
    } catch (err) {
      setMutationError(
        err instanceof Error
          ? err.message
          : "Failed to update shop stock pick list",
      );
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
        await firestoreDataService.getDeliveryDetails(deliveryId);
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

          <NeedsReviewEmailStrip />

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
                onRecordPickup={handleRecordPickup}
                onRevertStatus={handleRevertStatus}
                onMarkShipped={handleMarkShipped}
                onUpdateIssueSummary={handleUpdateIssueSummary}
                onSetDeliverToSiteConfirmed={handleSetDeliverToSiteConfirmed}
                onUpdateShopStockPickList={handleUpdateShopStockPickList}
                stagingLocations={availableStagingLocations}
                onUpdateStagingLocation={handleUpdateStagingLocation}
                onUpdateJobPickupScheduled={handleUpdateJobPickupScheduled}
                onDeliveryOrderUpdated={(delivery) => {
                  setSelectedDetails((prev) =>
                    prev ? { ...prev, delivery } : prev,
                  );
                  void fetchAllData();
                }}
                onResolveMaterialIssue={handleResolveMaterialIssue}
                emailProviderConnected={emailProviderConnected}
              />
            </div>
          </div>
        </div>
      )}

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

/* ─── Pickup token controls ──────────────────────────────────────────────── */

type PickupTokenControlsRenderProps = {
  hasActiveToken: boolean;
  tokenBusy: boolean;
  tokenExpiresAt: string | null;
  statusLoading: boolean;
  tokenError: string | null;
  onRevoke: () => void;
};

function PickupTokenControls({
  jobId,
  font: _font,
  refreshKey,
  children,
}: {
  jobId: string;
  font: string;
  refreshKey?: number;
  children: (props: PickupTokenControlsRenderProps) => ReactNode;
}) {
  const [statusLoading, setStatusLoading] = useState(true);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [hasActiveToken, setHasActiveToken] = useState(false);
  const [tokenExpiresAt, setTokenExpiresAt] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    setTokenError(null);
    try {
      const status = await firestoreDataService.getPickupTokenStatus(jobId);
      setHasActiveToken(status.hasActiveToken);
      setTokenExpiresAt(status.expiresAt ?? null);
    } catch (err) {
      setTokenError(
        err instanceof Error ? err.message : "Failed to load pickup token status.",
      );
    } finally {
      setStatusLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus, refreshKey]);

  const handleRevoke = async () => {
    setTokenBusy(true);
    setTokenError(null);
    try {
      await firestoreDataService.revokePickupToken(jobId);
      clearPickupTokenForJob(jobId);
      setHasActiveToken(false);
      setTokenExpiresAt(null);
    } catch (err) {
      setTokenError(
        err instanceof Error ? err.message : "Failed to revoke pickup link.",
      );
    } finally {
      setTokenBusy(false);
    }
  };

  return (
    <>
      {children({
        hasActiveToken,
        tokenBusy,
        tokenExpiresAt,
        statusLoading,
        tokenError,
        onRevoke: () => void handleRevoke(),
      })}
    </>
  );
}

/* ─── Copy Pickup Link ───────────────────────────────────────────────────── */

function CopyPickupLinkButton({
  details,
  font,
  onTokenGenerated,
}: {
  details: DeliveryDetails;
  font: string;
  onTokenGenerated?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const job = details.job;
  const jobId = job?.id ?? details.delivery.jobId;

  const resolveSecurePickupLink = async (): Promise<string> => {
    const storedToken = readPickupTokenForJob(jobId);
    if (storedToken) {
      try {
        const validated = await validatePickupTokenClient(storedToken);
        if (validated.jobId === jobId) {
          return buildPickupTokenUrl(storedToken);
        }
      } catch {
        clearPickupTokenForJob(jobId);
      }
    }

    const result = await firestoreDataService.generatePickupToken(jobId);
    storePickupTokenForJob(jobId, result.token);
    onTokenGenerated?.();
    await validatePickupTokenClient(result.token);
    return buildPickupTokenUrl(result.token);
  };

  const handleCopy = async () => {
    setBusy(true);
    setCopyError(null);
    try {
      const link = await resolveSecurePickupLink();
      const text = buildPickupInformationClipboardText(details, link);
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      setCopyError(
        err instanceof Error ? err.message : "Failed to copy pickup information.",
      );
    } finally {
      setBusy(false);
    }
  };

  const canCopy = deliveryHasCopyPickupIdentifyingInfo(details);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <button
        type="button"
        data-testid="copy-pickup-information"
        disabled={!canCopy || busy}
        aria-disabled={!canCopy || busy}
        onClick={() => {
          if (canCopy) void handleCopy();
        }}
        style={{
          ...DRAWER_ACTION_BTN_BASE,
          fontFamily: font,
          ...(canCopy
            ? {
                backgroundColor: copied ? "#e8f5e9" : "#fff",
                color: "#2e7d32",
                border: `1.5px solid ${copied ? "#a5d6a7" : "#2e7d32"}`,
                cursor: busy ? "wait" : "pointer",
                opacity: busy ? 0.7 : 1,
              }
            : {
                backgroundColor: "#f3f4f6",
                color: "#9ca3af",
                border: "1.5px solid #d1d5db",
                cursor: "not-allowed",
                opacity: 1,
              }),
        }}
      >
        {!canCopy
          ? "Insufficient order info"
          : busy
            ? "Preparing…"
            : copied
              ? "Pickup information copied with secure pickup link."
              : "Copy Pickup Information"}
      </button>
      {copyError ? (
        <span style={{ fontSize: 11, color: "#b91c1c", fontFamily: font }}>
          {copyError}
        </span>
      ) : null}
    </div>
  );
}

/* ─── Print Label Modal ──────────────────────────────────────────────────── */

function PrintLabelModal({
  qrUrl,
  orderNumber,
  vendorName,
  zoneCode,
  onClose,
}: {
  qrUrl: string;
  orderNumber: string;
  vendorName: string;
  zoneCode: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(15, 23, 42, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 1000,
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          backgroundColor: "#fff",
          borderRadius: 12,
          boxShadow: "0 20px 50px rgba(15, 23, 42, 0.25)",
          width: "100%",
          maxWidth: 380,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          alignItems: "center",
          fontFamily: FONT,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 800,
            color: "#111827",
          }}
        >
          Delivery Label
        </h2>
        <div
          style={{
            backgroundColor: "#fff",
            padding: 12,
            borderRadius: 12,
            border: "1px solid #e5e7eb",
          }}
        >
          <EslQrCode value={qrUrl} variant="print" />
        </div>
        <div
          style={{
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 800, color: "#111827" }}>
            {orderNumber}
          </div>
          <div style={{ fontSize: 14, color: "#4b5563" }}>{vendorName}</div>
          {zoneCode ? (
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              Staging {zoneCode} — same QR as the zone e-tag sign
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              Assign a staging spot for a shorter zone QR (like e-tags)
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 10, width: "100%", justifyContent: "center" }}>
          <button
            type="button"
            onClick={() => window.print()}
            style={{
              padding: "8px 14px",
              borderRadius: 6,
              border: `1px solid ${NAVY}`,
              backgroundColor: NAVY,
              color: "#fff",
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: FONT,
            }}
          >
            Push to E-Tag
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 14px",
              borderRadius: 6,
              border: "1px solid #d1d5db",
              backgroundColor: "#fff",
              color: "#374151",
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: FONT,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Detail Content ─────────────────────────────────────────────────────── */

function latestPickupEvent(events: PickupEvent[]): PickupEvent | null {
  if (events.length === 0) return null;
  return [...events].sort((a, b) => b.pickedUpAt.localeCompare(a.pickedUpAt))[0];
}

function estimateRemainingItemQty(items: Item[]): number {
  return items.reduce((sum, item) => {
    if (item.status === "installed") return sum;
    return sum + Math.max(0, item.qtyOrdered - item.qtyReceived);
  }, 0);
}

function DetailContent({
  loading,
  error,
  details,
  navy,
  font,
  mutationLoading,
  mutationError,
  onUpdateStatus,
  onRecordPickup,
  onRevertStatus,
  onMarkShipped,
  onUpdateIssueSummary,
  onSetDeliverToSiteConfirmed,
  onUpdateShopStockPickList,
  stagingLocations,
  onUpdateStagingLocation,
  onUpdateJobPickupScheduled,
  onDeliveryOrderUpdated,
  onResolveMaterialIssue,
  emailProviderConnected,
}: {
  loading: boolean;
  error: string | null;
  details: DeliveryDetails | null;
  navy: string;
  font: string;
  mutationLoading: boolean;
  mutationError: string | null;
  onUpdateStatus: (toStatus: DeliveryStatus, reason?: string) => Promise<void>;
  onRecordPickup: (technicianName: string, itemsSummary: string) => Promise<void>;
  onRevertStatus: () => Promise<void>;
  onMarkShipped: () => Promise<void>;
  onUpdateIssueSummary: (summary: string) => Promise<void>;
  onSetDeliverToSiteConfirmed: (confirmed: boolean) => Promise<void>;
  onUpdateShopStockPickList: (
    items: string[],
    locationNote: string,
    linkedMappingId?: string,
  ) => Promise<void>;
  stagingLocations: StagingLocation[];
  onUpdateStagingLocation: (id: string | null) => Promise<void>;
  onUpdateJobPickupScheduled: (scheduled: boolean) => Promise<void>;
  onDeliveryOrderUpdated: (delivery: DeliveryOrder) => void;
  onResolveMaterialIssue: (
    issueId: string,
    resolutionType: IssueResolutionType,
    resolutionNote: string,
  ) => Promise<void>;
  emailProviderConnected: boolean;
}) {
  const [showPrintLabel, setShowPrintLabel] = useState(false);
  const [resolveIssueId, setResolveIssueId] = useState<string | null>(null);
  const [resolutionType, setResolutionType] =
    useState<IssueResolutionType>("found_in_shop");
  const [resolutionNote, setResolutionNote] = useState("");
  const [resolutionNoteTouched, setResolutionNoteTouched] = useState(false);
  const [emailVendorLoading, setEmailVendorLoading] = useState(false);
  const [emailVendorError, setEmailVendorError] = useState<string | null>(null);
  const [emailVendorSuccess, setEmailVendorSuccess] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [saveVendorEmail, setSaveVendorEmail] = useState(false);
  const [emailFieldsTouched, setEmailFieldsTouched] = useState(false);
  const [vendorCommsRefresh, setVendorCommsRefresh] = useState(0);
  const [vendorCommsExpandSignal, setVendorCommsExpandSignal] = useState(0);
  const [emailEvidenceExpandSignal, setEmailEvidenceExpandSignal] = useState(0);
  const [pickupTokenRefreshKey, setPickupTokenRefreshKey] = useState(0);
  const [activityHistoryExpanded, setActivityHistoryExpanded] = useState(false);
  const [activityHistoryFullView, setActivityHistoryFullView] = useState(false);
  const [expandedResolvedIssueIds, setExpandedResolvedIssueIds] = useState<
    Set<string>
  >(new Set());
  const [inspectImport, setInspectImport] = useState<VendorInvoiceImportReview | null>(
    null,
  );
  const [inspectImportLoading, setInspectImportLoading] = useState(false);
  const [inspectImportError, setInspectImportError] = useState<string | null>(null);

  useEffect(() => {
    setActivityHistoryExpanded(false);
    setActivityHistoryFullView(false);
    setInspectImport(null);
    setInspectImportError(null);
  }, [details?.delivery.id]);

  const expandVendorCommunications = () => {
    setVendorCommsExpandSignal((value) => value + 1);
    requestAnimationFrame(() => {
      const panel = document.querySelector('[data-testid="vendor-communications-panel"]');
      panel?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const expandEmailEvidenceReview = () => {
    setEmailEvidenceExpandSignal((value) => value + 1);
    requestAnimationFrame(() => {
      const panel = document.querySelector('[data-testid="readiness-evidence-panel"]');
      panel?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const resolutionContext = {
    orderNumber: details?.delivery.orderNumber ?? null,
    jobNumber: details?.job?.jobNumber ?? null,
    missingItems: (details?.items ?? [])
      .filter((item) => item.qtyMissing > 0)
      .map((item) => ({
        description: item.description,
        qtyMissing: item.qtyMissing,
        qtyOrdered: item.qtyOrdered,
      })),
  };

  const resetNeedMoreInfoEmailFields = (deliveryDetails: DeliveryDetails) => {
    setEmailTo(deliveryDetails.vendor.email?.trim() ?? "");
    setEmailSubject(buildNeedMoreInfoEmailSubject(deliveryDetails));
    setEmailBody(buildNeedMoreInfoEmailBody(deliveryDetails) ?? "");
    setSaveVendorEmail(false);
    setEmailFieldsTouched(false);
  };

  const openResolveModal = (issue: MaterialIssue) => {
    if (!details) return;
    const defaultType = defaultResolutionTypeForIssue(issue);
    setResolveIssueId(issue.id);
    setResolutionType(defaultType);
    setResolutionNote(
      buildSuggestedResolutionNote(issue, defaultType, resolutionContext),
    );
    setResolutionNoteTouched(false);
    resetNeedMoreInfoEmailFields(details);
    setEmailVendorLoading(false);
    setEmailVendorError(null);
    setEmailVendorSuccess(false);
  };

  const handleEmailVendor = async () => {
    if (!details || !resolveIssueId) return;
    const to = emailTo.trim();
    const subject = emailSubject.trim();
    const body = emailBody.trim();
    if (!to || !subject || !body) {
      setEmailVendorError("To, subject, and message are required.");
      return;
    }
    const vendorEmailOnFile = details.vendor.email?.trim().toLowerCase() ?? "";
    const toNormalized = to.toLowerCase();
    const needsSave =
      !vendorEmailOnFile || toNormalized !== vendorEmailOnFile;
    if (needsSave && !saveVendorEmail) {
      setEmailVendorError(
        "Confirm saving the email to the vendor record when the address differs or is new.",
      );
      return;
    }
    setEmailVendorLoading(true);
    setEmailVendorError(null);
    setEmailVendorSuccess(false);
    try {
      await sendVendorEmail({
        deliveryOrderId: details.delivery.id,
        materialIssueId: resolveIssueId,
        to,
        subject,
        body,
        saveVendorEmail: needsSave ? saveVendorEmail : undefined,
      });
      setEmailVendorSuccess(true);
      setVendorCommsRefresh((v) => v + 1);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Failed to send vendor email.";
      setEmailVendorError(message);
    } finally {
      setEmailVendorLoading(false);
    }
  };

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

  if (!details.job) return null;
  const job = details.job;
  const delivery = details.delivery;
  const linkedInvoiceImportId = delivery.vendorInvoiceImportId?.trim() ?? "";
  const shopStagingRequired = !isInvoiceShellNoShopStaging(delivery);

  const openLinkedInvoiceInspect = async () => {
    if (!linkedInvoiceImportId) return;
    setInspectImportLoading(true);
    setInspectImportError(null);
    try {
      const row = await getVendorInvoiceImport(linkedInvoiceImportId);
      setInspectImport(row);
    } catch (err) {
      setInspectImportError(
        err instanceof Error ? err.message : "Could not load parsed invoice data.",
      );
    } finally {
      setInspectImportLoading(false);
    }
  };

  const openMaterialIssues = details.materialIssues.filter(
    (i) => i.status === "open" || i.status === "assigned",
  );
  const nonBlockingOpenIssues = openMaterialIssues.filter((i) => !i.blocking);
  const resolvedIssues = details.materialIssues.filter((i) => i.status === "resolved");
  const firstBlockingIssue = openMaterialIssues.find((i) => i.blocking);

  const renderDrawerSection = (title: string, content: ReactNode) => (
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
  );

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
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 20,
          fontSize: 14,
          fontFamily: font,
        }}
      >
        {renderDrawerSection(
          "Delivery Basics",
          <>
            <div
              data-testid="delivery-basics-card"
              style={{
                backgroundColor: "#f8fafc",
                border: "1px solid #e0e3e8",
                borderRadius: 8,
                padding: "15px",
                display: "flex",
                flexDirection: "column" as const,
                gap: 10,
                marginBottom: 12,
              }}
            >
              {[
                {
                  label: "Job #",
                  value: (
                    <span style={{ fontFamily: "monospace", fontWeight: 700 }}>
                      {job.jobNumber}
                    </span>
                  ),
                },
                { label: "Job Name", value: job.jobName },
                {
                  label: "Order #",
                  value: (
                    <span style={{ fontFamily: "monospace", fontWeight: 700 }}>
                      {details.delivery.orderNumber}
                    </span>
                  ),
                },
                { label: "Vendor", value: details.vendor.name },
                {
                  label: "PO #",
                  value: (
                    <span style={{ fontFamily: "monospace" }}>
                      {resolveDeliveryPoNumber(
                        details.delivery.customerPoOrReference,
                        details.purchaseOrder?.poNumber,
                      ) ?? "—"}
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
                    <span
                      data-testid="delivery-basics-staging-unassigned"
                      style={{ color: "#9ca3af", fontStyle: "italic" }}
                    >
                      Not Assigned
                    </span>
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
                  <span style={{ color: "#333", textAlign: "right" }}>{value}</span>
                </div>
              ))}
            </div>
          </>,
        )}
        <PickupTokenControls
          jobId={job.id}
          font={font}
          refreshKey={pickupTokenRefreshKey}
        >
          {({
            hasActiveToken,
            tokenBusy,
            tokenExpiresAt,
            statusLoading,
            tokenError,
            onRevoke,
          }) => {
            const showPickupStatus =
              statusLoading ||
              Boolean(job.pickupScheduledAt) ||
              hasActiveToken ||
              Boolean(tokenError);

            return (
            <>
            <style>{`
              .drawer-action-buttons-grid {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 8px;
                width: 100%;
              }
              @media (max-width: 480px) {
                .drawer-action-buttons-grid {
                  grid-template-columns: 1fr;
                }
              }
            `}</style>
            <div
              data-testid="drawer-action-buttons"
              className="drawer-action-buttons-grid"
            >
              {linkedInvoiceImportId ? (
                <>
                  <button
                    type="button"
                    data-testid="drawer-review-parsed-invoice"
                    disabled={inspectImportLoading}
                    onClick={() => void openLinkedInvoiceInspect()}
                    style={drawerActionBtnVendorQr(font)}
                  >
                    {inspectImportLoading
                      ? "Loading parsed data…"
                      : "Review parsed invoice data"}
                  </button>
                </>
              ) : null}
              {showPickupStatus ? (
                <div
                  data-testid="pickup-token-controls"
                  style={{
                    gridColumn: "1 / -1",
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                  }}
                >
                  {statusLoading ? (
                    <span
                      style={{ fontSize: 11, color: "#6b7280", fontFamily: font }}
                    >
                      Checking pickup link…
                    </span>
                  ) : (
                    <>
                      {(job.pickupScheduledAt || hasActiveToken) ? (
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 6,
                            alignItems: "center",
                          }}
                        >
                          {job.pickupScheduledAt ? (
                            <span
                              data-testid="pickup-scheduled-badge"
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                backgroundColor: "#e3f2fd",
                                color: "#1565c0",
                                border: "1px solid #90caf9",
                                borderRadius: 999,
                                padding: "4px 10px",
                                fontSize: 11,
                                fontWeight: 600,
                                letterSpacing: "0.02em",
                              }}
                            >
                              Pickup Scheduled
                            </span>
                          ) : null}
                          {hasActiveToken ? (
                            <span
                              data-testid="pickup-token-active"
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                backgroundColor: "#e8f5e9",
                                color: "#2e7d32",
                                border: "1px solid #a5d6a7",
                                borderRadius: 999,
                                padding: "4px 10px",
                                fontSize: 11,
                                fontWeight: 600,
                                letterSpacing: "0.02em",
                              }}
                            >
                              Active link expires{" "}
                              {tokenExpiresAt
                                ? new Date(tokenExpiresAt).toLocaleString()
                                : "…"}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      {hasActiveToken && !readPickupTokenForJob(job.id) ? (
                        <span
                          data-testid="pickup-token-copy-regen-hint"
                          style={{
                            fontSize: 11,
                            color: "#6b7280",
                            fontFamily: font,
                          }}
                        >
                          Copy will generate a fresh secure link
                        </span>
                      ) : null}
                    </>
                  )}
                  {tokenError ? (
                    <span
                      style={{ fontSize: 11, color: "#b91c1c", fontFamily: font }}
                    >
                      {tokenError}
                    </span>
                  ) : null}
                </div>
              ) : null}
              <button
                type="button"
                disabled={mutationLoading}
                onClick={() =>
                  void onUpdateJobPickupScheduled(!job.pickupScheduledAt)
                }
                style={
                  job.pickupScheduledAt
                    ? drawerActionBtnClearPickup(font, mutationLoading)
                    : drawerActionBtnMarkPickup(font, mutationLoading)
                }
              >
                {job.pickupScheduledAt
                  ? "Clear Pickup Scheduled"
                  : "Mark Pickup Scheduled"}
              </button>
              <button
                type="button"
                data-testid="show-vendor-checkin-qr"
                onClick={() => setShowPrintLabel(true)}
                style={drawerActionBtnVendorQr(font)}
              >
                Show Vendor Check-In QR
              </button>
              <div style={{ minWidth: 0 }}>
                <CopyPickupLinkButton
                  details={details}
                  font={font}
                  onTokenGenerated={() =>
                    setPickupTokenRefreshKey((value) => value + 1)
                  }
                />
              </div>
              {hasActiveToken ? (
                <button
                  type="button"
                  data-testid="revoke-pickup-link"
                  disabled={mutationLoading || tokenBusy}
                  onClick={() => void onRevoke()}
                  style={drawerActionBtnRevoke(
                    font,
                    mutationLoading || tokenBusy,
                  )}
                >
                  Reset Pickup Link
                </button>
              ) : null}
            </div>
            </>
            );
          }}
        </PickupTokenControls>
        {!details.stagingLocation && shopStagingRequired ? (
          <StagingLocationBanner
            font={font}
            onAssignLocation={() => {
              const target = document.querySelector(
                '[data-testid="staging-location-assignment"]',
              );
              if (target instanceof HTMLElement) {
                target.scrollIntoView({ behavior: "smooth", block: "center" });
                const select = target.querySelector("select");
                if (select instanceof HTMLSelectElement) {
                  select.focus({ preventScroll: true });
                }
              }
            }}
          />
        ) : null}
        <DrawerActionBanner
          details={details}
          navy={navy}
          font={font}
          onResolveBlockingIssue={
            firstBlockingIssue
              ? () => openResolveModal(firstBlockingIssue)
              : undefined
          }
          onReviewIssues={() => {
            document
              .querySelector('[data-testid="issue-summary-panel"]')
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          onReviewVendorEmail={expandEmailEvidenceReview}
        />
        <IssueSummaryPanel
          details={details}
          navy={navy}
          font={font}
          loading={mutationLoading}
          onSetDeliverToSiteConfirmed={onSetDeliverToSiteConfirmed}
        />
        {renderDrawerSection(
          "Readiness Evidence",
          <ReadinessEvidencePanel
            details={details}
            stagingLocations={stagingLocations}
            navy={navy}
            font={font}
            onExpandVendorCommunications={expandVendorCommunications}
            emailEvidenceExpandSignal={emailEvidenceExpandSignal}
          />,
        )}
        {nonBlockingOpenIssues.length > 0 &&
          renderDrawerSection(
            `Material Issues (${nonBlockingOpenIssues.length})`,
            <div
              data-testid="material-issues-panel"
              style={{
                display: "flex",
                flexDirection: "column" as const,
                gap: 8,
              }}
            >
              {nonBlockingOpenIssues.map((issue) => (
                <div
                  key={issue.id}
                  style={{
                    border: "1px solid #e0e3e8",
                    borderRadius: 8,
                    padding: "12px",
                    backgroundColor: issue.blocking ? "#fff8f8" : "#fff",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                      marginBottom: 6,
                    }}
                  >
                    <span style={{ fontWeight: 700, color: "#333" }}>
                      {MATERIAL_ISSUE_TYPE_LABEL[issue.type]}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        color: issue.blocking ? "#c62828" : "#6b7280",
                      }}
                    >
                      {issue.blocking ? "Blocking" : "Info"}
                    </span>
                  </div>
                  <p style={{ margin: "0 0 6px", fontSize: 12, color: "#555" }}>
                    {issue.description?.trim() || "No description"}
                  </p>
                  <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>
                    Reported by {issue.reportedBy} · Owner{" "}
                    {issue.assignedOwnerName ?? "Unassigned"} ·{" "}
                    {new Date(issue.createdAt).toLocaleString()}
                  </p>
                  <button
                    type="button"
                    data-testid={`resolve-issue-${issue.id}`}
                    disabled={mutationLoading}
                    onClick={() => openResolveModal(issue)}
                    style={{
                      marginTop: 8,
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: `1px solid ${navy}`,
                      backgroundColor: "#fff",
                      color: navy,
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: mutationLoading ? "not-allowed" : "pointer",
                      opacity: mutationLoading ? 0.6 : 1,
                    }}
                  >
                    Resolve
                  </button>
                </div>
              ))}
              {!DRAWER_HIDE_RESOLVED_MATERIAL_ISSUES &&
                resolvedIssues.length > 0 && (
                <div
                  data-testid="recently-resolved-material-issues"
                  style={{ marginTop: nonBlockingOpenIssues.length > 0 ? 12 : 0 }}
                >
                  <p
                    style={{
                      margin: "0 0 8px",
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#6b7280",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    Recently Resolved Material Issues
                  </p>
                  {resolvedIssues.slice(0, 3).map((issue) => {
                    const expanded = expandedResolvedIssueIds.has(issue.id);
                    const shortSummary = resolvedIssueShortSummary(issue);
                    return (
                      <div
                        key={issue.id}
                        data-testid={`resolved-issue-compact-${issue.id}`}
                        style={{
                          border: "1px solid #e5e7eb",
                          borderRadius: 8,
                          padding: "10px 12px",
                          backgroundColor: "#fff",
                          marginBottom: 6,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            gap: 8,
                            marginBottom: 4,
                          }}
                        >
                          <p
                            style={{
                              margin: 0,
                              fontSize: 13,
                              fontWeight: 700,
                              color: "#333",
                              fontFamily: font,
                            }}
                          >
                            {MATERIAL_ISSUE_TYPE_LABEL[issue.type]}
                          </p>
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              textTransform: "uppercase",
                              letterSpacing: "0.04em",
                              color: "#2e7d32",
                              backgroundColor: "#e8f5e9",
                              border: "1px solid #a5d6a7",
                              borderRadius: 4,
                              padding: "2px 6px",
                              whiteSpace: "nowrap",
                            }}
                          >
                            Resolved
                          </span>
                        </div>
                        <p
                          style={{
                            margin: "0 0 6px",
                            fontSize: 12,
                            color: "#555",
                            fontFamily: font,
                            lineHeight: 1.45,
                          }}
                        >
                          {shortSummary}
                        </p>
                        {!expanded && (
                          <button
                            type="button"
                            data-testid={`resolved-issue-show-details-${issue.id}`}
                            onClick={() =>
                              setExpandedResolvedIssueIds((prev) => {
                                const next = new Set(prev);
                                next.add(issue.id);
                                return next;
                              })
                            }
                            style={{
                              background: "none",
                              border: "none",
                              padding: 0,
                              color: "#2563eb",
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: "pointer",
                              fontFamily: font,
                              textDecoration: "underline",
                            }}
                          >
                            Show Details
                          </button>
                        )}
                        {expanded && (
                          <div
                            data-testid={`resolved-issue-details-${issue.id}`}
                            style={{ marginTop: 4 }}
                          >
                            {issue.description?.trim() && (
                              <p
                                style={{
                                  margin: "0 0 6px",
                                  fontSize: 12,
                                  color: "#374151",
                                  fontFamily: font,
                                  lineHeight: 1.45,
                                }}
                              >
                                {issue.description.trim()}
                              </p>
                            )}
                            {issue.resolutionNote?.trim() && (
                              <p
                                style={{
                                  margin: "0 0 6px",
                                  fontSize: 12,
                                  color: "#6b7280",
                                  fontFamily: font,
                                  lineHeight: 1.45,
                                }}
                              >
                                {issue.resolutionNote.trim()}
                              </p>
                            )}
                            <p
                              style={{
                                margin: 0,
                                fontSize: 11,
                                color: "#9ca3af",
                                fontFamily: font,
                              }}
                            >
                              Reported by {issue.reportedBy}
                              {issue.resolvedAt
                                ? ` · Resolved ${new Date(issue.resolvedAt).toLocaleString()}`
                                : ""}
                            </p>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedResolvedIssueIds((prev) => {
                                  const next = new Set(prev);
                                  next.delete(issue.id);
                                  return next;
                                })
                              }
                              style={{
                                marginTop: 6,
                                background: "none",
                                border: "none",
                                padding: 0,
                                color: "#64748b",
                                fontSize: 11,
                                fontWeight: 600,
                                cursor: "pointer",
                                fontFamily: font,
                              }}
                            >
                              Hide Details
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>,
          )}
        {!DRAWER_HIDE_VENDOR_COMMUNICATIONS &&
          renderDrawerSection(
            "Vendor Communications",
            <VendorCommunicationsPanel
              navy={navy}
              font={font}
              emailProviderConnected={emailProviderConnected}
              deliveryOrderId={details.delivery.id}
              refreshKey={vendorCommsRefresh}
              expandSignal={vendorCommsExpandSignal}
            />,
          )}
        <StatusActionPanel
          details={details}
          loading={mutationLoading}
          error={mutationError}
          onUpdateStatus={onUpdateStatus}
          onRecordPickup={onRecordPickup}
          onRevertStatus={onRevertStatus}
          onMarkShipped={onMarkShipped}
          onUpdateIssueSummary={onUpdateIssueSummary}
          onUpdateShopStockPickList={onUpdateShopStockPickList}
          onUpdateStagingLocation={onUpdateStagingLocation}
          onDeliveryOrderUpdated={onDeliveryOrderUpdated}
          stagingLocations={stagingLocations}
          navy={navy}
          font={font}
        />
        {shouldShowPickupSummaryPanel(details.items, details.pickupEvents)
          ? renderDrawerSection(
          "Pickup Summary",
          (() => {
            const latest = latestPickupEvent(details.pickupEvents);
            const remainingQty = estimateRemainingItemQty(details.items);
            return (
              <div
                data-testid="pickup-summary-panel"
                style={{
                  border: "1px solid #e0e3e8",
                  borderRadius: 8,
                  padding: "12px",
                  backgroundColor: "#fff",
                }}
              >
                {!latest ? (
                  <p style={{ margin: 0, color: "#9ca3af", fontSize: 13 }}>
                    No pickup recorded yet.
                  </p>
                ) : (
                  <>
                    <p style={{ margin: "0 0 6px", fontWeight: 700, color: "#333" }}>
                      {latest.itemsPickedSummary}
                    </p>
                    <p style={{ margin: "0 0 6px", fontSize: 12, color: "#6b7280" }}>
                      {latest.technicianName} ·{" "}
                      {new Date(latest.pickedUpAt).toLocaleString()}
                    </p>
                    <p style={{ margin: 0, fontSize: 12, color: "#555" }}>
                      Qty remaining estimate: {remainingQty}
                    </p>
                  </>
                )}
              </div>
            );
          })(),
        )
          : null}
        {renderDrawerSection(
          `Items (${details.items.length})`,
          <div
            data-testid="drawer-items-section"
            style={{
              display: "flex",
              flexDirection: "column" as const,
              gap: 8,
            }}
          >
            {details.items.map((item) => {
              const qtyReceived = effectiveItemQtyReceived(
                details.delivery,
                item,
              );
              const notReceivedYet = qtyReceived === 0;
              const sb = notReceivedYet
                ? { bg: "#f3f4f6", text: "#6b7280", border: "#d1d5db" }
                : (STATUS_BADGE_LOCAL[item.status] ?? {
                    bg: "#f8f9fa",
                    text: "#495057",
                    border: "#ced4da",
                  });
              const statusLabel = notReceivedYet ? "Not received yet" : item.status;
              return (
                <div
                  key={item.id}
                  data-testid={`drawer-item-row-${item.id}`}
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
                      data-testid={`drawer-item-status-${item.id}`}
                      style={{
                        flexShrink: 0,
                        padding: "3px 8px",
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: notReceivedYet ? "none" : "uppercase",
                        letterSpacing: notReceivedYet ? "0" : "0.06em",
                        backgroundColor: sb.bg,
                        color: sb.text,
                        border: `1px solid ${sb.border}`,
                      }}
                    >
                      {statusLabel}
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
                        value: String(item.qtyOrdered),
                        bg: "#f8f9fa",
                        text: "#333",
                        border: "#e0e3e8",
                      },
                      {
                        label: notReceivedYet ? "Not received yet" : "Received",
                        value: notReceivedYet ? "0" : String(qtyReceived),
                        bg: notReceivedYet ? "#f3f4f6" : "#e8f5e9",
                        text: notReceivedYet ? "#6b7280" : "#2e7d32",
                        border: notReceivedYet ? "#d1d5db" : "#a5d6a7",
                      },
                      {
                        label: "Missing",
                        value: String(item.qtyMissing),
                        bg: item.qtyMissing > 0 ? "#ffebee" : "#f8f9fa",
                        text: item.qtyMissing > 0 ? "#c62828" : "#333",
                        border: item.qtyMissing > 0 ? "#ef9a9a" : "#e0e3e8",
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
                            textTransform: label === "Not received yet" ? "none" : "uppercase",
                            letterSpacing: label === "Not received yet" ? "0" : "0.06em",
                            lineHeight: 1.2,
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
          </div>,
        )}
        <section data-testid="activity-history-section">
          <button
            type="button"
            data-testid="activity-history-toggle"
            aria-expanded={activityHistoryExpanded}
            onClick={() => setActivityHistoryExpanded((v) => !v)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: 0,
              margin: "0 0 10px",
              border: "none",
              background: "none",
              cursor: "pointer",
              fontFamily: font,
              fontSize: 11,
              fontWeight: 700,
              color: "#9ca3af",
              letterSpacing: "0.10em",
              textTransform: "uppercase",
              textAlign: "left",
            }}
          >
            <span style={{ fontSize: 10, color: "#64748b" }}>
              {activityHistoryExpanded ? "▼" : "▶"}
            </span>
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
            Activity History
            {details.statusHistory.length > 0 && !activityHistoryExpanded ? (
              <span
                style={{
                  fontWeight: 400,
                  textTransform: "none",
                  letterSpacing: 0,
                  color: "#6b7280",
                  fontSize: 12,
                }}
              >
                ({Math.min(3, filterCompactActivityHistory(details.statusHistory).length)} recent)
              </span>
            ) : null}
          </button>
          {activityHistoryExpanded ? (
            <div data-testid="activity-history-content">
              {details.delivery.notes ? (
                <div
                  data-testid="delivery-notes-audit"
                  style={{
                    marginBottom: 12,
                    padding: "8px 10px",
                    backgroundColor: "#f8fafc",
                    border: "1px solid #e0e3e8",
                    borderRadius: 6,
                  }}
                >
                  <p
                    style={{
                      margin: "0 0 4px",
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#6b7280",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    Delivery Notes
                  </p>
                  <p style={{ margin: 0, fontSize: 12, color: "#333", lineHeight: 1.45 }}>
                    {details.delivery.notes}
                  </p>
                </div>
              ) : null}
              {details.statusHistory.length ? (
                <>
                  <div
                    data-testid="activity-history-compact"
                    style={{
                      display: "flex",
                      flexDirection: "column" as const,
                      gap: 10,
                    }}
                  >
                    {(activityHistoryFullView
                      ? sortActivityHistoryNewestFirst(details.statusHistory)
                      : selectTopActivityHistoryEvents(details.statusHistory)
                    ).map((event) =>
                      activityHistoryFullView ? (
                        <div
                          key={event.id}
                          data-testid={`activity-history-audit-${event.id}`}
                          style={{
                            border: "1px solid #e0e3e8",
                            borderRadius: 6,
                            padding: "10px 12px",
                            backgroundColor: "#fff",
                          }}
                        >
                          <p style={{ margin: 0, fontWeight: 700, color: "#111" }}>
                            {event.entityType}{" "}
                            <span style={{ color: "#9ca3af", fontWeight: 400, fontSize: 12 }}>
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
                          <p style={{ margin: "3px 0 0", fontSize: 12, color: "#9ca3af" }}>
                            {formatActivityHistoryMeta(event)}
                          </p>
                          {event.reason ? (
                            <p
                              style={{
                                margin: "6px 0 0",
                                fontSize: 12,
                                color: "#333",
                                backgroundColor: "#f8fafc",
                                padding: "6px 8px",
                                borderRadius: 4,
                                border: "1px solid #e0e3e8",
                              }}
                            >
                              {event.reason}
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <div
                          key={event.id}
                          data-testid={`activity-history-event-${event.id}`}
                          style={{
                            borderLeft: `3px solid ${navy}`,
                            paddingLeft: 10,
                          }}
                        >
                          <p style={{ margin: 0, fontWeight: 600, color: "#111", fontSize: 13 }}>
                            {formatActivityHistoryHeadline(event)}
                          </p>
                          <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6b7280" }}>
                            {formatActivityHistoryMeta(event)}
                          </p>
                        </div>
                      ),
                    )}
                  </div>
                  {(details.statusHistory.length > 3 ||
                    filterCompactActivityHistory(details.statusHistory).length <
                      details.statusHistory.length) ? (
                    <button
                      type="button"
                      data-testid="activity-history-full-toggle"
                      onClick={() => setActivityHistoryFullView((v) => !v)}
                      style={{
                        marginTop: 10,
                        padding: "6px 10px",
                        border: "1px solid #e0e3e8",
                        borderRadius: 4,
                        backgroundColor: "#fff",
                        color: navy,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                        fontFamily: font,
                      }}
                    >
                      {activityHistoryFullView ? "Show Recent Only" : "Show Full History"}
                    </button>
                  ) : null}
                </>
              ) : (
                <p style={{ color: "#9ca3af", fontSize: 13, margin: 0 }}>
                  No activity recorded yet.
                </p>
              )}
            </div>
          ) : null}
        </section>
        {renderDrawerSection(
          "Pickup Events",
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
          </div>,
        )}
      </div>
      {resolveIssueId && (
        <ResolveIssueModal
          issueId={resolveIssueId}
          details={details}
          resolutionType={resolutionType}
          resolutionNote={resolutionNote}
          emailTo={emailTo}
          emailSubject={emailSubject}
          emailBody={emailBody}
          saveVendorEmail={saveVendorEmail}
          mutationLoading={mutationLoading}
          emailProviderConnected={emailProviderConnected}
          emailVendorLoading={emailVendorLoading}
          emailVendorError={emailVendorError}
          emailVendorSuccess={emailVendorSuccess}
          navy={navy}
          font={font}
          onEmailVendor={() => {
            void handleEmailVendor();
          }}
          onEmailToChange={(value) => {
            setEmailFieldsTouched(true);
            setEmailTo(value);
          }}
          onEmailSubjectChange={(value) => {
            setEmailFieldsTouched(true);
            setEmailSubject(value);
          }}
          onEmailBodyChange={(value) => {
            setEmailFieldsTouched(true);
            setEmailBody(value);
          }}
          onSaveVendorEmailChange={setSaveVendorEmail}
          onResolutionTypeChange={(nextType, issue) => {
            setResolutionType(nextType);
            if (nextType === "need_more_information" && !emailFieldsTouched) {
              resetNeedMoreInfoEmailFields(details);
            }
            if (!resolutionNoteTouched) {
              setResolutionNote(
                buildSuggestedResolutionNote(issue, nextType, {
                  orderNumber: details.delivery.orderNumber,
                  jobNumber: job.jobNumber,
                  missingItems: details.items
                    .filter((item) => item.qtyMissing > 0)
                    .map((item) => ({
                      description: item.description,
                      qtyMissing: item.qtyMissing,
                      qtyOrdered: item.qtyOrdered,
                    })),
                }),
              );
            }
          }}
          onResolutionNoteChange={(note, touched) => {
            if (touched) setResolutionNoteTouched(true);
            setResolutionNote(note);
          }}
          onClose={() => setResolveIssueId(null)}
          onSubmit={() => {
            const issueId = resolveIssueId;
            setResolveIssueId(null);
            void onResolveMaterialIssue(issueId, resolutionType, resolutionNote);
          }}
        />
      )}
      {showPrintLabel && (
        <PrintLabelModal
          qrUrl={buildEslTagQrUrl({
            zoneCode: details.stagingLocation?.code ?? null,
            occupancy: details.stagingLocation
              ? {
                  deliveryId: details.delivery.id,
                  orderNumber: details.delivery.orderNumber ?? "",
                  vendorName: details.vendor.name,
                  jobId: details.job.id,
                  status: details.delivery.status,
                }
              : null,
            deliveryId: details.delivery.id,
            options: { forPrint: true },
          })}
          orderNumber={details.delivery.orderNumber ?? ""}
          vendorName={details.vendor.name}
          zoneCode={details.stagingLocation?.code ?? null}
          onClose={() => setShowPrintLabel(false)}
        />
      )}
      {inspectImportError ? (
        <div
          data-testid="drawer-invoice-import-error"
          style={{
            marginTop: 8,
            padding: "8px 10px",
            backgroundColor: "#fef2f2",
            color: "#991b1b",
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          {inspectImportError}
        </div>
      ) : null}
      {inspectImport ? (
        <InvoiceParsedInspectModal
          importRow={inspectImport}
          readOnly
          onClose={() => setInspectImport(null)}
        />
      ) : null}
    </>
  );
}

/* ─── Status Action Panel ────────────────────────────────────────────────── */

function StatusActionPanel({
  details,
  loading,
  error,
  onUpdateStatus,
  onRecordPickup,
  onRevertStatus,
  onMarkShipped,
  onUpdateIssueSummary,
  onUpdateShopStockPickList,
  onUpdateStagingLocation,
  onDeliveryOrderUpdated,
  stagingLocations,
  navy,
  font,
}: {
  details: DeliveryDetails;
  loading: boolean;
  error: string | null;
  onUpdateStatus: (toStatus: DeliveryStatus, reason?: string) => Promise<void>;
  onRecordPickup: (technicianName: string, itemsSummary: string) => Promise<void>;
  onRevertStatus: () => Promise<void>;
  onMarkShipped: () => Promise<void>;
  onUpdateIssueSummary: (summary: string) => Promise<void>;
  onUpdateShopStockPickList: (
    items: string[],
    locationNote: string,
    linkedMappingId?: string,
  ) => Promise<void>;
  onUpdateStagingLocation: (id: string | null) => Promise<void>;
  onDeliveryOrderUpdated: (delivery: DeliveryOrder) => void;
  stagingLocations: StagingLocation[];
  navy: string;
  font: string;
}) {
  const [reason, setReason] = useState("");
  const [showReasonInput, setShowReasonInput] = useState(false);
  const [showPickupInput, setShowPickupInput] = useState(false);
  const [pickupTechnicianName, setPickupTechnicianName] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pickupInputRef = useRef<HTMLInputElement>(null);
  const [editingIssue, setEditingIssue] = useState(false);
  const [editReason, setEditReason] = useState("");
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [pendingLocationId, setPendingLocationId] = useState<string>(
    details.stagingLocation?.id ?? "",
  );
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
  const [stockToolsExpanded, setStockToolsExpanded] = useState(false);
  const [zoneOccupancy, setZoneOccupancy] = useState<
    Record<string, StagingLocationOccupant>
  >({});
  const [stockMappings, setStockMappings] = useState<ShopStockLocationMapping[]>([]);
  const [linkedMappingId, setLinkedMappingId] = useState("");

  useEffect(() => {
    void mapOccupancyByLocationId(details.delivery.id).then(setZoneOccupancy);
  }, [details.delivery.id]);
  useEffect(() => {
    void listShopStockMappings().then(setStockMappings);
  }, [details.delivery.id]);
  const [pickListText, setPickListText] = useState(() =>
    formatShopStockPickListForEditor(details.delivery.shopStockPickListItems),
  );
  const [shopStockLocationNote, setShopStockLocationNote] = useState(
    details.delivery.shopStockLocationNote ?? "",
  );
  const isDirty = pendingLocationId !== (details.stagingLocation?.id ?? "");
  const savedShopStockLocationNote =
    details.delivery.shopStockLocationNote ?? "";
  const parsedPickList = parseShopStockPickListLines(pickListText);
  const savedPickList = details.delivery.shopStockPickListItems ?? [];
  const isPickListDirty =
    parsedPickList.length !== savedPickList.length ||
    parsedPickList.some((line, i) => line !== savedPickList[i]) ||
    shopStockLocationNote.trim() !== savedShopStockLocationNote.trim();

  useEffect(() => {
    setPendingLocationId(details.stagingLocation?.id ?? "");
  }, [details.stagingLocation?.id, details.delivery.id]);

  useEffect(() => {
    setPickListText(
      formatShopStockPickListForEditor(details.delivery.shopStockPickListItems),
    );
    setShopStockLocationNote(details.delivery.shopStockLocationNote ?? "");
  }, [
    details.delivery.id,
    details.delivery.shopStockPickListItems,
    details.delivery.shopStockLocationNote,
  ]);

  useEffect(() => {
    if (showReasonInput) {
      // Small timeout ensures the element is fully mounted in the DOM
      // before focus is called (required on iOS Safari inside fixed overlays)
      const t = setTimeout(() => textareaRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [showReasonInput]);

  useEffect(() => {
    if (showPickupInput) {
      const t = setTimeout(() => pickupInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [showPickupInput]);

  useEffect(() => {
    if (editingIssue) {
      const t = setTimeout(() => editTextareaRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [editingIssue]);

  useEffect(() => {
    if (showReasonInput || showPickupInput || editingIssue) {
      setAdvancedExpanded(true);
    }
  }, [showReasonInput, showPickupInput, editingIssue]);

  const currentStatus = details.delivery.status;
  const possibleNext = VALID_TRANSITIONS[currentStatus] ?? [];
  const revertTarget = DISPATCHER_REVERT_TARGETS[currentStatus];

  const handleActionClick = (nextStatus: DeliveryStatus) => {
    if (nextStatus === "issue") {
      setShowReasonInput(true);
    } else if (nextStatus === "picked_up") {
      setShowPickupInput(true);
    } else {
      void onUpdateStatus(nextStatus);
    }
  };

  const handleConfirmPickup = () => {
    const trimmedName = pickupTechnicianName.trim();
    if (!trimmedName) return;
    const itemCount = details.items.length;
    const summary =
      itemCount === 1 ? "1 item" : `${itemCount} items`;
    void onRecordPickup(trimmedName, summary);
    setShowPickupInput(false);
    setPickupTechnicianName("");
  };

  const handleConfirmIssue = () => {
    if (reason.trim()) {
      void onUpdateStatus("issue", reason.trim());
      setShowReasonInput(false);
      setReason("");
    }
  };

  const handleSaveEdit = () => {
    if (editReason.trim()) {
      void onUpdateIssueSummary(editReason.trim());
      setEditingIssue(false);
    }
  };

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
      {/* ── 1. Assign Staging Location (prominent) ── */}
      <div
        data-testid="staging-location-assignment"
        data-staging-card-state={
          details.stagingLocation ? "assigned" : "unassigned"
        }
        style={{
          padding: "14px 16px",
          borderRadius: 8,
          border: `1.5px solid ${
            details.stagingLocation ? "#a5d6a7" : "#fdba74"
          }`,
          backgroundColor: details.stagingLocation ? "#e8f5e9" : "#fffbeb",
        }}
      >
        {(details.delivery.combinationStagingGroupId ||
          (details.delivery.combinationMemberLocationIds?.length ?? 0) > 0) && (
          <div
            data-testid="combination-staging-group-label"
            style={{
              marginBottom: 12,
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #e0e3e8",
              backgroundColor: "#f9fafb",
            }}
          >
            <p
              style={{
                margin: "0 0 6px",
                fontSize: 11,
                fontWeight: 700,
                color: "#9ca3af",
                textTransform: "uppercase",
                letterSpacing: "0.10em",
              }}
            >
              Combination Staging Group
            </p>
            <p style={{ margin: 0, fontSize: 13, color: "#333" }}>
              {details.delivery.combinationStagingGroupId ?? "—"}
            </p>
            {(details.delivery.combinationMemberLocationIds?.length ?? 0) > 0 && (
              <p style={{ margin: "6px 0 0", fontSize: 12, color: "#6b7280" }}>
                Members:{" "}
                {details.delivery.combinationMemberLocationIds
                  ?.map(
                    (id) =>
                      stagingLocations.find((loc) => loc.id === id)?.code ?? id,
                  )
                  .join(", ")}
              </p>
            )}
          </div>
        )}

        <h3
          data-testid="assign-staging-location-heading"
          style={{
            margin: "0 0 6px",
            fontSize: 14,
            fontWeight: 700,
            color: navy,
            letterSpacing: "0.02em",
          }}
        >
          Assign Staging Location
        </h3>
        <p
          style={{
            margin: "0 0 10px",
            fontSize: 13,
            color: "#6b7280",
            lineHeight: 1.45,
            fontFamily: font,
          }}
        >
          Choose where this delivery will be staged for receiving and pickup.
        </p>
        <p
          data-testid="staging-current-location"
          style={{
            margin: "0 0 12px",
            fontSize: 13,
            fontWeight: 600,
            color: details.stagingLocation ? "#2e7d32" : "#ea580c",
            fontFamily: font,
            lineHeight: 1.5,
          }}
        >
          {details.stagingLocation ? (
            <>
              Current:{" "}
              <span
                data-testid="staging-assigned-code"
                style={{
                  fontFamily: "monospace",
                  fontWeight: 700,
                  backgroundColor: "#fff",
                  padding: "2px 8px",
                  borderRadius: 4,
                  color: "#2e7d32",
                  border: "1px solid #a5d6a7",
                }}
              >
                {details.stagingLocation.code}
              </span>
              <span style={{ color: "#4b5563", fontWeight: 500 }}>
                {" "}
                {details.stagingLocation.label}
              </span>
            </>
          ) : (
            <>Current: Not Assigned</>
          )}
        </p>
        <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
          <select
            data-testid="staging-location-select"
            value={pendingLocationId}
            onChange={(e) => setPendingLocationId(e.target.value)}
            disabled={loading}
            style={{
              flex: 1,
              padding: "10px 12px",
              border: isDirty ? `2px solid ${navy}` : "1.5px solid #ccd0d7",
              borderRadius: 6,
              fontSize: 14,
              fontFamily: font,
              color: "#333",
              backgroundColor: loading ? "#f9fafb" : "#fff",
              outline: "none",
              cursor: loading ? "not-allowed" : "pointer",
              minHeight: 44,
            }}
          >
            <option value="">— Unassigned —</option>
            {stagingLocations.map((loc) => {
              const occupant = zoneOccupancy[loc.id];
              const inUse = Boolean(occupant);
              return (
                <option
                  key={loc.id}
                  value={loc.id}
                  disabled={inUse}
                  data-staging-occupied={inUse ? "true" : undefined}
                  style={{ color: inUse ? "#bf0a30" : "#333" }}
                >
                  {loc.code} — {loc.label}
                  {inUse ? ` (in use: ${occupant.orderNumber})` : ""}
                </option>
              );
            })}
          </select>
          <button
            onClick={() =>
              void onUpdateStagingLocation(pendingLocationId || null)
            }
            disabled={loading || !isDirty}
            style={{
              padding: "10px 18px",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 700,
              fontFamily: font,
              cursor: loading || !isDirty ? "not-allowed" : "pointer",
              backgroundColor: loading || !isDirty ? "#f3f4f6" : navy,
              color: loading || !isDirty ? "#9ca3af" : "#fff",
              border: `1.5px solid ${loading || !isDirty ? "#d1d5db" : navy}`,
              transition: "all 0.13s",
              whiteSpace: "nowrap",
              minHeight: 44,
            }}
          >
            {loading ? "Saving…" : "Assign"}
          </button>
        </div>
        <p
          data-testid="staging-location-occupied-helper"
          style={{
            margin: "8px 0 0",
            fontSize: 12,
            color: "#6b7280",
            lineHeight: 1.4,
          }}
        >
          Red locations are already assigned to another delivery.
        </p>
        {!DRAWER_HIDE_NEED_MORE_SPACE &&
          getAllStagingLocationIds(details.delivery).length > 0 && (
            <div style={{ marginTop: 12 }}>
              <NeedMoreSpaceButton
                delivery={details.delivery}
                onDeliveryUpdated={(updated) => {
                  onDeliveryOrderUpdated(updated);
                  void mapOccupancyByLocationId(updated.id).then(setZoneOccupancy);
                }}
              />
            </div>
          )}
      </div>

      {/* ── 2. Advanced Manual Controls (collapsed default) ── */}
      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          data-testid="advanced-manual-controls-toggle"
          aria-expanded={advancedExpanded}
          onClick={() => setAdvancedExpanded((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            width: "100%",
            padding: "8px 0",
            border: "none",
            background: "none",
            cursor: "pointer",
            fontFamily: font,
            fontSize: 11,
            fontWeight: 700,
            color: "#9ca3af",
            letterSpacing: "0.04em",
            textAlign: "left",
          }}
        >
          <span style={{ fontSize: 10, color: "#64748b" }}>
            {advancedExpanded ? "▼" : "▶"}
          </span>
          <span data-testid="manual-controls-heading">Advanced Manual Controls</span>
        </button>
        <p
          style={{
            margin: "0 0 8px",
            fontSize: 12,
            color: "#6b7280",
            lineHeight: 1.45,
            fontFamily: font,
          }}
        >
          Use only for admin correction or demo recovery.
        </p>
        {advancedExpanded && (
          <div data-testid="advanced-manual-controls-section">
      {currentStatus === "pending" && !showReasonInput && !showPickupInput && (
        <div style={{ marginBottom: 12 }}>
          <button
            onClick={() => void onMarkShipped()}
            disabled={loading}
            style={{
              backgroundColor: loading ? "#f3f4f6" : navy,
              color: loading ? "#9ca3af" : "#fff",
              border: `1.5px solid ${loading ? "#d1d5db" : navy}`,
              borderRadius: 4,
              padding: "8px 14px",
              fontSize: 12,
              fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              fontFamily: font,
              transition: "all 0.13s",
            }}
          >
            {loading ? "Updating…" : "Mark Shipped"}
          </button>
        </div>
      )}

      {(possibleNext.length > 0 || revertTarget) &&
        !showReasonInput &&
        !showPickupInput && (
        <div
          data-testid="manual-controls-section"
          style={{
            marginTop: 16,
            padding: "12px",
            borderRadius: 8,
            border: "1px dashed #d1d5db",
            backgroundColor: "#fafafa",
          }}
        >
          {possibleNext.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {possibleNext.map((status) => (
                <button
                  key={status}
                  onClick={() => handleActionClick(status)}
                  disabled={loading}
                  style={{
                    backgroundColor: loading ? "#f3f4f6" : "#fff",
                    color: loading ? "#9ca3af" : "#6b7280",
                    border: `1px solid ${loading ? "#d1d5db" : "#d1d5db"}`,
                    borderRadius: 4,
                    padding: "5px 10px",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: loading ? "not-allowed" : "pointer",
                    fontFamily: font,
                    transition: "all 0.13s",
                  }}
                >
                  {loading ? "Updating…" : `Mark ${STATUS_LABEL(status)}`}
                </button>
              ))}
            </div>
          )}
          {revertTarget && (
            <div style={{ marginTop: possibleNext.length > 0 ? 10 : 0 }}>
              <button
                onClick={() => void onRevertStatus()}
                disabled={loading}
                style={{
                  backgroundColor: loading ? "#f3f4f6" : "#fff",
                  color: loading ? "#9ca3af" : "#9ca3af",
                  border: `1px solid ${loading ? "#d1d5db" : "#d1d5db"}`,
                  borderRadius: 4,
                  padding: "5px 10px",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: loading ? "not-allowed" : "pointer",
                  fontFamily: font,
                  transition: "all 0.13s",
                }}
              >
                {loading ? "Updating…" : `Revert to ${STATUS_LABEL(revertTarget)}`}
              </button>
            </div>
          )}
        </div>
      )}

      {showPickupInput && (
        <div>
          <h3
            style={{
              margin: "16px 0 8px",
              fontSize: 11,
              fontWeight: 700,
              color: navy,
              textTransform: "uppercase",
              letterSpacing: "0.10em",
            }}
          >
            Record Pickup
          </h3>
          <label
            htmlFor="dispatcher-pickup-name"
            style={{
              display: "block",
              marginBottom: 6,
              fontSize: 12,
              fontWeight: 600,
              color: "#374151",
              fontFamily: font,
            }}
          >
            Technician name
          </label>
          <input
            ref={pickupInputRef}
            id="dispatcher-pickup-name"
            type="text"
            autoFocus
            value={pickupTechnicianName}
            onChange={(e) => setPickupTechnicianName(e.target.value)}
            placeholder="Enter technician name"
            disabled={loading}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "8px 12px",
              border: "1.5px solid #ccd0d7",
              borderRadius: 6,
              fontSize: 14,
              fontFamily: font,
              color: "#111",
              backgroundColor: "#fff",
              outline: "none",
              marginBottom: 8,
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleConfirmPickup}
              disabled={loading || !pickupTechnicianName.trim()}
              style={{
                backgroundColor:
                  loading || !pickupTechnicianName.trim() ? "#f3f4f6" : navy,
                color:
                  loading || !pickupTechnicianName.trim() ? "#9ca3af" : "#fff",
                border: `1.5px solid ${
                  loading || !pickupTechnicianName.trim() ? "#d1d5db" : navy
                }`,
                borderRadius: 4,
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 700,
                cursor:
                  loading || !pickupTechnicianName.trim()
                    ? "not-allowed"
                    : "pointer",
                fontFamily: font,
              }}
            >
              {loading ? "Saving..." : "Confirm Pickup"}
            </button>
            <button
              onClick={() => {
                setShowPickupInput(false);
                setPickupTechnicianName("");
              }}
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
            ref={textareaRef}
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Briefly describe the issue..."
            disabled={false}
            style={{
              width: "100%",
              boxSizing: "border-box",
              minHeight: 60,
              padding: "8px 12px",
              border: "1.5px solid #ccd0d7",
              borderRadius: 6,
              fontSize: 14,
              fontFamily: font,
              color: "#111",
              backgroundColor: "#fff",
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
              onClick={() => {
                setShowReasonInput(false);
                setReason("");
              }}
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

      {currentStatus === "issue" && !editingIssue && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <h3
              style={{
                margin: 0,
                fontSize: 11,
                fontWeight: 700,
                color: "#c62828",
                textTransform: "uppercase",
                letterSpacing: "0.10em",
              }}
            >
              Issue Summary
            </h3>
            <button
              onClick={() => {
                setEditReason(details.delivery.issueSummary ?? "");
                setEditingIssue(true);
              }}
              disabled={loading}
              style={{
                background: "none",
                border: "none",
                color: "#2563eb",
                fontSize: 12,
                fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer",
                padding: "2px 0",
                fontFamily: font,
                textDecoration: "underline",
              }}
            >
              Edit
            </button>
          </div>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: "#374151",
              backgroundColor: "#fff1f2",
              border: "1px solid #fecaca",
              borderRadius: 6,
              padding: "8px 12px",
              fontFamily: font,
              lineHeight: 1.5,
            }}
          >
            {details.delivery.issueSummary || <em style={{ color: "#9ca3af" }}>No summary recorded.</em>}
          </p>
        </div>
      )}

      {currentStatus === "issue" && editingIssue && (
        <div style={{ marginTop: 12 }}>
          <h3
            style={{
              margin: "0 0 8px",
              fontSize: 11,
              fontWeight: 700,
              color: "#c62828",
              textTransform: "uppercase",
              letterSpacing: "0.10em",
            }}
          >
            Edit Issue Summary
          </h3>
          <textarea
            ref={editTextareaRef}
            autoFocus
            value={editReason}
            onChange={(e) => setEditReason(e.target.value)}
            placeholder="Describe the issue..."
            style={{
              width: "100%",
              boxSizing: "border-box",
              minHeight: 60,
              padding: "8px 12px",
              border: "1.5px solid #fca5a5",
              borderRadius: 6,
              fontSize: 14,
              fontFamily: font,
              color: "#111",
              backgroundColor: "#fff",
              outline: "none",
              marginBottom: 8,
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleSaveEdit}
              disabled={loading || !editReason.trim()}
              style={{
                backgroundColor: loading || !editReason.trim() ? "#f3f4f6" : "#c62828",
                color: loading || !editReason.trim() ? "#9ca3af" : "#fff",
                border: `1.5px solid ${loading || !editReason.trim() ? "#d1d5db" : "#c62828"}`,
                borderRadius: 4,
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 700,
                cursor: loading || !editReason.trim() ? "not-allowed" : "pointer",
                fontFamily: font,
              }}
            >
              {loading ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => { setEditingIssue(false); setEditReason(""); }}
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
          </div>
        )}
      </div>

      {/* ── 3. Experimental Stock Tools (collapsed default) ── */}
      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          data-testid="experimental-stock-tools-toggle"
          aria-expanded={stockToolsExpanded}
          onClick={() => setStockToolsExpanded((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            width: "100%",
            padding: "8px 0",
            border: "none",
            background: "none",
            cursor: "pointer",
            fontFamily: font,
            fontSize: 11,
            fontWeight: 700,
            color: "#9ca3af",
            letterSpacing: "0.04em",
            textAlign: "left",
          }}
        >
          <span style={{ fontSize: 10, color: "#64748b" }}>
            {stockToolsExpanded ? "▼" : "▶"}
          </span>
          Experimental Stock Tools
        </button>
        <p
          style={{
            margin: "0 0 8px",
            fontSize: 12,
            color: "#6b7280",
            lineHeight: 1.45,
            fontFamily: font,
          }}
        >
          Early concept for tracking shop-stock items used on jobs. Not part of the
          main delivery workflow yet.
        </p>
        {stockToolsExpanded && (
          <div data-testid="experimental-stock-tools-section">
        {stockMappings.filter((m) => m.active).length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <label
              htmlFor="shop-stock-directory-link"
              style={{
                display: "block",
                marginBottom: 6,
                fontSize: 12,
                fontWeight: 600,
                color: "#374151",
                fontFamily: font,
              }}
            >
              Stock directory (optional)
            </label>
            <select
              id="shop-stock-directory-link"
              value={linkedMappingId}
              onChange={(e) => {
                const nextId = e.target.value;
                setLinkedMappingId(nextId);
                const mapping = stockMappings.find((m) => m.id === nextId);
                if (mapping) {
                  setShopStockLocationNote(formatMappingLocationHeader(mapping));
                }
              }}
              disabled={loading}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "7px 10px",
                border: "1.5px solid #ccd0d7",
                borderRadius: 6,
                fontSize: 13,
                fontFamily: font,
                color: "#333",
                backgroundColor: loading ? "#f9fafb" : "#fff",
              }}
            >
              <option value="">— Manual location note —</option>
              {stockMappings
                .filter((m) => m.active)
                .map((mapping) => (
                  <option key={mapping.id} value={mapping.id}>
                    {formatMappingLocationHeader(mapping)}
                  </option>
                ))}
            </select>
          </div>
        )}
        <label
          htmlFor="shop-stock-pick-list"
          style={{
            display: "block",
            marginBottom: 6,
            fontSize: 12,
            fontWeight: 600,
            color: "#374151",
            fontFamily: font,
          }}
        >
          Pick list items
        </label>
        <textarea
          id="shop-stock-pick-list"
          value={pickListText}
          onChange={(e) => setPickListText(e.target.value)}
          disabled={loading}
          placeholder={'1 stick 2" PVC\n2 cans PVC glue\n1 roll foil tape'}
          rows={5}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "8px 12px",
            border: isPickListDirty ? `1.5px solid ${navy}` : "1.5px solid #ccd0d7",
            borderRadius: 6,
            fontSize: 13,
            fontFamily: font,
            color: "#111",
            backgroundColor: loading ? "#f9fafb" : "#fff",
            outline: "none",
            marginBottom: 10,
            lineHeight: 1.45,
          }}
        />
        <label
          htmlFor="shop-stock-location-note"
          style={{
            display: "block",
            marginBottom: 6,
            fontSize: 12,
            fontWeight: 600,
            color: "#374151",
            fontFamily: font,
          }}
        >
          Location note (optional)
        </label>
        <input
          id="shop-stock-location-note"
          type="text"
          value={shopStockLocationNote}
          onChange={(e) => setShopStockLocationNote(e.target.value)}
          disabled={loading}
          placeholder="Main shop stock area"
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "7px 10px",
            border: isPickListDirty
              ? `1.5px solid ${navy}`
              : "1.5px solid #ccd0d7",
            borderRadius: 6,
            fontSize: 13,
            fontFamily: font,
            color: "#333",
            backgroundColor: loading ? "#f9fafb" : "#fff",
            outline: "none",
            marginBottom: 8,
          }}
        />
        <button
          type="button"
          onClick={() =>
            void onUpdateShopStockPickList(
              parseShopStockPickListLines(pickListText),
              shopStockLocationNote,
              linkedMappingId || undefined,
            )
          }
          disabled={loading || !isPickListDirty}
          style={{
            padding: "7px 14px",
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 700,
            fontFamily: font,
            cursor: loading || !isPickListDirty ? "not-allowed" : "pointer",
            backgroundColor: loading || !isPickListDirty ? "#f3f4f6" : navy,
            color: loading || !isPickListDirty ? "#9ca3af" : "#fff",
            border: `1.5px solid ${loading || !isPickListDirty ? "#d1d5db" : navy}`,
            transition: "all 0.13s",
          }}
        >
          {loading ? "Saving…" : "Save Pick List"}
        </button>
          </div>
        )}
      </div>

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
