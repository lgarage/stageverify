import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { clearPickupTokenForJob } from "../../pickupTokenSession";
import {
  firestoreDataService,
  sendVendorEmail,
  listVendorEmailEventsForDelivery,
  listShopStockMappings,
  fetchVendorInvoiceImportById,
  approveVendorInvoiceImport,
  INVOICE_TRAINING_LESSON_TOAST,
} from "../firestoreService";
import { useDispatcherPortal } from "../DispatcherPortalContext";
import {
  formatShopStockPickListForEditor,
  parseShopStockPickListLines,
} from "../shopStockPickList";
import { formatMappingLocationHeader } from "../shopStockMapping";
import {
  DISPATCHER_REVERT_TARGETS,
  VALID_TRANSITIONS,
  type DeliveryDetails,
  type DeliveryListRow,
  type DeliveryOrder,
  type DeliveryStatus,
  type Item,
  type PickupEvent,
  type StagingLocation,
} from "../index";
import {
  ISSUE_RESOLUTION_TYPE_LABEL,
  MATERIAL_ISSUE_TYPE_LABEL,
  DELIVERY_STATUS_LABEL,
  type IssueResolutionType,
  type MaterialIssue,
  type ShopStockLocationMapping,
} from "../models";
import { ReadinessEvidencePanel } from "../email/ReadinessEvidencePanel";
import { DrawerActionBanner } from "./DrawerActionBanner";
import { StagingLocationBanner } from "./StagingLocationBanner";
import { JobReleaseToTechnicianPanel } from "./JobReleaseToTechnicianPanel";
import {
  DrawerStagingLocationChips,
  collectDeliveryStagingCodes,
  hasActiveShopStagingAssignment,
  hasRawShopStagingRefs,
  isShopStagingAssignmentMissing,
} from "./DrawerStagingLocationChips";
import { IssueSummaryPanel } from "./IssueSummaryPanel";
import { useLiveZoneOccupancy } from "../useLiveZoneOccupancy";
import {
  shouldShowPickupSummaryPanel,
  selectTopActivityHistoryEvents,
  filterCompactActivityHistory,
  sortActivityHistoryNewestFirst,
  formatActivityHistoryHeadline,
  formatActivityHistoryMeta,
  computeDeliveryDisplayState,
  isWillCallPickupStagingListNa,
  UNPLANNED_BADGE,
} from "../deliveryDisplayHelpers";
import {
  fulfillmentDisplayLabel,
  resolveDeliveryPoNumber,
} from "../invoice/invoiceShellDisplayHelpers";
import {
  buildNeedMoreInfoEmailBody,
  buildNeedMoreInfoEmailSubject,
} from "./needMoreInfoDraft";
import {
  inboundReplyHeaders,
  latestTrustedInboundVendorEmailEvent,
  parseEmailList,
  primaryRecipientFromEvents,
  replySubjectFromInbound,
} from "../email/vendorEmailComposeHelpers";
import { ResolveIssueModal } from "./ResolveIssueModal";
import { VendorCommunicationsPanel } from "./VendorCommunicationsPanel";
import { VendorCommunicationsModal } from "./VendorCommunicationsModal";
import { mergeVendorIntoList } from "./vendorCommsPrefillHelpers";
import {
  buildVendorCommsIssueBody,
  buildVendorCommsIssueSubject,
} from "./vendorCommsIssueDraft";
import { CreditReturnDeliveryBanner } from "./CreditReturnDeliveryBanner";
import {
  buildDeliveryDrawerRejectLessonNote,
  isCreditReturnLinkedImport,
  linkedImportRejectBlockedReason,
} from "../invoice/deliveryCreditReturn";
import { InvoiceRejectReasonDialog } from "../invoice/InvoiceRejectReasonDialog";
import {
  defaultRejectReasonId,
  type InvoiceRejectReasonId,
} from "../invoice/invoiceRejectReasons";
import type { VendorInvoiceImportReview } from "../models";
import {
  buildSuggestedResolutionNote,
  defaultResolutionTypeForIssue,
} from "./resolveIssueDefaults";

/** Drawer UI simplification (away-080) — sections hidden pending redesign; logic preserved. */
const DRAWER_HIDE_VENDOR_COMMUNICATIONS = true;
const DRAWER_HIDE_RESOLVED_MATERIAL_ISSUES = true;

const DRAWER_ACTION_BTN_BASE = {
  minHeight: "var(--admin-control-height)",
  borderRadius: "var(--admin-control-radius)",
  padding: "8px 10px",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  transition: "all 0.13s",
  width: "100%",
  textAlign: "center" as const,
  boxSizing: "border-box" as const,
};

function drawerActionBtnRevoke(font: string, disabled: boolean) {
  return {
    ...DRAWER_ACTION_BTN_BASE,
    fontFamily: font,
    backgroundColor: "var(--admin-surface)",
    color: "var(--admin-danger-text)",
    border: "1.5px solid #b91c1c",
    cursor: disabled ? "wait" : "pointer",
    opacity: disabled ? 0.7 : 1,
  };
}

function resolvedIssueShortSummary(issue: MaterialIssue): string {
  if (issue.resolutionType) {
    return ISSUE_RESOLUTION_TYPE_LABEL[issue.resolutionType];
  }
  const desc = issue.description?.trim();
  if (desc) return desc.length > 80 ? `${desc.slice(0, 80)}…` : desc;
  return "Issue resolved";
}

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
  void _font;
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

export function DetailContent({
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
  onUpdateFulfillmentMethod,
  onStatusAndAssignSpot,
  onUpdateIssueSummary,
  onSetDeliverToSiteConfirmed,
  onUpdateItemReceiptStatus,
  onUpdateShopStockPickList,
  stagingLocations,
  stagingLocationsReady = true,
  onResolveMaterialIssue,
  emailProviderConnected,
  onNavigateToAssignLocation,
  onNavigateToStagingMap,
  onJobReleased,
  onImportRejected,
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
  onUpdateFulfillmentMethod: (
    method: "delivery" | "will_call_pickup",
  ) => Promise<void>;
  onStatusAndAssignSpot: (spotId: string) => Promise<void>;
  onUpdateIssueSummary: (summary: string) => Promise<void>;
  onSetDeliverToSiteConfirmed: (confirmed: boolean) => Promise<void>;
  onUpdateItemReceiptStatus: (
    itemId: string,
    status: "Not Delivered" | "Delivered",
  ) => Promise<void>;
  onUpdateShopStockPickList: (
    items: string[],
    locationNote: string,
    linkedMappingId?: string,
  ) => Promise<void>;
  stagingLocations: StagingLocation[];
  /** False until Active staging catalog fetch completes (avoids banner flash). */
  stagingLocationsReady?: boolean;
  onResolveMaterialIssue: (
    issueId: string,
    resolutionType: IssueResolutionType,
    resolutionNote: string,
  ) => Promise<void>;
  emailProviderConnected: boolean;
  onNavigateToAssignLocation?: (deliveryId: string) => void;
  onNavigateToStagingMap?: (spotCode: string) => void;
  onJobReleased?: () => void | Promise<void>;
  onImportRejected?: () => void | Promise<void>;
}) {
  const [resolveIssueId, setResolveIssueId] = useState<string | null>(null);
  const [resolutionType, setResolutionType] =
    useState<IssueResolutionType>("found_in_shop");
  const [resolutionNote, setResolutionNote] = useState("");
  const [resolutionNoteTouched, setResolutionNoteTouched] = useState(false);
  const [emailVendorLoading, setEmailVendorLoading] = useState(false);
  const [emailVendorError, setEmailVendorError] = useState<string | null>(null);
  const [emailVendorSuccess, setEmailVendorSuccess] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailCc, setEmailCc] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailReplyHeaders, setEmailReplyHeaders] = useState<{
    replyThreadId?: string;
    inReplyTo?: string;
    references?: string[];
  }>({});
  const [saveVendorEmail, setSaveVendorEmail] = useState(false);
  const [emailFieldsTouched, setEmailFieldsTouched] = useState(false);
  const [vendorCommsRefresh, setVendorCommsRefresh] = useState(0);
  const [vendorCommsExpandSignal, setVendorCommsExpandSignal] = useState(0);
  const [emailEvidenceExpandSignal, setEmailEvidenceExpandSignal] = useState(0);
  const [activityHistoryExpanded, setActivityHistoryExpanded] = useState(false);
  const [activityHistoryFullView, setActivityHistoryFullView] = useState(false);
  const [expandedResolvedIssueIds, setExpandedResolvedIssueIds] = useState<
    Set<string>
  >(new Set());
  const [drawerEmailModalOpen, setDrawerEmailModalOpen] = useState(false);
  const [linkedImport, setLinkedImport] =
    useState<VendorInvoiceImportReview | null>(null);
  const [linkedImportLoading, setLinkedImportLoading] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReasonId, setRejectReasonId] = useState<
    InvoiceRejectReasonId | ""
  >("");
  const [rejectDetailText, setRejectDetailText] = useState("");
  const [rejectActionLoading, setRejectActionLoading] = useState(false);
  const [importRejectToast, setImportRejectToast] = useState<string | null>(
    null,
  );
  const [showPickupInput, setShowPickupInput] = useState(false);
  const [pendingStatusSelection, setPendingStatusSelection] =
    useState<DeliveryStatus | null>(null);
  const [pickupTechnicianName, setPickupTechnicianName] = useState("");
  const { vendors: portalVendors } = useDispatcherPortal();
  const liveOccupancy = useLiveZoneOccupancy(Boolean(details));

  useEffect(() => {
    setActivityHistoryExpanded(false);
    setActivityHistoryFullView(false);
    setDrawerEmailModalOpen(false);
    setRejectDialogOpen(false);
    setRejectReasonId("");
    setRejectDetailText("");
    setImportRejectToast(null);
    setShowPickupInput(false);
    setPendingStatusSelection(null);
    setPickupTechnicianName("");
  }, [details?.delivery.id]);

  useEffect(() => {
    const importId = details?.delivery.vendorInvoiceImportId?.trim();
    if (!importId) {
      setLinkedImport(null);
      setLinkedImportLoading(false);
      return;
    }
    let cancelled = false;
    setLinkedImportLoading(true);
    void fetchVendorInvoiceImportById(importId)
      .then((row) => {
        if (!cancelled) setLinkedImport(row);
      })
      .catch(() => {
        if (!cancelled) setLinkedImport(null);
      })
      .finally(() => {
        if (!cancelled) setLinkedImportLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [details?.delivery.vendorInvoiceImportId]);

  const vendorCommsInitialSubject = useMemo(
    () => (details ? buildVendorCommsIssueSubject(details) : ""),
    [details],
  );
  const vendorCommsInitialBody = useMemo(
    () => (details ? buildVendorCommsIssueBody(details) : ""),
    [details],
  );

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

  const resetNeedMoreInfoEmailFields = async (deliveryDetails: DeliveryDetails) => {
    setEmailCc("");
    setEmailReplyHeaders({});
    setSaveVendorEmail(false);
    setEmailFieldsTouched(false);
    setEmailBody(buildNeedMoreInfoEmailBody(deliveryDetails) ?? "");
    const vendorEmailOnFile = deliveryDetails.vendor.email?.trim() ?? "";
    setEmailTo(vendorEmailOnFile);
    setEmailSubject(buildNeedMoreInfoEmailSubject(deliveryDetails));
    try {
      const events = await listVendorEmailEventsForDelivery(
        deliveryDetails.delivery.id,
      );
      const inbound = latestTrustedInboundVendorEmailEvent(events);
      const primaryTo = primaryRecipientFromEvents(events, vendorEmailOnFile);
      if (primaryTo) {
        setEmailTo(primaryTo);
      }
      if (inbound) {
        setEmailReplyHeaders(inboundReplyHeaders(inbound));
        setEmailSubject(
          replySubjectFromInbound(
            inbound,
            buildNeedMoreInfoEmailSubject(deliveryDetails),
          ),
        );
      }
    } catch {
      setEmailTo(vendorEmailOnFile);
    }
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
    void resetNeedMoreInfoEmailFields(details);
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
    const cc = parseEmailList(emailCc).filter(
      (email) => email !== toNormalized,
    );
    try {
      await sendVendorEmail({
        deliveryOrderId: details.delivery.id,
        materialIssueId: resolveIssueId,
        to,
        cc: cc.length > 0 ? cc : undefined,
        subject,
        body,
        saveVendorEmail: needsSave ? saveVendorEmail : undefined,
        ...emailReplyHeaders,
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
        <div style={{ color: "var(--admin-text-muted)", fontSize: 14 }}>
          Loading detail panel…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          backgroundColor: "var(--admin-danger-bg)",
          border: "1px solid var(--admin-danger-border)",
          borderRadius: 6,
          padding: "15px",
          color: "var(--admin-danger-text)",
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
        <p style={{ fontWeight: 700, fontSize: 16, color: "var(--admin-text)", margin: 0 }}>
          No delivery selected
        </p>
        <p style={{ fontSize: 13, color: "var(--admin-text-muted)", marginTop: 6 }}>
          Click a row in the table to view details.
        </p>
      </div>
    );
  }

  const job = details.job;
  const delivery = details.delivery;
  const itemsReceivedTotal = details.items.reduce(
    (sum, item) => sum + item.qtyReceived,
    0,
  );
  const itemsOrderedTotal = details.items.reduce(
    (sum, item) => sum + item.qtyOrdered,
    0,
  );
  const drawerStagingLocById = new Map(
    stagingLocations.map((loc) => [loc.id, loc]),
  );
  const willCallNoShopStaging = isWillCallPickupStagingListNa(delivery);
  /** Resolvable active staging only — stale id strings do not count. */
  const hasAssignedStaging = hasActiveShopStagingAssignment(
    delivery,
    drawerStagingLocById,
  );
  /**
   * Avoid a false staging-needed flash while the Active location catalog is
   * still loading (empty map would treat raw staging ids as unresolved).
   */
  const showStagingLocationBanner =
    stagingLocationsReady &&
    isShopStagingAssignmentMissing(delivery, drawerStagingLocById);
  const staleWillCallStaging =
    willCallNoShopStaging && hasRawShopStagingRefs(delivery);
  const drawerDeliveryRow: DeliveryListRow = {
    deliveryId: delivery.id,
    jobId: delivery.jobId ?? "",
    status: delivery.status,
    statusDisplayLabel:
      DELIVERY_STATUS_LABEL[delivery.status] ?? delivery.status,
    jobNumber: job?.jobNumber ?? "—",
    jobName: job?.jobName ?? "Needs job match",
    vendorInvoiceNumber: delivery.vendorInvoiceNumber?.trim() || undefined,
    poNumber:
      resolveDeliveryPoNumber(
        delivery.customerPoOrReference,
        details.purchaseOrder?.poNumber,
      ) ?? undefined,
    orderNumber: delivery.orderNumber,
    fulfillmentDisplayLabel: fulfillmentDisplayLabel(delivery),
    vendorName: details.vendor.name,
    deliveryDate: delivery.deliveryDate ?? "",
    stagingLocationCode: details.stagingLocation?.code,
    stagingLocationCodes: collectDeliveryStagingCodes(
      delivery,
      drawerStagingLocById,
    ),
    itemsReceivedLabel: `${itemsReceivedTotal}/${itemsOrderedTotal}`,
    issueSummary: delivery.issueSummary ?? "",
    openIssueCount: details.materialIssues.filter(
      (issue) => issue.status === "open" || issue.status === "assigned",
    ).length,
    missingStagingAssignment: showStagingLocationBanner,
    stagingLocationListNotApplicable: willCallNoShopStaging,
  };

  const showCreditReturnBanner =
    linkedImport != null && isCreditReturnLinkedImport(linkedImport);

  const openRejectDialog = () => {
    setRejectReasonId(
      defaultRejectReasonId(
        linkedImport ? isCreditReturnLinkedImport(linkedImport) : false,
      ),
    );
    setRejectDetailText("");
    setRejectDialogOpen(true);
  };

  const closeRejectDialog = () => {
    if (rejectActionLoading) return;
    setRejectDialogOpen(false);
    setRejectReasonId("");
    setRejectDetailText("");
  };

  const showCompletePickupCta =
    !showPickupInput &&
    delivery.status !== "picked_up" &&
    delivery.status !== "installed" &&
    drawerStatusOptionEnabled(delivery.status, "picked_up", delivery);
  const completePickupMissingJob = !delivery.jobId?.trim();

  const openCompletePickupForm = () => {
    setPendingStatusSelection("picked_up");
    setShowPickupInput(true);
    requestAnimationFrame(() => {
      document
        .querySelector('[data-testid="delivery-status-pickup-input"]')
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  };

  const confirmRejectLinkedImport = async () => {
    if (!rejectReasonId || !delivery.vendorInvoiceImportId?.trim()) return;
    const lessonNote = buildDeliveryDrawerRejectLessonNote(
      rejectReasonId,
      rejectDetailText,
    );
    setRejectActionLoading(true);
    setImportRejectToast(null);
    try {
      const result = await approveVendorInvoiceImport({
        vendorInvoiceImportId: delivery.vendorInvoiceImportId.trim(),
        action: "reject",
        correctionNote: lessonNote,
      });
      if (result.trainingLessonWrote) {
        setImportRejectToast(INVOICE_TRAINING_LESSON_TOAST);
      } else if (result.trainingLessonPendingAdminReview) {
        setImportRejectToast(
          "This note is pending Admin review — patterns may need a fix before it can be saved.",
        );
      } else {
        setImportRejectToast("Linked import moved to Rejected Invoices.");
      }
      setLinkedImport((prev) =>
        prev
          ? {
              ...prev,
              reviewStatus: "rejected",
              skipReason: "credit_return",
            }
          : prev,
      );
      setRejectDialogOpen(false);
      setRejectReasonId("");
      setRejectDetailText("");
      await onImportRejected?.();
    } catch (err) {
      setImportRejectToast(
        err instanceof Error ? err.message : "Failed to reject linked import.",
      );
    } finally {
      setRejectActionLoading(false);
    }
  };

  const handleAssignLocationNavigate = () => {
    if (!onNavigateToAssignLocation) return;
    const targetId = delivery.id?.trim();
    if (!targetId) return;
    onNavigateToAssignLocation(targetId);
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
        className="admin-section-label"
        style={{
          margin: "0 0 10px",
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
        {showCreditReturnBanner ? (
          <CreditReturnDeliveryBanner
            importRow={linkedImport}
            importId={delivery.vendorInvoiceImportId}
            importLoading={linkedImportLoading}
            font={font}
          />
        ) : null}
        {importRejectToast ? (
          <p
            data-testid="delivery-import-reject-toast"
            style={{
              margin: 0,
              fontSize: 12,
              color: importRejectToast.includes("Failed") ? "var(--admin-danger-text)" : "var(--admin-success-text)",
              backgroundColor: importRejectToast.includes("Failed")
                ? "var(--admin-danger-bg)"
                : "var(--admin-success-bg)",
              border: `1px solid ${importRejectToast.includes("Failed") ? "var(--admin-danger-border)" : "#bbf7d0"}`,
              borderRadius: 6,
              padding: "8px 12px",
            }}
          >
            {importRejectToast}
          </p>
        ) : null}
        {renderDrawerSection(
          "Delivery Basics",
          <>
            <div
              data-testid="delivery-basics-card"
              style={{
                backgroundColor: "var(--admin-surface-2)",
                border: "1px solid var(--admin-border)",
                borderRadius: 8,
                padding: "15px",
                color: "var(--admin-text)",
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
                    <span
                      data-testid="delivery-basics-job-number"
                      style={{ fontFamily: "monospace", fontWeight: 700 }}
                    >
                      {job?.jobNumber ?? "—"}
                    </span>
                  ),
                },
                {
                  label: "Job Name",
                  value: (
                    <span data-testid="delivery-basics-job-name">
                      {job?.jobName ?? "Needs job match"}
                    </span>
                  ),
                },
                {
                  label: "Order #",
                  value: (
                    <span
                      data-testid="delivery-basics-order-number"
                      style={{ fontFamily: "monospace", fontWeight: 700 }}
                    >
                      {details.delivery.orderNumber || "—"}
                    </span>
                  ),
                },
                {
                  label: "Vendor",
                  value: (
                    <span data-testid="delivery-basics-vendor">
                      {details.vendor.name}
                    </span>
                  ),
                },
                {
                  label: "PO #",
                  value: (
                    <span
                      data-testid="delivery-basics-po-number"
                      style={{ fontFamily: "monospace" }}
                    >
                      {resolveDeliveryPoNumber(
                        details.delivery.customerPoOrReference,
                        details.purchaseOrder?.poNumber,
                      ) ?? "—"}
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
                      color: "var(--admin-text-label)",
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {label}
                  </span>
                  <span style={{ color: "var(--admin-text-data)", textAlign: "right" }}>{value}</span>
                </div>
              ))}
              <DeliveryStatusControls
                details={details}
                stagingLocations={stagingLocations}
                loading={mutationLoading}
                pickupError={mutationError}
                navy={navy}
                font={font}
                onUpdateStatus={onUpdateStatus}
                onRecordPickup={onRecordPickup}
                onRevertStatus={onRevertStatus}
                onMarkShipped={onMarkShipped}
                onUpdateFulfillmentMethod={onUpdateFulfillmentMethod}
                onStatusAndAssignSpot={onStatusAndAssignSpot}
                onRejectImport={openRejectDialog}
                rejectImportBlockedReason={
                  linkedImportLoading
                    ? "Loading linked import…"
                    : linkedImportRejectBlockedReason(
                        linkedImport,
                        delivery.vendorInvoiceImportId,
                      )
                }
                pickupForm={{
                  showPickupInput,
                  setShowPickupInput,
                  pendingStatusSelection,
                  setPendingStatusSelection,
                  pickupTechnicianName,
                  setPickupTechnicianName,
                }}
              />
              {showStagingLocationBanner ? (
                <StagingLocationBanner
                  font={font}
                  onAssignLocation={
                    onNavigateToAssignLocation
                      ? handleAssignLocationNavigate
                      : () => {}
                  }
                />
              ) : null}
              <div
                data-testid="delivery-basics-staging-locations"
                data-has-assigned-staging={
                  hasAssignedStaging ? "true" : "false"
                }
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  paddingTop: 4,
                  borderTop: "1px solid var(--admin-border)",
                }}
              >
                <span
                  data-testid="delivery-basics-staging-locations-heading"
                  style={{
                    color: "var(--admin-text-label)",
                    fontWeight: 700,
                    fontSize: 12,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                  }}
                >
                  Staging Locations
                </span>
                {willCallNoShopStaging ? (
                  <div data-testid="delivery-basics-staging-will-call-na">
                    <span
                      data-testid="delivery-basics-staging-unassigned"
                      style={{
                        color: "var(--admin-text-muted)",
                        fontStyle: "italic",
                        fontFamily: font,
                      }}
                    >
                      —
                    </span>
                    <p
                      data-testid="delivery-basics-staging-will-call-note"
                      style={{
                        margin: "6px 0 0",
                        fontSize: 12,
                        color: "var(--admin-text-secondary)",
                        fontFamily: font,
                        lineHeight: 1.4,
                      }}
                    >
                      Will-Call / Pickup from Vendor — material stays at the
                      vendor; no StageVerify shop staging location.
                      {staleWillCallStaging
                        ? " A prior shop spot may still be stored; it is not an active staging assignment."
                        : ""}
                    </p>
                  </div>
                ) : (
                  <DrawerStagingLocationChips
                    delivery={delivery}
                    stagingLocations={stagingLocations}
                    occupancyByZoneCode={liveOccupancy.occupancyByZoneCode}
                    shopStockByCode={liveOccupancy.shopStockByCode}
                    occupancyReady={liveOccupancy.ready}
                    font={font}
                    onNavigateToStagingMap={onNavigateToStagingMap}
                  />
                )}
              </div>
              {job ? (
                <JobReleaseToTechnicianPanel
                  jobId={job.id}
                  font={font}
                  onReleased={onJobReleased}
                />
              ) : null}
              <button
                type="button"
                data-testid="delivery-basics-email-vendor"
                disabled={!emailProviderConnected}
                onClick={() => setDrawerEmailModalOpen(true)}
                style={{
                  marginTop: 4,
                  width: "100%",
                  padding: "12px 16px",
                  borderRadius: 8,
                  border: `2px solid ${navy}`,
                  backgroundColor: emailProviderConnected ? navy : "var(--admin-border)",
                  color: emailProviderConnected
                    ? "var(--admin-on-navy)"
                    : "var(--admin-text-muted)",
                  fontSize: 15,
                  fontWeight: 800,
                  letterSpacing: "0.03em",
                  cursor: emailProviderConnected ? "pointer" : "not-allowed",
                  fontFamily: font,
                  boxShadow: emailProviderConnected
                    ? "0 2px 8px rgba(10, 49, 97, 0.25)"
                    : "none",
                }}
              >
                Email Vendor
              </button>
              {!emailProviderConnected ? (
                <p
                  data-testid="delivery-basics-email-vendor-hint"
                  style={{
                    margin: 0,
                    fontSize: 11,
                    color: "var(--admin-text-muted)",
                    textAlign: "center",
                  }}
                >
                  Connect Gmail in Settings to send vendor email.
                </p>
              ) : null}
              {showCompletePickupCta ? (
                <>
                  <button
                    type="button"
                    data-testid="delivery-basics-complete-pickup"
                    disabled={mutationLoading || completePickupMissingJob}
                    onClick={openCompletePickupForm}
                    style={{
                      marginTop: 8,
                      width: "100%",
                      padding: "12px 16px",
                      borderRadius: 8,
                      border: `2px solid ${completePickupMissingJob ? "var(--admin-border)" : "#bf0a30"}`,
                      backgroundColor: completePickupMissingJob
                        ? "var(--admin-border)"
                        : "#bf0a30",
                      color: completePickupMissingJob
                        ? "var(--admin-text-muted)"
                        : "#fff",
                      fontSize: 15,
                      fontWeight: 800,
                      letterSpacing: "0.03em",
                      cursor:
                        mutationLoading || completePickupMissingJob
                          ? "not-allowed"
                          : "pointer",
                      fontFamily: font,
                      boxShadow: completePickupMissingJob
                        ? "none"
                        : "0 2px 8px rgba(191, 10, 48, 0.3)",
                    }}
                  >
                    Complete Pickup
                  </button>
                  {completePickupMissingJob ? (
                    <p
                      data-testid="delivery-basics-complete-pickup-hint"
                      style={{
                        margin: 0,
                        fontSize: 11,
                        color: "var(--admin-text-muted)",
                        textAlign: "center",
                      }}
                    >
                      Link this delivery to a job before completing pickup.
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          </>,
        )}
        {job ? (
          <PickupTokenControls jobId={job.id} font={font}>
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
                        style={{ fontSize: 11, color: "var(--admin-text-muted)", fontFamily: font }}
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
                                  backgroundColor: "var(--admin-info-bg)",
                                  color: "var(--admin-info-text)",
                                  border: "1px solid var(--admin-info-border)",
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
                                  backgroundColor: "var(--admin-success-bg)",
                                  color: "var(--admin-success-text)",
                                  border: "1px solid var(--admin-success-border)",
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
                      </>
                    )}
                    {tokenError ? (
                      <span
                        style={{ fontSize: 11, color: "var(--admin-danger-text)", fontFamily: font }}
                      >
                        {tokenError}
                      </span>
                    ) : null}
                  </div>
                ) : null}
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
        ) : null}
        {details.delivery.unplanned ||
        (details.delivery.reviewFlag?.flagged === true &&
          /unplanned/i.test(details.delivery.reviewFlag.reason ?? "")) ? (
          <div
            data-testid="delivery-drawer-unplanned-note"
            style={{
              margin: "0 0 12px",
              padding: "10px 12px",
              borderRadius: 8,
              border: `1px solid ${UNPLANNED_BADGE.border}`,
              backgroundColor: UNPLANNED_BADGE.bg,
              color: UNPLANNED_BADGE.text,
              fontSize: 13,
              fontFamily: font,
              lineHeight: 1.45,
            }}
          >
            <strong>Vendor unplanned delivery.</strong>{" "}
            {details.delivery.reviewFlag?.reason?.trim() ??
              "Match this delivery to the correct job and PO, then clear the review flag."}
            {details.delivery.unplannedSubmittedReference ? (
              <>
                {" "}
                Reference submitted:{" "}
                <span style={{ fontFamily: "monospace" }}>
                  {details.delivery.unplannedSubmittedReference}
                </span>
              </>
            ) : null}
          </div>
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
          onEmailVendor={() => setDrawerEmailModalOpen(true)}
        />
        <IssueSummaryPanel
          details={details}
          navy={navy}
          font={font}
          loading={mutationLoading}
          onSetDeliverToSiteConfirmed={onSetDeliverToSiteConfirmed}
          onUpdateItemReceiptStatus={onUpdateItemReceiptStatus}
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
                    border: "1px solid var(--admin-border)",
                    borderRadius: 8,
                    padding: "12px",
                    backgroundColor: issue.blocking ? "var(--admin-danger-bg)" : "var(--admin-surface)",
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
                    <span style={{ fontWeight: 700, color: "var(--admin-text)" }}>
                      {MATERIAL_ISSUE_TYPE_LABEL[issue.type]}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        color: issue.blocking ? "var(--admin-danger-text)" : "var(--admin-text-muted)",
                      }}
                    >
                      {issue.blocking ? "Blocking" : "Info"}
                    </span>
                  </div>
                  <p style={{ margin: "0 0 6px", fontSize: 12, color: "var(--admin-text-data)" }}>
                    {issue.description?.trim() || "No description"}
                  </p>
                  <p style={{ margin: 0, fontSize: 11, color: "var(--admin-text-muted)" }}>
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
                      backgroundColor: "var(--admin-surface)",
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
                      color: "var(--admin-text-muted)",
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
                          border: "1px solid var(--admin-border)",
                          borderRadius: 8,
                          padding: "10px 12px",
                          backgroundColor: "var(--admin-surface)",
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
                              color: "var(--admin-text)",
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
                              color: "var(--admin-success-text)",
                              backgroundColor: "var(--admin-success-bg)",
                              border: "1px solid var(--admin-success-border)",
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
                            color: "var(--admin-text-data)",
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
                                  color: "var(--admin-text)",
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
                                  color: "var(--admin-text-muted)",
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
                                color: "var(--admin-text-muted)",
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
                                color: "var(--admin-text-muted)",
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
          onUpdateIssueSummary={onUpdateIssueSummary}
          onUpdateShopStockPickList={onUpdateShopStockPickList}
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
                  border: "1px solid var(--admin-border)",
                  borderRadius: 8,
                  padding: "12px",
                  backgroundColor: "var(--admin-surface)",
                }}
              >
                {!latest ? (
                  <p style={{ margin: 0, color: "var(--admin-text-muted)", fontSize: 13 }}>
                    No pickup recorded yet.
                  </p>
                ) : (
                  <>
                    <p style={{ margin: "0 0 6px", fontWeight: 700, color: "var(--admin-text)" }}>
                      {latest.itemsPickedSummary}
                    </p>
                    <p style={{ margin: "0 0 6px", fontSize: 12, color: "var(--admin-text-muted)" }}>
                      {latest.technicianName} ·{" "}
                      {new Date(latest.pickedUpAt).toLocaleString()}
                    </p>
                    <p style={{ margin: 0, fontSize: 12, color: "var(--admin-text-secondary)" }}>
                      Qty remaining estimate: {remainingQty}
                    </p>
                  </>
                )}
              </div>
            );
          })(),
        )
          : null}
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
              color: "var(--admin-text-muted)",
              letterSpacing: "0.10em",
              textTransform: "uppercase",
              textAlign: "left",
            }}
          >
            <span style={{ fontSize: 10, color: "var(--admin-text-muted)" }}>
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
                  color: "var(--admin-text-muted)",
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
                    backgroundColor: "var(--admin-surface-2)",
                    border: "1px solid var(--admin-border)",
                    borderRadius: 6,
                  }}
                >
                  <p
                    style={{
                      margin: "0 0 4px",
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--admin-text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    Delivery Notes
                  </p>
                  <p style={{ margin: 0, fontSize: 12, color: "var(--admin-text)", lineHeight: 1.45 }}>
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
                            border: "1px solid var(--admin-border)",
                            borderRadius: 6,
                            padding: "10px 12px",
                            backgroundColor: "var(--admin-surface)",
                          }}
                        >
                          <p style={{ margin: 0, fontWeight: 700, color: "var(--admin-text)" }}>
                            {event.entityType}{" "}
                            <span style={{ color: "var(--admin-text-muted)", fontWeight: 400, fontSize: 12 }}>
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
                          <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--admin-text-muted)" }}>
                            {formatActivityHistoryMeta(event)}
                          </p>
                          {event.reason ? (
                            <p
                              style={{
                                margin: "6px 0 0",
                                fontSize: 12,
                                color: "var(--admin-text)",
                                backgroundColor: "var(--admin-surface-2)",
                                padding: "6px 8px",
                                borderRadius: 4,
                                border: "1px solid var(--admin-border)",
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
                          <p style={{ margin: 0, fontWeight: 600, color: "var(--admin-text)", fontSize: 13 }}>
                            {formatActivityHistoryHeadline(event)}
                          </p>
                          <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--admin-text-muted)" }}>
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
                        border: "1px solid var(--admin-border)",
                        borderRadius: 4,
                        backgroundColor: "var(--admin-surface)",
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
                <p style={{ color: "var(--admin-text-muted)", fontSize: 13, margin: 0 }}>
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
                    border: "1px solid var(--admin-border)",
                    borderRadius: 8,
                    padding: "12px",
                    backgroundColor: "var(--admin-surface)",
                    boxShadow: "rgba(0,0,0,0.08) 0px 2px 6px 0px",
                  }}
                >
                  <p style={{ margin: 0, fontWeight: 700, color: "var(--admin-text)" }}>
                    {pickup.technicianName}
                  </p>
                  <p
                    style={{
                      margin: "3px 0 8px",
                      fontSize: 12,
                      color: "var(--admin-text-muted)",
                    }}
                  >
                    {new Date(pickup.pickedUpAt).toLocaleString()}
                  </p>
                  <p
                    style={{
                      margin: 0,
                      backgroundColor: "var(--admin-surface-2)",
                      padding: "8px 12px",
                      borderRadius: 4,
                      border: "1px solid var(--admin-border)",
                      color: "var(--admin-text)",
                    }}
                  >
                    {pickup.itemsPickedSummary}
                  </p>
                  {pickup.notes && (
                    <p
                      style={{
                        margin: "8px 0 0",
                        fontSize: 12,
                        color: "var(--admin-text-muted)",
                        fontStyle: "italic",
                      }}
                    >
                      Note: {pickup.notes}
                    </p>
                  )}
                </div>
              ))
            ) : (
              <p style={{ color: "var(--admin-text-muted)", fontSize: 13 }}>
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
          emailCc={emailCc}
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
          onEmailCcChange={(value) => {
            setEmailFieldsTouched(true);
            setEmailCc(value);
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
              void resetNeedMoreInfoEmailFields(details);
            }
            if (!resolutionNoteTouched) {
              setResolutionNote(
                buildSuggestedResolutionNote(issue, nextType, {
                  orderNumber: details.delivery.orderNumber,
                  jobNumber: job?.jobNumber ?? null,
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
      <VendorCommunicationsModal
        open={drawerEmailModalOpen}
        vendors={mergeVendorIntoList(portalVendors ?? [], details.vendor)}
        deliveries={[drawerDeliveryRow]}
        emailProviderConnected={emailProviderConnected}
        initialVendorId={details.vendor.id}
        initialVendorEmail={details.vendor.email}
        initialVendorName={details.vendor.name}
        initialDeliveryOrderId={details.delivery.id}
        initialSubject={vendorCommsInitialSubject}
        initialBody={vendorCommsInitialBody}
        navy={navy}
        font={font}
        onClose={() => setDrawerEmailModalOpen(false)}
        onSuccess={() => {
          setDrawerEmailModalOpen(false);
          setVendorCommsRefresh((value) => value + 1);
        }}
        onSend={async (input) => {
          await sendVendorEmail(input);
        }}
      />
      <InvoiceRejectReasonDialog
        open={rejectDialogOpen}
        title="Reject linked credit/return import?"
        helpText="This moves the linked import to Rejected Invoices and saves a training lesson so credit/return memos do not create pickup-ready deliveries again."
        reasonId={rejectReasonId}
        detailText={rejectDetailText}
        loading={rejectActionLoading}
        onReasonIdChange={setRejectReasonId}
        onDetailTextChange={setRejectDetailText}
        onCancel={closeRejectDialog}
        onConfirm={() => void confirmRejectLinkedImport()}
      />
    </>
  );
}

/* ─── Delivery status + fulfillment (Delivery Basics) ─────────────────── */

const DRAWER_STATUS_DROPDOWN_OPTIONS: DeliveryStatus[] = [
  "pending",
  "shipped",
  "arrived",
  "partial",
  "ready_for_pickup",
  "picked_up",
];

/** Action pseudo-value — not a DeliveryStatus; last option in status dropdown. */
const DRAWER_STATUS_REJECT_ACTION = "__reject_import__";

const PICKUP_FORM_RED = "#bf0a30";

type DeliveryPickupFormState = {
  showPickupInput: boolean;
  setShowPickupInput: (value: boolean) => void;
  pendingStatusSelection: DeliveryStatus | null;
  setPendingStatusSelection: (value: DeliveryStatus | null) => void;
  pickupTechnicianName: string;
  setPickupTechnicianName: (value: string) => void;
};

function drawerStatusOptionEnabled(
  current: DeliveryStatus,
  option: DeliveryStatus,
  delivery: DeliveryOrder,
): boolean {
  if (
    option === "ready_for_pickup" &&
    isWillCallPickupStagingListNa(delivery)
  ) {
    return false;
  }
  const possibleNext = VALID_TRANSITIONS[current] ?? [];
  const revertTarget = DISPATCHER_REVERT_TARGETS[current];
  return possibleNext.includes(option) || revertTarget === option;
}

function DeliveryStatusControls({
  details,
  stagingLocations,
  loading,
  pickupError,
  navy,
  font,
  onUpdateStatus,
  onRecordPickup,
  onRevertStatus,
  onMarkShipped,
  onUpdateFulfillmentMethod,
  onStatusAndAssignSpot,
  onRejectImport,
  rejectImportBlockedReason,
  pickupForm,
}: {
  details: DeliveryDetails;
  stagingLocations: StagingLocation[];
  loading: boolean;
  pickupError: string | null;
  navy: string;
  font: string;
  onUpdateStatus: (toStatus: DeliveryStatus, reason?: string) => Promise<void>;
  onRecordPickup: (technicianName: string, itemsSummary: string) => Promise<void>;
  onRevertStatus: () => Promise<void>;
  onMarkShipped: () => Promise<void>;
  onUpdateFulfillmentMethod: (
    method: "delivery" | "will_call_pickup",
  ) => Promise<void>;
  onStatusAndAssignSpot: (spotId: string) => Promise<void>;
  onRejectImport: () => void;
  rejectImportBlockedReason: string | null;
  pickupForm: DeliveryPickupFormState;
}) {
  const delivery = details.delivery;
  const currentStatus = delivery.status;
  const {
    showPickupInput,
    setShowPickupInput,
    pendingStatusSelection,
    setPendingStatusSelection,
    pickupTechnicianName,
    setPickupTechnicianName,
  } = pickupForm;
  const [showSpotPicker, setShowSpotPicker] = useState(false);
  const [selectedSpotId, setSelectedSpotId] = useState(
    delivery.stagingLocationId ?? "",
  );
  const [rejectUnavailableMessage, setRejectUnavailableMessage] = useState<
    string | null
  >(null);
  const pickupInputRef = useRef<HTMLInputElement>(null);

  const displayState = useMemo(
    () =>
      computeDeliveryDisplayState(
        delivery,
        details.items,
        details.materialIssues,
      ),
    [delivery, details.items, details.materialIssues],
  );

  const fulfillmentMethod =
    delivery.invoiceFulfillmentMethod === "will_call_pickup"
      ? "will_call_pickup"
      : "delivery";
  const fulfillmentContextLabel =
    fulfillmentMethod === "will_call_pickup"
      ? "Will-Call / Pickup from Vendor"
      : "Vendor Drop-Off";

  const selectValue = DRAWER_STATUS_DROPDOWN_OPTIONS.includes(currentStatus)
    ? currentStatus
    : "";
  const effectiveSelectValue = pendingStatusSelection ?? selectValue;
  const statusLabelText =
    pendingStatusSelection === "picked_up" || currentStatus === "picked_up"
      ? DELIVERY_STATUS_LABEL.picked_up
      : displayState.statusDisplayLabel;

  useEffect(() => {
    setSelectedSpotId(delivery.stagingLocationId ?? "");
    setShowPickupInput(false);
    setShowSpotPicker(false);
    setPickupTechnicianName("");
    setPendingStatusSelection(null);
    setRejectUnavailableMessage(null);
  }, [delivery.id, delivery.stagingLocationId]);

  useEffect(() => {
    if (currentStatus === "picked_up") {
      setShowPickupInput(false);
      setPendingStatusSelection(null);
      setPickupTechnicianName("");
    }
  }, [currentStatus]);

  useEffect(() => {
    if (showPickupInput) {
      setShowSpotPicker(false);
      const t = setTimeout(() => pickupInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [showPickupInput]);

  const handleStatusChange = (raw: string) => {
    if (raw === DRAWER_STATUS_REJECT_ACTION) {
      if (rejectImportBlockedReason) {
        setRejectUnavailableMessage(rejectImportBlockedReason);
        return;
      }
      setRejectUnavailableMessage(null);
      onRejectImport();
      return;
    }
    setRejectUnavailableMessage(null);
    const option = raw as DeliveryStatus;
    if (option === currentStatus && option !== "picked_up") return;
    if (option === "picked_up") {
      setShowSpotPicker(false);
      setPendingStatusSelection("picked_up");
      setShowPickupInput(true);
      return;
    }
    setPendingStatusSelection(null);
    if (option === "ready_for_pickup") {
      setShowPickupInput(false);
      setShowSpotPicker(true);
      return;
    }
    const revertTarget = DISPATCHER_REVERT_TARGETS[currentStatus];
    const inTransitions = VALID_TRANSITIONS[currentStatus]?.includes(option);
    if (option === revertTarget && !inTransitions) {
      void onRevertStatus();
      return;
    }
    if (option === "shipped" && currentStatus === "pending") {
      void onMarkShipped();
      return;
    }
    void onUpdateStatus(option);
  };

  const handleConfirmPickup = () => {
    const trimmedName = pickupTechnicianName.trim();
    if (!trimmedName) return;
    const itemCount = details.items.length;
    const summary = itemCount === 1 ? "1 item" : `${itemCount} items`;
    void onRecordPickup(trimmedName, summary);
  };

  const handleConfirmSpot = () => {
    if (!selectedSpotId.trim()) return;
    void onStatusAndAssignSpot(selectedSpotId);
    setShowSpotPicker(false);
  };

  return (
    <div
      data-testid="delivery-status-controls"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        paddingTop: 4,
        borderTop: "1px solid var(--admin-border)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <span
          style={{
            color: "var(--admin-text-label)",
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          Status
        </span>
        <p
          data-testid="delivery-status-current-label"
          style={{
            margin: 0,
            fontSize: 13,
            color: "var(--admin-text-data)",
            fontWeight: 600,
          }}
        >
          {statusLabelText}
          <span style={{ color: "var(--admin-text-muted)", fontWeight: 500 }}>
            {" "}
            · {fulfillmentContextLabel}
          </span>
        </p>
        <select
          data-testid="delivery-status-dropdown"
          value={effectiveSelectValue}
          disabled={loading || currentStatus === "issue"}
          onChange={(e) => handleStatusChange(e.target.value)}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "8px 10px",
            border: "1.5px solid var(--admin-border)",
            borderRadius: 6,
            fontSize: 14,
            fontFamily: font,
            color: "var(--admin-text)",
            backgroundColor: "var(--admin-surface)",
          }}
        >
          {!effectiveSelectValue ? (
            <option value="" disabled>
              {currentStatus === "issue"
                ? "Issue — use Report Issue below"
                : DELIVERY_STATUS_LABEL[currentStatus] ?? currentStatus}
            </option>
          ) : null}
          {DRAWER_STATUS_DROPDOWN_OPTIONS.map((option) => {
            const enabled = drawerStatusOptionEnabled(
              currentStatus,
              option,
              delivery,
            );
            return (
              <option
                key={option}
                value={option}
                disabled={!enabled}
                style={{ color: enabled ? "var(--admin-text)" : "var(--admin-text-muted)" }}
              >
                {DELIVERY_STATUS_LABEL[option]}
              </option>
            );
          })}
          <option disabled value="__reject_separator__">
            ──────────
          </option>
          <option
            value={DRAWER_STATUS_REJECT_ACTION}
            data-testid="delivery-status-reject-option"
            style={{ color: "var(--admin-danger-text)", fontWeight: 700 }}
          >
            Reject…
          </option>
        </select>
        {rejectUnavailableMessage ? (
          <p
            data-testid="delivery-status-reject-unavailable"
            style={{
              margin: "6px 0 0",
              fontSize: 12,
              color: "var(--admin-danger-text)",
              lineHeight: 1.4,
            }}
          >
            {rejectUnavailableMessage}
          </p>
        ) : null}
      </div>

      <div
        data-testid="delivery-fulfillment-control"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <span
          style={{
            color: "var(--admin-text-label)",
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          Fulfillment
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          {(
            [
              ["delivery", "Vendor Drop-Off"],
              ["will_call_pickup", "Will-Call / Pickup from Vendor"],
            ] as const
          ).map(([method, label]) => {
            const active = fulfillmentMethod === method;
            return (
              <button
                key={method}
                type="button"
                data-testid={`delivery-fulfillment-${method}`}
                data-selected={active ? "true" : "false"}
                aria-pressed={active}
                disabled={loading}
                onClick={() => {
                  if (active || loading) return;
                  void onUpdateFulfillmentMethod(method);
                }}
                style={{
                  flex: 1,
                  padding: "9px 12px",
                  borderRadius: 8,
                  /* Selected: StageVerify blue ≥4.5:1 with white (avoid muted dark accent). */
                  border: active
                    ? "2px solid #60a5fa"
                    : "1.5px solid var(--admin-border-strong)",
                  backgroundColor: active ? "#2563eb" : "var(--admin-surface-2)",
                  color: active
                    ? "var(--admin-on-navy)"
                    : "var(--admin-text-data)",
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: loading || active ? "default" : "pointer",
                  fontFamily: font,
                  opacity: loading ? 0.7 : 1,
                  boxShadow: active
                    ? "0 0 0 1px rgba(37, 99, 235, 0.45), 0 2px 10px rgba(37, 99, 235, 0.4)"
                    : "inset 0 0 0 1px rgba(255,255,255,0.06)",
                  letterSpacing: "0.01em",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {showSpotPicker ? (
        <div data-testid="delivery-status-spot-picker">
          <label
            htmlFor="delivery-status-spot-select"
            style={{
              display: "block",
              marginBottom: 6,
              fontSize: 12,
              fontWeight: 600,
              color: "var(--admin-text)",
              fontFamily: font,
            }}
          >
            Assign staging spot for Staged — Ready for Pickup
          </label>
          <select
            id="delivery-status-spot-select"
            data-testid="delivery-status-spot-select"
            value={selectedSpotId}
            disabled={loading}
            onChange={(e) => setSelectedSpotId(e.target.value)}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "8px 10px",
              border: "1.5px solid var(--admin-border)",
              borderRadius: 6,
              fontSize: 14,
              fontFamily: font,
              color: "var(--admin-text)",
              backgroundColor: "var(--admin-surface)",
              marginBottom: 8,
            }}
          >
            <option value="">Select a spot…</option>
            {stagingLocations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.code}
                {loc.label ? ` — ${loc.label}` : ""}
              </option>
            ))}
          </select>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={handleConfirmSpot}
              disabled={loading || !selectedSpotId.trim()}
              style={{
                backgroundColor:
                  loading || !selectedSpotId.trim() ? "var(--admin-surface-2)" : navy,
                color:
                  loading || !selectedSpotId.trim() ? "var(--admin-text-muted)" : "var(--admin-text)",
                border: `1.5px solid ${
                  loading || !selectedSpotId.trim() ? "var(--admin-border)" : navy
                }`,
                borderRadius: 4,
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 700,
                cursor:
                  loading || !selectedSpotId.trim()
                    ? "not-allowed"
                    : "pointer",
                fontFamily: font,
              }}
            >
              {loading ? "Saving…" : "Save spot + stage"}
            </button>
            <button
              type="button"
              onClick={() => setShowSpotPicker(false)}
              disabled={loading}
              style={{
                backgroundColor: "var(--admin-surface)",
                color: "var(--admin-text)",
                border: "1.5px solid var(--admin-border)",
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
      ) : null}

      {showPickupInput ? (
        <div data-testid="delivery-status-pickup-input">
          <p
            data-testid="delivery-status-pickup-intro"
            style={{
              margin: "0 0 8px",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--admin-text-data)",
              fontFamily: font,
              lineHeight: 1.4,
            }}
          >
            Complete pickup? This will move the delivery to Picked Up.
          </p>
          <label
            htmlFor="delivery-status-pickup-name"
            style={{
              display: "block",
              marginBottom: 6,
              fontSize: 12,
              fontWeight: 600,
              color: "var(--admin-text)",
              fontFamily: font,
            }}
          >
            Who picked up?
          </label>
          <input
            ref={pickupInputRef}
            id="delivery-status-pickup-name"
            type="text"
            value={pickupTechnicianName}
            onChange={(e) => setPickupTechnicianName(e.target.value)}
            placeholder="Enter technician name"
            disabled={loading}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "8px 12px",
              border: "1.5px solid var(--admin-border)",
              borderRadius: 6,
              fontSize: 14,
              fontFamily: font,
              color: "var(--admin-text)",
              backgroundColor: "var(--admin-surface)",
              marginBottom: 8,
            }}
          />
          {pickupError && showPickupInput ? (
            <p
              data-testid="delivery-status-pickup-error"
              role="alert"
              style={{
                margin: "0 0 8px",
                fontSize: 12,
                color: "var(--admin-danger-text)",
                fontWeight: 600,
              }}
            >
              {pickupError}
            </p>
          ) : null}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              data-testid="delivery-status-pickup-submit"
              onClick={handleConfirmPickup}
              disabled={loading || !pickupTechnicianName.trim()}
              style={{
                backgroundColor:
                  loading || !pickupTechnicianName.trim()
                    ? "var(--admin-surface-2)"
                    : PICKUP_FORM_RED,
                color:
                  loading || !pickupTechnicianName.trim()
                    ? "var(--admin-text-muted)"
                    : "#fff",
                border: `1.5px solid ${
                  loading || !pickupTechnicianName.trim()
                    ? "var(--admin-border)"
                    : PICKUP_FORM_RED
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
              {loading ? "Saving…" : "Complete Pickup"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowPickupInput(false);
                setPickupTechnicianName("");
                setPendingStatusSelection(null);
              }}
              disabled={loading}
              style={{
                backgroundColor: "var(--admin-surface)",
                color: "var(--admin-text)",
                border: "1.5px solid var(--admin-border)",
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
      ) : null}
    </div>
  );
}

/* ─── Status Action Panel ────────────────────────────────────────────────── */

function StatusActionPanel({
  details,
  loading,
  error,
  onUpdateStatus,
  onUpdateIssueSummary,
  onUpdateShopStockPickList,
  stagingLocations,
  navy,
  font,
}: {
  details: DeliveryDetails;
  loading: boolean;
  error: string | null;
  onUpdateStatus: (toStatus: DeliveryStatus, reason?: string) => Promise<void>;
  onUpdateIssueSummary: (summary: string) => Promise<void>;
  onUpdateShopStockPickList: (
    items: string[],
    locationNote: string,
    linkedMappingId?: string,
  ) => Promise<void>;
  stagingLocations: StagingLocation[];
  navy: string;
  font: string;
}) {
  const [reason, setReason] = useState("");
  const [showReasonInput, setShowReasonInput] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [editingIssue, setEditingIssue] = useState(false);
  const [editReason, setEditReason] = useState("");
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [stockToolsExpanded, setStockToolsExpanded] = useState(false);
  const [stockMappings, setStockMappings] = useState<ShopStockLocationMapping[]>([]);
  const [linkedMappingId, setLinkedMappingId] = useState("");

  useEffect(() => {
    void listShopStockMappings().then(setStockMappings);
  }, [details.delivery.id]);
  const [pickListText, setPickListText] = useState(() =>
    formatShopStockPickListForEditor(details.delivery.shopStockPickListItems),
  );
  const [shopStockLocationNote, setShopStockLocationNote] = useState(
    details.delivery.shopStockLocationNote ?? "",
  );
  const savedShopStockLocationNote =
    details.delivery.shopStockLocationNote ?? "";
  const parsedPickList = parseShopStockPickListLines(pickListText);
  const savedPickList = details.delivery.shopStockPickListItems ?? [];
  const isPickListDirty =
    parsedPickList.length !== savedPickList.length ||
    parsedPickList.some((line, i) => line !== savedPickList[i]) ||
    shopStockLocationNote.trim() !== savedShopStockLocationNote.trim();

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
      const t = setTimeout(() => textareaRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [showReasonInput]);

  useEffect(() => {
    if (editingIssue) {
      const t = setTimeout(() => editTextareaRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [editingIssue]);

  const currentStatus = details.delivery.status;

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
        border: "1px solid var(--admin-border)",
        borderRadius: 8,
        backgroundColor: "var(--admin-surface-2)",
        padding: "15px",
        marginBottom: 20,
      }}
    >
      {(details.delivery.combinationStagingGroupId ||
        (details.delivery.combinationMemberLocationIds?.length ?? 0) > 0) && (
        <div
          data-testid="staging-location-assignment"
          style={{
            padding: "14px 16px",
            borderRadius: 8,
            border: "1px solid var(--admin-border)",
            backgroundColor: "var(--admin-surface-2)",
            marginBottom: 16,
          }}
        >
          <div
            data-testid="combination-staging-group-label"
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid var(--admin-border)",
              backgroundColor: "var(--admin-surface)",
            }}
          >
            <p
              style={{
                margin: "0 0 6px",
                fontSize: 11,
                fontWeight: 700,
                color: "var(--admin-text-label)",
                textTransform: "uppercase",
                letterSpacing: "0.10em",
              }}
            >
              Combination Staging Group
            </p>
            <p style={{ margin: 0, fontSize: 13, color: "var(--admin-text-data)" }}>
              {details.delivery.combinationStagingGroupId ?? "—"}
            </p>
            {(details.delivery.combinationMemberLocationIds?.length ?? 0) > 0 && (
              <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--admin-text-muted)" }}>
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
        </div>
      )}

      {/* Issue reporting — separate from status dropdown */}
      {currentStatus !== "issue" && !showReasonInput ? (
        <div style={{ marginBottom: 12 }}>
          <button
            type="button"
            data-testid="report-issue-button"
            onClick={() => setShowReasonInput(true)}
            disabled={loading}
            style={{
              backgroundColor: loading ? "var(--admin-surface-2)" : "var(--admin-surface)",
              color: loading ? "var(--admin-text-muted)" : "var(--admin-danger-text)",
              border: `1.5px solid ${loading ? "var(--admin-border)" : "var(--admin-danger-text)"}`,
              borderRadius: 4,
              padding: "8px 14px",
              fontSize: 12,
              fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              fontFamily: font,
            }}
          >
            Report Issue
          </button>
        </div>
      ) : null}

      {showReasonInput && (
        <div data-testid="report-issue-form">
          <h3
            style={{
              margin: "0 0 8px",
              fontSize: 11,
              fontWeight: 700,
              color: "var(--admin-danger-text)",
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
            disabled={loading}
            style={{
              width: "100%",
              boxSizing: "border-box",
              minHeight: 60,
              padding: "8px 12px",
              border: "1.5px solid var(--admin-border)",
              borderRadius: 6,
              fontSize: 14,
              fontFamily: font,
              color: "var(--admin-text)",
              backgroundColor: "var(--admin-surface)",
              outline: "none",
              marginBottom: 8,
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={handleConfirmIssue}
              disabled={loading || !reason.trim()}
              style={{
                backgroundColor:
                  loading || !reason.trim() ? "var(--admin-surface-2)" : "var(--admin-danger-text)",
                color:
                  loading || !reason.trim()
                    ? "var(--admin-text-muted)"
                    : "var(--admin-on-navy)",
                border: `1.5px solid ${
                  loading || !reason.trim() ? "var(--admin-border)" : "var(--admin-danger-text)"
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
              type="button"
              onClick={() => {
                setShowReasonInput(false);
                setReason("");
              }}
              disabled={loading}
              style={{
                backgroundColor: "var(--admin-surface)",
                color: "var(--admin-text)",
                border: "1.5px solid var(--admin-border)",
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
                color: "var(--admin-danger-text)",
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
              color: "var(--admin-text)",
              backgroundColor: "var(--admin-danger-bg)",
              border: "1px solid var(--admin-danger-border)",
              borderRadius: 6,
              padding: "8px 12px",
              fontFamily: font,
              lineHeight: 1.5,
            }}
          >
            {details.delivery.issueSummary || <em style={{ color: "var(--admin-text-muted)" }}>No summary recorded.</em>}
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
              color: "var(--admin-danger-text)",
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
              border: "1.5px solid var(--admin-danger-border)",
              borderRadius: 6,
              fontSize: 14,
              fontFamily: font,
              color: "var(--admin-text)",
              backgroundColor: "var(--admin-surface)",
              outline: "none",
              marginBottom: 8,
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleSaveEdit}
              disabled={loading || !editReason.trim()}
              style={{
                backgroundColor: loading || !editReason.trim() ? "var(--admin-surface-2)" : "var(--admin-danger-text)",
                color: loading || !editReason.trim()
                  ? "var(--admin-text-muted)"
                  : "var(--admin-on-navy)",
                border: `1.5px solid ${loading || !editReason.trim() ? "var(--admin-border)" : "var(--admin-danger-text)"}`,
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
                backgroundColor: "var(--admin-surface)",
                color: "var(--admin-text)",
                border: "1.5px solid var(--admin-border)",
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

      {/* ── Experimental Stock Tools (collapsed default) ── */}
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
            color: "var(--admin-text-muted)",
            letterSpacing: "0.04em",
            textAlign: "left",
          }}
        >
          <span style={{ fontSize: 10, color: "var(--admin-text-muted)" }}>
            {stockToolsExpanded ? "▼" : "▶"}
          </span>
          Experimental Stock Tools
        </button>
        <p
          style={{
            margin: "0 0 8px",
            fontSize: 12,
            color: "var(--admin-text-muted)",
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
                color: "var(--admin-text)",
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
                border: "1.5px solid var(--admin-border)",
                borderRadius: 6,
                fontSize: 13,
                fontFamily: font,
                color: "var(--admin-text)",
                backgroundColor: loading ? "var(--admin-surface-2)" : "var(--admin-surface)",
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
            color: "var(--admin-text)",
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
            border: isPickListDirty ? `1.5px solid ${navy}` : "1.5px solid var(--admin-border)",
            borderRadius: 6,
            fontSize: 13,
            fontFamily: font,
            color: "var(--admin-text)",
            backgroundColor: loading ? "var(--admin-surface-2)" : "var(--admin-surface)",
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
            color: "var(--admin-text)",
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
              : "1.5px solid var(--admin-border)",
            borderRadius: 6,
            fontSize: 13,
            fontFamily: font,
            color: "var(--admin-text)",
            backgroundColor: loading ? "var(--admin-surface-2)" : "var(--admin-surface)",
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
            backgroundColor: loading || !isPickListDirty ? "var(--admin-surface-2)" : navy,
            color: loading || !isPickListDirty ? "var(--admin-text-muted)" : "var(--admin-text)",
            border: `1.5px solid ${loading || !isPickListDirty ? "var(--admin-border)" : navy}`,
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
            backgroundColor: "var(--admin-danger-bg)",
            border: "1px solid var(--admin-danger-border)",
            borderRadius: 6,
            padding: "10px 15px",
            color: "var(--admin-danger-text)",
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
