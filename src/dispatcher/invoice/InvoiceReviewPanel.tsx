import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type {
  InvoiceMatchResult,
  VendorInvoiceImportReview,
} from "../models";
import {
  approveVendorInvoiceImport,
  getVendorInvoiceImport,
  INVOICE_TRAINING_LESSON_TOAST,
  ensureApprovedUnlinkedInvoiceShells,
  listVendorInvoiceImports,
  matchInvoiceToRecords,
  reparseVendorInvoiceImport,
} from "../firestoreService";
import { vendorInvoiceImportDisplayLabelForRow } from "./invoiceDisplayHelpers";
import { AutoImportSuggestionBadge } from "./autoImportSuggestionUi";
import { InvoiceParsedInspectModal } from "./InvoiceParsedInspectModal";
import { reconcileParseWarningsForHeader } from "./reconcileParseWarningsForHeader";
import {
  formatApprovedAtDisplay,
  formatInvoiceHeaderField,
  matchUnavailableReason,
  queueRowIssueSummary,
  queueRowLineCount,
  queueRowTitle,
  readInvoiceHeaderField,
  codPaymentContext,
} from "./invoiceReviewHeaderHelpers";
import { shellDeliveryIdForImport } from "./invoiceShellDisplayHelpers";
import type { VendorInvoiceImportStatus } from "./types";
import {
  creditReturnAdvisoryLabel,
  creditReturnSkipLabel,
  isSystemAutoRejectedImport,
} from "./creditReturnSkip";
import {
  buildInvoiceApproveToastMessage,
  consumeInvoiceApproveDismissedImportId,
  consumeInvoiceApproveSuccessToast,
  INVOICE_APPROVE_FLOW_STORAGE_KEY,
} from "./invoiceApproveToast";
import type { InvoiceApproveOptions } from "./invoiceApproveToast";
import { ignoreRuleSuppressedAdvisoryLabel } from "./ignoreRuleSuppressed";

const NAVY = "#0a3161";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const INVOICE_DRAFT_STAGING_STORAGE_KEY = "sv-invoice-draft-staging";

function reviewStatusLabel(status: VendorInvoiceImportReview["reviewStatus"]): string {
  if (status === "pending_review") return "Pending review";
  if (status === "approved") return "Approved";
  return "Rejected";
}

function StatusChip({
  importStatus,
  reviewStatus,
  orderNotes,
  skipReason,
  rejectedBy,
  creditAdvisory,
  ignoreSuppressedAdvisory,
}: {
  importStatus: string;
  reviewStatus: VendorInvoiceImportReview["reviewStatus"];
  orderNotes?: string[];
  skipReason?: string;
  rejectedBy?: string;
  creditAdvisory?: string | null;
  ignoreSuppressedAdvisory?: string | null;
}) {
  const importLabel = vendorInvoiceImportDisplayLabelForRow(
    importStatus as VendorInvoiceImportStatus,
    orderNotes,
  );
  const skipLabel = creditReturnSkipLabel(skipReason, rejectedBy);
  const advisoryLabel = creditAdvisory ?? null;
  const ignoreSuppressedLabel = ignoreSuppressedAdvisory ?? null;
  const isWillCall = importStatus === "pickup_at_vendor";
  const isDeliverToSite =
    importStatus === "pending" &&
    importLabel === "Deliver to Site";
  const isIssue = importStatus === "issue";
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      <span
        data-testid="invoice-review-status-chip"
        style={{
          backgroundColor: isIssue
            ? "var(--admin-warning-bg)"
            : isWillCall
              ? "var(--admin-warning-bg)"
              : isDeliverToSite
                ? "var(--admin-success-bg)"
                : "var(--admin-info-bg)",
          color: isIssue
            ? "var(--admin-warning-text)"
            : isWillCall
              ? "var(--admin-warning-text)"
              : isDeliverToSite
                ? "var(--admin-success-text)"
                : "var(--admin-info-text)",
          fontWeight: 700,
          fontSize: 11,
          padding: "3px 8px",
          borderRadius: 999,
          whiteSpace: "nowrap",
        }}
      >
        {importLabel}
      </span>
      <span
        style={{
          backgroundColor:
            reviewStatus === "pending_review"
              ? "var(--admin-warning-bg)"
              : reviewStatus === "approved"
                ? "var(--admin-success-bg)"
                : "var(--admin-danger-bg)",
          color:
            reviewStatus === "pending_review"
              ? "var(--admin-warning-text)"
              : reviewStatus === "approved"
                ? "var(--admin-success-text)"
                : "var(--admin-danger-text)",
          fontWeight: 600,
          fontSize: 11,
          padding: "3px 8px",
          borderRadius: 999,
          whiteSpace: "nowrap",
        }}
      >
        {reviewStatusLabel(reviewStatus)}
      </span>
      {skipLabel ? (
        <span
          data-testid="invoice-review-credit-skip-chip"
          style={{
            backgroundColor: "var(--admin-surface-2)",
            color: "var(--admin-text)",
            fontWeight: 600,
            fontSize: 11,
            padding: "3px 8px",
            borderRadius: 999,
            whiteSpace: "nowrap",
          }}
        >
          {skipLabel}
        </span>
      ) : null}
      {advisoryLabel ? (
        <span
          data-testid="invoice-review-credit-advisory-chip"
          style={{
            backgroundColor: "var(--admin-danger-bg)",
            color: "var(--admin-danger-text)",
            fontWeight: 700,
            fontSize: 11,
            padding: "3px 8px",
            borderRadius: 999,
            whiteSpace: "nowrap",
            border: "1px solid var(--admin-danger-border)",
          }}
        >
          {advisoryLabel}
        </span>
      ) : null}
      {ignoreSuppressedLabel ? (
        <span
          data-testid="invoice-review-ignore-suppressed-chip"
          style={{
            backgroundColor: "var(--admin-warning-bg)",
            color: "var(--admin-warning-text)",
            fontWeight: 700,
            fontSize: 11,
            padding: "3px 8px",
            borderRadius: 999,
            whiteSpace: "nowrap",
            border: "1px solid var(--admin-warning-border)",
          }}
        >
          {ignoreSuppressedLabel}
        </span>
      ) : null}
    </div>
  );
}

function CodPaymentChip({ label }: { label: string }) {
  return (
    <span
      data-testid="invoice-review-cod-chip"
      style={{
        backgroundColor: "var(--admin-warning-bg)",
        color: "var(--admin-warning-text)",
        fontWeight: 700,
        fontSize: 11,
        padding: "3px 8px",
        borderRadius: 999,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

type QueueFilter = "pending" | "all" | "approved" | "rejected";

function formatReviewDate(iso: string | undefined, fallbackIso: string): string {
  const raw = iso ?? fallbackIso;
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function listTestId(filter: QueueFilter): string {
  if (filter === "approved") return "invoice-review-approved-list";
  if (filter === "rejected") return "invoice-review-rejected-list";
  return "invoice-review-queue";
}

function listHeading(filter: QueueFilter): string {
  if (filter === "approved") return "Approved invoices";
  if (filter === "rejected") return "Rejected invoices";
  return "Review queue";
}

function isArchiveFilter(filter: QueueFilter): boolean {
  return filter === "approved" || filter === "rejected";
}

const ARCHIVE_NAV_BUTTON_STYLE = {
  backgroundColor: NAVY,
  color: "var(--admin-on-navy)",
  border: "none",
  minHeight: "var(--admin-control-height)",
  borderRadius: "var(--admin-control-radius)",
  padding: "0 16px",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
} as const;

function LinkedDeliveryBadge({ linkedDeliveryOrderId }: { linkedDeliveryOrderId?: string }) {
  const linked = Boolean(linkedDeliveryOrderId?.trim());
  return (
    <span
      data-testid="invoice-review-linked-badge"
      title={linked ? linkedDeliveryOrderId : undefined}
      style={{
        backgroundColor: linked ? "var(--admin-success-bg)" : "var(--admin-surface-2)",
        color: linked ? "var(--admin-success-text)" : "var(--admin-text-muted)",
        fontWeight: 600,
        fontSize: 11,
        padding: "3px 8px",
        borderRadius: 999,
        whiteSpace: "nowrap",
      }}
    >
      {linked ? "Linked" : "Not linked to delivery"}
    </span>
  );
}

function FieldCell({
  label,
  value,
  testId,
  minWidth,
  showFullValue,
}: {
  label: string;
  value: string;
  testId?: string;
  minWidth?: number;
  showFullValue?: boolean;
}) {
  return (
    <div style={{ minWidth: minWidth ?? 0 }} data-testid={testId}>
      <div style={{ color: "var(--admin-text-muted)", fontSize: 10, fontWeight: 600, textTransform: "uppercase" }}>
        {label}
      </div>
      <div
        data-testid="invoice-review-field-value"
        style={{
          color: "var(--admin-text-data)",
          fontSize: 12,
          fontWeight: value === "—" ? 400 : 500,
          overflow: showFullValue ? "visible" : "hidden",
          textOverflow: showFullValue ? undefined : "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={value === "—" ? undefined : value}
      >
        {value}
      </div>
    </div>
  );
}

export function InvoiceReviewPanel({
  syncedImports,
  refreshGeneration = 0,
  backfillErrors = null,
  onApproveSuccess,
}: {
  syncedImports?: VendorInvoiceImportReview[] | null;
  refreshGeneration?: number;
  backfillErrors?: string[] | null;
  onApproveSuccess?: () => Promise<void>;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [imports, setImports] = useState<VendorInvoiceImportReview[]>([]);
  const [matchById, setMatchById] = useState<Record<string, InvoiceMatchResult>>({});
  const [matchUnavailableById, setMatchUnavailableById] = useState<Record<string, string>>(
    {},
  );
  const [matchLoadingId, setMatchLoadingId] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [reparseLoadingId, setReparseLoadingId] = useState<string | null>(null);
  const [reparseMessage, setReparseMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [trainingToast, setTrainingToast] = useState<string | null>(null);
  const [filter, setFilter] = useState<QueueFilter>("pending");
  const [inspectImport, setInspectImport] =
    useState<VendorInvoiceImportReview | null>(null);
  const lastAppliedGeneration = useRef(0);
  const inspectDeepLinkHandled = useRef<string | null>(null);
  const dismissedApprovedImportIdRef = useRef<string | null>(
    consumeInvoiceApproveDismissedImportId(),
  );

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(INVOICE_DRAFT_STAGING_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        importId: string;
        draftPlannedStagingLocationIds: string[];
      };
      sessionStorage.removeItem(INVOICE_DRAFT_STAGING_STORAGE_KEY);
      const mergeDraft = (
        row: VendorInvoiceImportReview,
      ): VendorInvoiceImportReview =>
        row.id === parsed.importId
          ? {
              ...row,
              draftPlannedStagingLocationIds: parsed.draftPlannedStagingLocationIds,
            }
          : row;
      setImports((prev) => prev.map(mergeDraft));
      setInspectImport((prev) => (prev ? mergeDraft(prev) : prev));
    } catch {
      sessionStorage.removeItem(INVOICE_DRAFT_STAGING_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    const toast = consumeInvoiceApproveSuccessToast();
    if (toast) setSuccessMessage(toast);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const inspectId = params.get("inspectInvoiceImport")?.trim();
    if (!inspectId) return;
    if (inspectDeepLinkHandled.current === inspectId) return;
    inspectDeepLinkHandled.current = inspectId;

    const nextParams = new URLSearchParams(location.search);
    nextParams.delete("inspectInvoiceImport");
    const search = nextParams.toString();
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : "" },
      { replace: true },
    );

    setFilter("pending");

    const queued = imports.find((row) => row.id === inspectId);
    if (queued) {
      setInspectImport(queued);
    }

    void getVendorInvoiceImport(inspectId)
      .then((row) => {
        setInspectImport(row);
        setImports((prev) => {
          const idx = prev.findIndex((item) => item.id === row.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = { ...next[idx], ...row };
            return next;
          }
          return [row, ...prev];
        });
      })
      .catch((err) => {
        setError(
          err instanceof Error ? err.message : "Could not open invoice import.",
        );
      });
  }, [location.pathname, location.search, navigate]);

  const showTrainingToast = (message: string) => {
    setTrainingToast(message);
    window.setTimeout(() => setTrainingToast(null), 4000);
  };

  const applyImports = useCallback((items: VendorInvoiceImportReview[]) => {
    const dismissedId = dismissedApprovedImportIdRef.current;
    if (dismissedId) {
      const row = items.find((item) => item.id === dismissedId);
      if (!row || row.reviewStatus !== "pending_review") {
        dismissedApprovedImportIdRef.current = null;
      }
    }
    setImports(items);
  }, []);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let items = await listVendorInvoiceImports({ limit: 50 });
      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const { linkedCount, errors } = await ensureApprovedUnlinkedInvoiceShells(items);
      if (linkedCount > 0) {
        items = await listVendorInvoiceImports({ limit: 50 });
        items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      }
      applyImports(items);
      if (errors.length > 0) {
        setError(errors.join(" "));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load invoice imports.");
    } finally {
      setLoading(false);
    }
  }, [applyImports]);

  useEffect(() => {
    if (
      syncedImports &&
      refreshGeneration > lastAppliedGeneration.current
    ) {
      lastAppliedGeneration.current = refreshGeneration;
      applyImports(syncedImports);
      setLoading(false);
      setError(
        backfillErrors && backfillErrors.length > 0 ? backfillErrors.join(" ") : null,
      );
      return;
    }
    if (syncedImports == null) {
      void loadQueue();
    }
  }, [syncedImports, refreshGeneration, backfillErrors, applyImports, loadQueue]);

  const filteredImports = useMemo(() => {
    if (filter === "all") return imports;
    if (filter === "approved") {
      return imports.filter((i) => i.reviewStatus === "approved");
    }
    if (filter === "rejected") {
      return imports.filter((i) => i.reviewStatus === "rejected");
    }
    return imports.filter(
      (i) =>
        i.reviewStatus === "pending_review" &&
        i.id !== dismissedApprovedImportIdRef.current,
    );
  }, [imports, filter]);

  const approvedCount = useMemo(
    () => imports.filter((i) => i.reviewStatus === "approved").length,
    [imports],
  );

  const rejectedCount = useMemo(
    () => imports.filter((i) => i.reviewStatus === "rejected").length,
    [imports],
  );

  const loadMatchForRow = useCallback(async (rowId: string) => {
    const row = imports.find((i) => i.id === rowId);
    if (!row) return;

    const unavailable = matchUnavailableReason(row);
    if (unavailable) {
      setMatchUnavailableById((prev) =>
        prev[rowId] === unavailable ? prev : { ...prev, [rowId]: unavailable },
      );
      return;
    }

    setMatchLoadingId(rowId);
    try {
      const result = await matchInvoiceToRecords(rowId);
      setMatchById((prev) => ({ ...prev, [rowId]: result }));
      setMatchUnavailableById((prev) => {
        if (!prev[rowId]) return prev;
        const next = { ...prev };
        delete next[rowId];
        return next;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Match lookup failed.";
      setMatchUnavailableById((prev) =>
        prev[rowId] === message ? prev : { ...prev, [rowId]: message },
      );
    } finally {
      setMatchLoadingId((current) => (current === rowId ? null : current));
    }
  }, [imports]);

  useEffect(() => {
    if (!inspectImport) return;
    if (
      inspectImport.reviewStatus !== "pending_review" &&
      inspectImport.reviewStatus !== "rejected"
    ) {
      return;
    }
    if (inspectImport.importStatus === "issue") return;

    const rowId = inspectImport.id;
    const unavailable = matchUnavailableReason(inspectImport);
    if (unavailable) {
      setMatchUnavailableById((prev) =>
        prev[rowId] === unavailable ? prev : { ...prev, [rowId]: unavailable },
      );
      return;
    }

    if (
      matchById[rowId] ||
      matchLoadingId === rowId ||
      matchUnavailableById[rowId]
    ) {
      return;
    }
    void loadMatchForRow(rowId);
  }, [
    inspectImport,
    matchById,
    matchLoadingId,
    matchUnavailableById,
    loadMatchForRow,
  ]);

  const submitApprove = async (
    row: VendorInvoiceImportReview,
    correctionNote?: string,
    options?: InvoiceApproveOptions,
  ) => {
    if (row.importStatus === "issue") return;
    setActionLoadingId(row.id);
    setError(null);
    setSuccessMessage(null);
    try {
      const fulfillmentDecision = options?.fulfillmentDecision;
      const plannedStagingLocationIds = options?.plannedStagingLocationIds;
      const result = await approveVendorInvoiceImport({
        vendorInvoiceImportId: row.id,
        action: "approve",
        ...(correctionNote?.trim()
          ? { correctionNote: correctionNote.trim() }
          : {}),
        ...(plannedStagingLocationIds && plannedStagingLocationIds.length > 0
          ? { plannedStagingLocationIds }
          : {}),
        ...(fulfillmentDecision ? { fulfillmentDecision } : {}),
      });
      if (result.importDismissed) {
        const lessonNote = result.trainingLessonWrote
          ? " Training lesson saved for future invoices."
          : result.trainingLessonPendingAdminReview
            ? " Training note pending Admin review."
            : "";
        setSuccessMessage(`Credit/return import dismissed from queue.${lessonNote}`);
        if (result.trainingLessonWrote) {
          showTrainingToast(INVOICE_TRAINING_LESSON_TOAST);
        } else if (result.trainingLessonPendingAdminReview) {
          showTrainingToast(
            "This note is pending Admin review — patterns may need a fix before it can be saved.",
          );
        }
        sessionStorage.removeItem(INVOICE_APPROVE_FLOW_STORAGE_KEY);
        setInspectImport(null);
        await loadQueue();
        if (onApproveSuccess) {
          await onApproveSuccess();
        }
        return;
      }
      if (result.shellError?.trim()) {
        setError(result.shellError);
        setInspectImport(null);
        await loadQueue();
        if (onApproveSuccess) {
          await onApproveSuccess();
        }
        return;
      }
      if (!result.deliveryOrderId?.trim() && fulfillmentDecision === "delivery") {
        setError(
          "Approved but no dashboard delivery was created. Use Refresh Now to retry shell create.",
        );
        setInspectImport(null);
        await loadQueue();
        if (onApproveSuccess) {
          await onApproveSuccess();
        }
        return;
      }
      const lessonNote = result.trainingLessonWrote
        ? " Training lesson saved for future invoices."
        : result.trainingLessonPendingAdminReview
          ? " Training note pending Admin review."
          : "";
      const approveToast = buildInvoiceApproveToastMessage(
        result,
        fulfillmentDecision,
      );
      setSuccessMessage(`${approveToast}${lessonNote}`);
      if (result.trainingLessonWrote) {
        showTrainingToast(INVOICE_TRAINING_LESSON_TOAST);
      } else if (result.trainingLessonPendingAdminReview) {
        showTrainingToast(
          "This note is pending Admin review — patterns may need a fix before it can be saved.",
        );
      }
      sessionStorage.removeItem(INVOICE_APPROVE_FLOW_STORAGE_KEY);
      if (onApproveSuccess) {
        await onApproveSuccess();
      }
      setInspectImport(null);
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed.");
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleReject = async (
    row: VendorInvoiceImportReview,
    rejectLessonNote?: string,
  ) => {
    setActionLoadingId(row.id);
    setError(null);
    try {
      const result = await approveVendorInvoiceImport({
        vendorInvoiceImportId: row.id,
        action: "reject",
        ...(rejectLessonNote?.trim()
          ? { correctionNote: rejectLessonNote.trim() }
          : {}),
      });
      if (result.trainingLessonWrote) {
        showTrainingToast(INVOICE_TRAINING_LESSON_TOAST);
      } else if (result.trainingLessonPendingAdminReview) {
        showTrainingToast(
          "This note is pending Admin review — patterns may need a fix before it can be saved.",
        );
      }
      setInspectImport(null);
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reject failed.");
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleReopen = async (row: VendorInvoiceImportReview) => {
    setActionLoadingId(row.id);
    setError(null);
    try {
      await approveVendorInvoiceImport({
        vendorInvoiceImportId: row.id,
        action: "reopen",
      });
      setInspectImport(null);
      setFilter("pending");
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Re-open failed.");
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleRelinkToShell = async (row: VendorInvoiceImportReview) => {
    if (row.reviewStatus !== "approved" || row.importStatus === "issue") return;
    const linkedId = row.linkedDeliveryOrderId?.trim() ?? "";
    const shellId = shellDeliveryIdForImport(row.id);
    if (!linkedId || linkedId === shellId) return;
    setActionLoadingId(row.id);
    setError(null);
    setSuccessMessage(null);
    try {
      const result = await approveVendorInvoiceImport({
        vendorInvoiceImportId: row.id,
        action: "relink_to_shell",
      });
      setSuccessMessage(
        `Separate delivery created: ${result.deliveryOrderId ?? shellId}.`,
      );
      setInspectImport(null);
      await loadQueue();
      if (onApproveSuccess) {
        await onApproveSuccess();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create separate delivery failed.");
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleReparse = async (row: VendorInvoiceImportReview) => {
    setReparseLoadingId(row.id);
    setReparseMessage(null);
    setError(null);
    try {
      const result = await reparseVendorInvoiceImport(row.id);
      setInspectImport(result.import);
      setImports((prev) =>
        prev.map((item) => (item.id === result.import.id ? result.import : item)),
      );
      const delta = result.reparse.newLineCount - result.reparse.previousLineCount;
      const deltaLabel =
        delta === 0
          ? "unchanged"
          : delta > 0
            ? `+${delta} line(s)`
            : `${delta} line(s)`;
      setReparseMessage(
        `Refreshed — ${result.reparse.newLineCount} line(s) (${deltaLabel}).`,
      );
    } catch (err) {
      setReparseMessage(
        err instanceof Error ? err.message : "Refresh failed.",
      );
    } finally {
      setReparseLoadingId(null);
    }
  };

  const inspectRowId = inspectImport?.id ?? null;
  const inspectNeedsSeparateDelivery = Boolean(
    inspectImport &&
      inspectImport.reviewStatus === "approved" &&
      inspectImport.importStatus !== "issue" &&
      inspectImport.linkedDeliveryOrderId?.trim() &&
      inspectImport.linkedDeliveryOrderId.trim() !==
        shellDeliveryIdForImport(inspectImport.id),
  );

  return (
    <div
      data-testid="invoice-review-panel"
      style={{
        fontFamily: FONT,
      }}
    >
      <div
        data-testid={listTestId(filter)}
        className="admin-table-wrap"
        style={{
          backgroundColor: "var(--admin-surface)",
        }}
      >
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--admin-border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontWeight: 700, color: "var(--admin-text-label)", fontSize: 14 }}>
            {listHeading(filter)}
          </span>
          {!isArchiveFilter(filter) && (
            <select
              className="admin-control"
              value={filter}
              onChange={(e) => setFilter(e.target.value as QueueFilter)}
              style={{
                fontSize: 12,
                padding: "4px 8px",
                borderRadius: "var(--admin-control-radius)",
                border: "1px solid var(--admin-border)",
              }}
            >
              <option value="pending">Pending only</option>
              <option value="all">All imports</option>
            </select>
          )}
        </div>

        {!loading && filteredImports.length === 0 && (
          <p
            data-testid={
              filter === "approved"
                ? "invoice-review-approved-empty"
                : filter === "rejected"
                  ? "invoice-review-rejected-empty"
                  : "invoice-review-empty"
            }
            style={{ padding: 16, color: "var(--admin-text-muted)", fontSize: 13, margin: 0 }}
          >
            {filter === "approved"
              ? "No approved invoices yet. Approve imports from the review queue to see them here."
              : filter === "rejected"
                ? "No rejected invoices yet. Rejected invoices appear here after you reject from the review queue."
              : filter === "pending" &&
                  imports.some((i) => i.reviewStatus !== "pending_review")
                ? "No pending imports — open Approved or Rejected invoices below, or switch to All imports."
                : "No invoice imports in queue. Use Refresh Now to sync Gmail, then check All imports if a message was already processed without a queued invoice."}
          </p>
        )}

        {loading && (
          <p style={{ padding: 16, color: "var(--admin-text-muted)", fontSize: 13, margin: 0 }}>
            Loading…
          </p>
        )}

        {filteredImports.map((row) => {
          const header = row.parsedHeader;
          const issueSummary = queueRowIssueSummary(row);
          const lineCount = queueRowLineCount(row);
          const rowActionLoading = actionLoadingId === row.id;
          const codContext = codPaymentContext(row);

          return (
            <div
              key={row.id}
              data-testid={`invoice-review-queue-row-${row.id}`}
              style={{
                borderBottom: "1px solid var(--admin-border)",
                backgroundColor: "var(--admin-surface)",
                padding: "14px 16px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: 16,
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                }}
              >
                <div
                  role="button"
                  tabIndex={0}
                  data-testid={`invoice-review-row-content-${row.id}`}
                  onClick={() => setInspectImport(row)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setInspectImport(row);
                    }
                  }}
                  style={{
                    flex: "1 1 480px",
                    minWidth: 0,
                    padding: 0,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <div style={{ marginBottom: 8 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        color: "var(--admin-text-label)",
                        fontSize: 14,
                        marginBottom: 6,
                      }}
                    >
                      {queueRowTitle(row)}
                      <span style={{ fontWeight: 400, color: "var(--admin-text-muted)", fontSize: 12 }}>
                        {" "}
                        · {row.pageId}
                      </span>
                    </div>
                    <StatusChip
                      importStatus={row.importStatus}
                      reviewStatus={row.reviewStatus}
                      orderNotes={row.orderNotes}
                      skipReason={row.skipReason}
                      rejectedBy={row.rejectedBy}
                      creditAdvisory={creditReturnAdvisoryLabel(row)}
                      ignoreSuppressedAdvisory={ignoreRuleSuppressedAdvisoryLabel(row)}
                    />
                    <AutoImportSuggestionBadge importRow={row} compact />
                    {codContext && <CodPaymentChip label={codContext.chipLabel} />}
                  </div>

                  <div
                    data-testid={
                      filter === "approved" ? "invoice-review-approved-fields" : undefined
                    }
                    style={
                      filter === "approved"
                        ? {
                            display: "grid",
                            width: "100%",
                            alignItems: "end",
                            columnGap: 24,
                            rowGap: 10,
                            gridTemplateColumns:
                              "minmax(108px, 1.1fr) minmax(108px, 1.1fr) minmax(128px, 1.4fr) minmax(168px, 2.2fr) minmax(176px, 1.7fr) minmax(88px, max-content)",
                          }
                        : {
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))",
                            gap: "10px 14px",
                          }
                    }
                  >
                    <FieldCell
                      label="Invoice #"
                      value={formatInvoiceHeaderField(
                        readInvoiceHeaderField(header, "vendorInvoiceNumber"),
                      )}
                    />
                    <FieldCell
                      label="S/O #"
                      value={formatInvoiceHeaderField(
                        readInvoiceHeaderField(header, "vendorOrderNumber"),
                      )}
                    />
                    <FieldCell
                      label="P/O #"
                      value={formatInvoiceHeaderField(
                        readInvoiceHeaderField(header, "customerPoOrReference"),
                      )}
                    />
                    <FieldCell
                      label="Buyer"
                      value={formatInvoiceHeaderField(
                        readInvoiceHeaderField(header, "buyerName"),
                      )}
                    />
                    {filter === "approved" ? (
                      <>
                        <FieldCell
                          label="Approved"
                          value={formatApprovedAtDisplay(row.approvedAt, row.updatedAt)}
                          testId="invoice-review-approved-at"
                          minWidth={158}
                          showFullValue
                        />
                        <div style={{ minWidth: 0, display: "flex", alignItems: "flex-end" }}>
                          <LinkedDeliveryBadge
                            linkedDeliveryOrderId={row.linkedDeliveryOrderId}
                          />
                        </div>
                      </>
                    ) : filter === "rejected" ? (
                      <>
                        <FieldCell
                          label="Rejected"
                          value={formatReviewDate(row.rejectedAt, row.updatedAt)}
                        />
                        <div style={{ minWidth: 0, display: "flex", alignItems: "flex-end" }}>
                          <LinkedDeliveryBadge
                            linkedDeliveryOrderId={row.linkedDeliveryOrderId}
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <FieldCell
                          label="Branch"
                          value={formatInvoiceHeaderField(
                            readInvoiceHeaderField(header, "vendorBranchName"),
                          )}
                        />
                        <FieldCell
                          label="Order date"
                          value={formatInvoiceHeaderField(
                            readInvoiceHeaderField(header, "orderDate"),
                          )}
                        />
                        <FieldCell label="Lines" value={String(lineCount)} />
                      </>
                    )}
                  </div>

                  {issueSummary ? (
                    <div
                      data-testid="invoice-review-row-issue"
                      style={{
                        marginTop: 10,
                        fontSize: 12,
                        color: "var(--admin-warning-text)",
                        lineHeight: 1.4,
                      }}
                    >
                      {issueSummary}
                    </div>
                  ) : (
                    !isArchiveFilter(filter) &&
                    row.reviewStatus !== "pending_review" &&
                    row.linkedDeliveryOrderId && (
                      <div style={{ marginTop: 10, fontSize: 12, color: "var(--admin-success-text)" }}>
                        Linked delivery: {row.linkedDeliveryOrderId}
                      </div>
                    )
                  )}
                </div>

                {filter === "rejected" &&
                  row.reviewStatus === "rejected" &&
                  isSystemAutoRejectedImport(row) && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      gap: 4,
                      flexShrink: 0,
                    }}
                  >
                    <button
                      type="button"
                      className="admin-btn"
                      data-testid={`invoice-review-reopen-${row.id}`}
                      disabled={rowActionLoading}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleReopen(row);
                      }}
                      style={{
                        backgroundColor: "var(--admin-surface)",
                        color: "var(--admin-text-label)",
                        border: "1px solid var(--admin-border)",
                        borderRadius: "var(--admin-control-radius)",
                        padding: "6px 10px",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: rowActionLoading ? "not-allowed" : "pointer",
                        opacity: rowActionLoading ? 0.6 : 1,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Re-open
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          marginTop: 16,
          display: "flex",
          justifyContent: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
        data-testid="invoice-review-archive-nav"
      >
        {isArchiveFilter(filter) ? (
          <button
            type="button"
            className="admin-btn"
            data-testid="invoice-review-back-to-queue"
            onClick={() => setFilter("pending")}
            style={{
              backgroundColor: "var(--admin-surface)",
              color: "var(--admin-text-label)",
              border: "1px solid var(--admin-border)",
              borderRadius: "var(--admin-control-radius)",
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Back to review queue
          </button>
        ) : (
          <>
            <button
              type="button"
              data-testid="invoice-review-approved-link"
              onClick={() => setFilter("approved")}
              style={ARCHIVE_NAV_BUTTON_STYLE}
            >
              Approved invoices
              {approvedCount > 0 ? ` (${approvedCount})` : ""}
            </button>
            <button
              type="button"
              data-testid="invoice-review-rejected-link"
              onClick={() => setFilter("rejected")}
              style={ARCHIVE_NAV_BUTTON_STYLE}
            >
              Rejected invoices
              {rejectedCount > 0 ? ` (${rejectedCount})` : ""}
            </button>
          </>
        )}
      </div>

      {error && (
        <div
          data-testid="invoice-review-error-banner"
          style={{
            marginTop: 12,
            padding: "10px 12px",
            backgroundColor: "var(--admin-danger-bg)",
            color: "var(--admin-danger-text)",
            borderRadius: "var(--admin-radius-sm)",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {successMessage && (
        <div
          data-testid="invoice-review-success-banner"
          style={{
            marginTop: 12,
            padding: "10px 12px",
            backgroundColor: "var(--admin-success-bg)",
            color: "var(--admin-success-text)",
            borderRadius: "var(--admin-radius-sm)",
            fontSize: 13,
          }}
        >
          {successMessage}
        </div>
      )}

      {trainingToast && (
        <div
          data-testid="invoice-review-training-toast"
          role="status"
          style={{
            position: "fixed",
            bottom: 28,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10000,
            backgroundColor: "var(--admin-navy)",
            color: "var(--admin-on-navy)",
            padding: "12px 18px",
            borderRadius: "var(--admin-radius-md)",
            fontSize: 14,
            fontWeight: 600,
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
            maxWidth: "min(520px, 92vw)",
            textAlign: "center",
          }}
        >
          {trainingToast}
        </div>
      )}

      {inspectImport && (
        <InvoiceParsedInspectModal
          importRow={inspectImport}
          onClose={() => {
            setInspectImport(null);
            setReparseMessage(null);
          }}
          reparseLoading={reparseLoadingId === inspectImport.id}
          reparseMessage={reparseMessage}
          onReparse={
            inspectImport.reviewStatus === "pending_review" ||
            (inspectImport.reviewStatus === "rejected" &&
              inspectImport.skipReason === "credit_return")
              ? () => {
                  void handleReparse(inspectImport);
                }
              : undefined
          }
          matchResult={inspectRowId ? (matchById[inspectRowId] ?? null) : null}
          matchLoading={inspectRowId ? matchLoadingId === inspectRowId : false}
          actionLoading={actionLoadingId === inspectImport.id}
          onApprove={
            inspectImport.reviewStatus === "pending_review" ||
            inspectImport.reviewStatus === "rejected"
              ? (correctionNote, options) => {
                  void submitApprove(inspectImport, correctionNote, options);
                }
              : undefined
          }
          onReject={
            inspectImport.reviewStatus === "pending_review"
              ? (rejectLessonNote) => {
                  void handleReject(inspectImport, rejectLessonNote);
                }
              : undefined
          }
          onReopen={
            inspectImport.reviewStatus === "rejected" &&
            isSystemAutoRejectedImport(inspectImport)
              ? () => {
                  void handleReopen(inspectImport);
                }
              : undefined
          }
          onRelinkToShell={
            inspectNeedsSeparateDelivery
              ? () => {
                  void handleRelinkToShell(inspectImport);
                }
              : undefined
          }
          onCorrectionApplied={(result) => {
            const mergeRow = (
              row: VendorInvoiceImportReview,
            ): VendorInvoiceImportReview => {
              // Merge corrected field into the current authoritative header —
              // never replace the whole header with a partial apply payload.
              const parsedHeader = {
                ...(row.parsedHeader ?? {}),
                ...(result.parsedHeader ?? {}),
                [result.field]: result.newValue,
              };
              const parseWarnings = result.parseWarnings
                ? result.parseWarnings
                : reconcileParseWarningsForHeader(
                    row.parseWarnings,
                    parsedHeader,
                  );
              return {
                ...row,
                parsedHeader,
                parseWarnings,
                ...(result.autoImportEligible !== undefined
                  ? { autoImportEligible: result.autoImportEligible }
                  : {}),
                ...(result.autoImportConfidence !== undefined
                  ? { autoImportConfidence: result.autoImportConfidence }
                  : {}),
                ...(result.autoImportReasons
                  ? { autoImportReasons: result.autoImportReasons }
                  : {}),
                ...(result.reviewRequiredReasons
                  ? { reviewRequiredReasons: result.reviewRequiredReasons }
                  : {}),
                ...(result.importDecisionMode
                  ? { importDecisionMode: result.importDecisionMode }
                  : {}),
                ...(result.suggestedAction
                  ? { suggestedAction: result.suggestedAction }
                  : {}),
              };
            };
            setInspectImport((prev) => (prev ? mergeRow(prev) : prev));
            setImports((prev) =>
              prev.map((row) =>
                row.id === inspectImport.id ? mergeRow(row) : row,
              ),
            );
          }}
          onImportRowMerged={(patch) => {
            const mergeRow = (
              row: VendorInvoiceImportReview,
            ): VendorInvoiceImportReview => ({
              ...row,
              parsedHeader: patch.parsedHeader ?? row.parsedHeader,
              importStatus: patch.importStatus ?? row.importStatus,
              fulfillmentOverride: patch.fulfillmentOverride ?? row.fulfillmentOverride,
              draftPlannedStagingLocationIds:
                patch.draftPlannedStagingLocationIds ??
                row.draftPlannedStagingLocationIds,
              ...(patch.parseWarnings ? { parseWarnings: patch.parseWarnings } : {}),
              ...(patch.autoImportEligible !== undefined
                ? { autoImportEligible: patch.autoImportEligible }
                : {}),
              ...(patch.autoImportConfidence !== undefined
                ? { autoImportConfidence: patch.autoImportConfidence }
                : {}),
              ...(patch.autoImportReasons
                ? { autoImportReasons: patch.autoImportReasons }
                : {}),
              ...(patch.reviewRequiredReasons
                ? { reviewRequiredReasons: patch.reviewRequiredReasons }
                : {}),
              ...(patch.importDecisionMode
                ? { importDecisionMode: patch.importDecisionMode }
                : {}),
              ...(patch.suggestedAction
                ? { suggestedAction: patch.suggestedAction }
                : {}),
            });
            setInspectImport((prev) => (prev ? mergeRow(prev) : prev));
            setImports((prev) =>
              prev.map((row) =>
                row.id === inspectImport.id ? mergeRow(row) : row,
              ),
            );
          }}
          onImportDismissed={() => {
            setInspectImport(null);
            void loadQueue();
          }}
        />
      )}
    </div>
  );
}
