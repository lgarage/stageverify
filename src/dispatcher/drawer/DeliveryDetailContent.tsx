import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { buildEslTagQrUrl } from "../../receiveQrUrls";
import {
  buildPickupTokenUrl,
  clearPickupTokenForJob,
  readPickupTokenForJob,
  storePickupTokenForJob,
} from "../../pickupTokenSession";
import { validatePickupTokenClient } from "../../validatePickupTokenClient";
import { EslQrCode } from "../../EslQrCode";
import { NeedMoreSpaceButton } from "../../NeedMoreSpaceButton";
import {
  firestoreDataService,
  getVendorInvoiceImport,
  mapOccupancyByLocationId,
  sendVendorEmail,
  listVendorEmailEventsForDelivery,
  listShopStockMappings,
  type StagingLocationOccupant,
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
  getAllStagingLocationIds,
  ISSUE_RESOLUTION_TYPE_LABEL,
  MATERIAL_ISSUE_TYPE_LABEL,
  DELIVERY_STATUS_LABEL,
  type IssueResolutionType,
  type MaterialIssue,
  type ShopStockLocationMapping,
  type VendorInvoiceImportReview,
} from "../models";
import { ReadinessEvidencePanel } from "../email/ReadinessEvidencePanel";
import { DrawerActionBanner } from "./DrawerActionBanner";
import { StagingLocationBanner } from "./StagingLocationBanner";
import { IssueSummaryPanel } from "./IssueSummaryPanel";
import {
  shouldShowPickupSummaryPanel,
  selectTopActivityHistoryEvents,
  filterCompactActivityHistory,
  sortActivityHistoryNewestFirst,
  formatActivityHistoryHeadline,
  formatActivityHistoryMeta,
  deliveryHasCopyPickupIdentifyingInfo,
  buildPickupInformationClipboardText,
  effectiveItemQtyReceived,
  formatActualStagingCodes,
  formatPlannedStagingCodes,
  hasPlannedActualDivergence,
  STAGING_PLAN_MISMATCH_HELPER,
  STAGING_PLAN_MISMATCH_LABEL,
  STAGING_PLAN_MISMATCH_TITLE,
} from "../deliveryDisplayHelpers";
import {
  isInvoiceShellNoShopStaging,
  resolveDeliveryPoNumber,
} from "../invoice/invoiceShellDisplayHelpers";
import { InvoiceParsedInspectModal } from "../invoice/InvoiceParsedInspectModal";
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
import {
  buildSuggestedResolutionNote,
  defaultResolutionTypeForIssue,
} from "./resolveIssueDefaults";

const NAVY = "#0a3161";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

/** Drawer UI simplification (away-080) — sections hidden pending redesign; logic preserved. */
const DRAWER_HIDE_VENDOR_COMMUNICATIONS = false;
const DRAWER_HIDE_RESOLVED_MATERIAL_ISSUES = true;
const DRAWER_HIDE_NEED_MORE_SPACE = true;

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

/* ─── Copy Pickup Link ───────────────────────────────────────────────────── */

function CopyPickupLinkButton({
  details,
  font,
  stagingLocations,
  onTokenGenerated,
}: {
  details: DeliveryDetails;
  font: string;
  stagingLocations: StagingLocation[];
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
      const breakdown = await firestoreDataService.getJobReadinessBreakdown(jobId);
      const text = buildPickupInformationClipboardText(details, link, {
        jobDeliveries: breakdown?.deliveries ?? [details.delivery],
        jobPurchaseOrders: breakdown?.purchaseOrders ?? [],
        stagingLocations,
      });
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
  onUpdateIssueSummary,
  onSetDeliverToSiteConfirmed,
  onUpdateItemReceiptStatus,
  onUpdateShopStockPickList,
  stagingLocations,
  onUpdatePlannedStagingLocations,
  onUpdateStagingLocation,
  onOpenDelivery,
  onUpdateJobPickupScheduled,
  onDeliveryOrderUpdated,
  onResolveMaterialIssue,
  emailProviderConnected,
  onNavigateToAssignLocation,
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
  onUpdatePlannedStagingLocations: (ids: string[]) => Promise<void>;
  onUpdateStagingLocation: (stagingLocationId: string) => Promise<void>;
  onOpenDelivery: (deliveryId: string) => void;
  onUpdateJobPickupScheduled: (scheduled: boolean) => Promise<void>;
  onDeliveryOrderUpdated: (delivery: DeliveryOrder) => void;
  onResolveMaterialIssue: (
    issueId: string,
    resolutionType: IssueResolutionType,
    resolutionNote: string,
  ) => Promise<void>;
  emailProviderConnected: boolean;
  onNavigateToAssignLocation?: (deliveryId: string) => void;
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
  const [drawerEmailModalOpen, setDrawerEmailModalOpen] = useState(false);
  const { vendors: portalVendors } = useDispatcherPortal();

  useEffect(() => {
    setActivityHistoryExpanded(false);
    setActivityHistoryFullView(false);
    setInspectImport(null);
    setInspectImportError(null);
    setDrawerEmailModalOpen(false);
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
  const itemsReceivedTotal = details.items.reduce(
    (sum, item) => sum + item.qtyReceived,
    0,
  );
  const itemsOrderedTotal = details.items.reduce(
    (sum, item) => sum + item.qtyOrdered,
    0,
  );
  const drawerDeliveryRow: DeliveryListRow = {
    deliveryId: delivery.id,
    status: delivery.status,
    statusDisplayLabel:
      DELIVERY_STATUS_LABEL[delivery.status] ?? delivery.status,
    jobNumber: job.jobNumber,
    jobName: job.jobName,
    poNumber:
      resolveDeliveryPoNumber(
        delivery.customerPoOrReference,
        details.purchaseOrder?.poNumber,
      ) ?? undefined,
    orderNumber: delivery.orderNumber,
    vendorName: details.vendor.name,
    deliveryDate: delivery.deliveryDate ?? "",
    stagingLocationCode: details.stagingLocation?.code,
    itemsReceivedLabel: `${itemsReceivedTotal}/${itemsOrderedTotal}`,
    issueSummary: delivery.issueSummary ?? "",
    openIssueCount: details.materialIssues.filter(
      (issue) => issue.status === "open" || issue.status === "assigned",
    ).length,
    missingStagingAssignment: !details.stagingLocation,
  };
  const linkedInvoiceImportId = delivery.vendorInvoiceImportId?.trim() ?? "";
  const shopStagingRequired = !isInvoiceShellNoShopStaging(delivery);
  const locById = new Map(stagingLocations.map((loc) => [loc.id, loc]));
  const actualStagingCodes = formatActualStagingCodes(delivery, locById);
  const plannedStagingCodes = formatPlannedStagingCodes(delivery, locById);
  const hasStagingCodesDisplay =
    Boolean(actualStagingCodes) ||
    (plannedStagingCodes !== "—" && plannedStagingCodes.length > 0);

  const handleAssignLocationNavigate = () => {
    if (onNavigateToAssignLocation) {
      onNavigateToAssignLocation(delivery.id);
    }
  };

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
                  value: hasStagingCodesDisplay ? (
                    <span
                      data-testid="delivery-basics-staging-codes"
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-end",
                        gap: 4,
                      }}
                    >
                      {actualStagingCodes ? (
                        <span
                          style={{
                            fontFamily: "monospace",
                            fontWeight: 800,
                            fontSize: 16,
                            color: navy,
                            letterSpacing: "0.02em",
                          }}
                        >
                          {actualStagingCodes}
                        </span>
                      ) : null}
                      {plannedStagingCodes !== "—" ? (
                        <span
                          style={{
                            fontFamily: "monospace",
                            fontWeight: actualStagingCodes ? 600 : 800,
                            fontSize: actualStagingCodes ? 13 : 16,
                            color: actualStagingCodes ? "#c2410c" : navy,
                          }}
                        >
                          {actualStagingCodes
                            ? `Planned: ${plannedStagingCodes}`
                            : plannedStagingCodes}
                        </span>
                      ) : null}
                    </span>
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
                  backgroundColor: emailProviderConnected ? navy : "#e5e7eb",
                  color: emailProviderConnected ? "#fff" : "#9ca3af",
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
              {onNavigateToAssignLocation ? (
                <button
                  type="button"
                  data-testid="delivery-basics-assign-location"
                  onClick={handleAssignLocationNavigate}
                  style={{
                    width: "100%",
                    padding: "12px 16px",
                    borderRadius: 8,
                    border: "2px solid #ea580c",
                    backgroundColor: "#ea580c",
                    color: "#fff",
                    fontSize: 15,
                    fontWeight: 800,
                    letterSpacing: "0.03em",
                    cursor: "pointer",
                    fontFamily: font,
                    boxShadow: "0 2px 8px rgba(234, 88, 12, 0.25)",
                  }}
                >
                  Assign Location
                </button>
              ) : null}
              {!emailProviderConnected ? (
                <p
                  data-testid="delivery-basics-email-vendor-hint"
                  style={{
                    margin: 0,
                    fontSize: 11,
                    color: "#6b7280",
                    textAlign: "center",
                  }}
                >
                  Connect Gmail in Settings to send vendor email.
                </p>
              ) : null}
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
                  stagingLocations={stagingLocations}
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
            onAssignLocation={
              onNavigateToAssignLocation
                ? handleAssignLocationNavigate
                : () => {}
            }
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
          onUpdatePlannedStagingLocations={onUpdatePlannedStagingLocations}
          onUpdateStagingLocation={onUpdateStagingLocation}
          onOpenDelivery={onOpenDelivery}
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
      <VendorCommunicationsModal
        open={drawerEmailModalOpen}
        vendors={portalVendors}
        deliveries={[drawerDeliveryRow]}
        emailProviderConnected={emailProviderConnected}
        initialVendorId={details.vendor.id}
        initialDeliveryOrderId={details.delivery.id}
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
          deliverToSiteConfirmed={details.delivery.invoiceDeliverToSiteConfirmed === true}
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
  onUpdatePlannedStagingLocations,
  onUpdateStagingLocation,
  onOpenDelivery,
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
  onUpdatePlannedStagingLocations: (ids: string[]) => Promise<void>;
  onUpdateStagingLocation: (stagingLocationId: string) => Promise<void>;
  onOpenDelivery: (deliveryId: string) => void;
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
  const [pendingPlannedIds, setPendingPlannedIds] = useState<string[]>(
    () => details.delivery.plannedStagingLocationIds ?? [],
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
  const plannedDirty =
    [...pendingPlannedIds].sort().join(",") !==
    [...(details.delivery.plannedStagingLocationIds ?? [])].sort().join(",");
  const locById = new Map(stagingLocations.map((loc) => [loc.id, loc]));
  const plannedDivergence = hasPlannedActualDivergence(details.delivery);
  const savedShopStockLocationNote =
    details.delivery.shopStockLocationNote ?? "";
  const parsedPickList = parseShopStockPickListLines(pickListText);
  const savedPickList = details.delivery.shopStockPickListItems ?? [];
  const isPickListDirty =
    parsedPickList.length !== savedPickList.length ||
    parsedPickList.some((line, i) => line !== savedPickList[i]) ||
    shopStockLocationNote.trim() !== savedShopStockLocationNote.trim();

  useEffect(() => {
    setPendingPlannedIds(details.delivery.plannedStagingLocationIds ?? []);
  }, [details.delivery.plannedStagingLocationIds, details.delivery.id]);

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

        <div
          data-testid="planned-staging-assignment"
          style={{ marginTop: (details.delivery.combinationStagingGroupId ||
            (details.delivery.combinationMemberLocationIds?.length ?? 0) > 0)
            ? 0
            : undefined }}
        >
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
            Planned Staging (dispatcher instruction)
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
            Choose one or more spots for receiving and pickup (e.g. G4+G5+G6 for
            pipe). {STAGING_PLAN_MISMATCH_HELPER} Click an order number on a
            blocked spot to open it, then use <strong>Move here</strong> on an
            open spot for this order.
          </p>
          {plannedDivergence ? (
            <p
              data-testid="staging-actual-location"
              style={{
                margin: "0 0 10px",
                fontSize: 12,
                fontWeight: 600,
                color: "#9a3412",
                fontFamily: font,
              }}
            >
              Actually at:{" "}
              <span style={{ fontFamily: "monospace" }}>
                {formatActualStagingCodes(details.delivery, locById) ?? "—"}
              </span>
            </p>
          ) : null}
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
          <p
            data-testid="planned-staging-current"
            style={{
              margin: "0 0 10px",
              fontSize: 12,
              fontWeight: 600,
              color: plannedDivergence ? "#9a3412" : "#4b5563",
              fontFamily: font,
            }}
          >
            Planned:{" "}
            <span style={{ fontFamily: "monospace" }}>
              {formatPlannedStagingCodes(details.delivery, locById)}
            </span>
            {plannedDivergence ? (
              <span
                data-testid="drawer-planned-divergence-badge"
                title={STAGING_PLAN_MISMATCH_TITLE}
                style={{
                  marginLeft: 8,
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
          </p>
          {(details.delivery.plannedLocationReleases ?? []).length > 0 ? (
            <div
              data-testid="planned-location-releases"
              style={{
                margin: "0 0 10px",
                padding: "8px 10px",
                borderRadius: 6,
                backgroundColor: "#f8fafc",
                border: "1px solid #e2e8f0",
                fontSize: 11,
                color: "#475569",
                fontFamily: font,
              }}
            >
              <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: 10 }}>
                Planned-spot releases
              </p>
              {(details.delivery.plannedLocationReleases ?? []).map((entry) => (
                <p key={`${entry.locationId}-${entry.releasedAt}`} style={{ margin: "0 0 4px" }}>
                  {locById.get(entry.locationId)?.code ?? entry.locationId} released{" "}
                  {entry.releasedAt.slice(0, 10)}
                  {entry.reason ? ` — ${entry.reason}` : ""}
                </p>
              ))}
            </div>
          ) : null}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              maxHeight: 180,
              overflowY: "auto",
              marginBottom: 10,
            }}
          >
            {stagingLocations.map((loc) => {
              const checked = pendingPlannedIds.includes(loc.id);
              const occupant = zoneOccupancy[loc.id];
              const unavailable = Boolean(occupant);
              return (
                <label
                  key={loc.id}
                  data-testid={`planned-staging-option-${loc.code}`}
                  data-staging-unavailable={unavailable ? "true" : undefined}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 13,
                    color: unavailable ? "#9ca3af" : "#333",
                    fontFamily: font,
                    cursor: loading || unavailable ? "not-allowed" : "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={loading || unavailable}
                    onChange={(e) => {
                      setPendingPlannedIds((prev) =>
                        e.target.checked
                          ? [...prev, loc.id]
                          : prev.filter((id) => id !== loc.id),
                      );
                    }}
                  />
                  <span
                    style={{
                      fontFamily: "monospace",
                      fontWeight: 700,
                      color: unavailable ? "#bf0a30" : "#333",
                    }}
                  >
                    {loc.code}
                  </span>
                  <span style={{ color: unavailable ? "#9ca3af" : "#6b7280" }}>
                    {loc.label}
                  </span>
                  {unavailable && occupant ? (
                    <span
                      data-testid={`planned-staging-unavailable-${loc.code}`}
                      style={{
                        marginLeft: "auto",
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#bf0a30",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Not available (in use:{" "}
                      <button
                        type="button"
                        data-testid={`open-occupant-${occupant.orderNumber}`}
                        disabled={loading}
                        onClick={(e) => {
                          e.preventDefault();
                          onOpenDelivery(occupant.deliveryId);
                        }}
                        style={{
                          padding: 0,
                          border: "none",
                          background: "none",
                          color: navy,
                          fontWeight: 800,
                          fontSize: 11,
                          cursor: loading ? "not-allowed" : "pointer",
                          textDecoration: "underline",
                          fontFamily: font,
                        }}
                      >
                        {occupant.orderNumber}
                      </button>
                      )
                    </span>
                  ) : !unavailable ? (
                    details.stagingLocation?.id === loc.id ? (
                      <span
                        data-testid={`staging-current-spot-${loc.code}`}
                        style={{
                          marginLeft: "auto",
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#2e7d32",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Current spot
                      </span>
                    ) : (
                      <button
                        type="button"
                        data-testid={`move-staging-${loc.code}`}
                        disabled={loading}
                        onClick={(e) => {
                          e.preventDefault();
                          void onUpdateStagingLocation(loc.id);
                        }}
                        style={{
                          marginLeft: "auto",
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 700,
                          fontFamily: font,
                          cursor: loading ? "not-allowed" : "pointer",
                          backgroundColor: loading ? "#f3f4f6" : "#fff",
                          color: loading ? "#9ca3af" : navy,
                          border: `1px solid ${loading ? "#d1d5db" : navy}`,
                          whiteSpace: "nowrap",
                        }}
                      >
                        Move here
                      </button>
                    )
                  ) : null}
                </label>
              );
            })}
          </div>
          <button
            type="button"
            data-testid="save-planned-staging"
            disabled={loading || !plannedDirty}
            onClick={() => void onUpdatePlannedStagingLocations(pendingPlannedIds)}
            style={{
              padding: "8px 14px",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 700,
              fontFamily: font,
              cursor: loading || !plannedDirty ? "not-allowed" : "pointer",
              backgroundColor: loading || !plannedDirty ? "#f3f4f6" : navy,
              color: loading || !plannedDirty ? "#9ca3af" : "#fff",
              border: `1.5px solid ${loading || !plannedDirty ? "#d1d5db" : navy}`,
            }}
          >
            {loading ? "Saving…" : "Save Planned Spots"}
          </button>
        </div>

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
                  {loading ? "Updating…" : `Mark ${DELIVERY_STATUS_LABEL[status]}`}
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
                {loading ? "Updating…" : `Revert to ${DELIVERY_STATUS_LABEL[revertTarget]}`}
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
