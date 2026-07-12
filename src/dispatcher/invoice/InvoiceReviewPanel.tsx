import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DeliveryListRow,
  InvoiceMatchResult,
  VendorInvoiceImportReview,
} from "../models";
import {
  approveVendorInvoiceImport,
  ensureApprovedUnlinkedInvoiceShells,
  firestoreDataService,
  listVendorInvoiceImports,
  matchInvoiceToRecords,
} from "../firestoreService";
import { vendorInvoiceImportDisplayLabelForRow } from "./invoiceDisplayHelpers";
import { AutoImportSuggestionBadge } from "./autoImportSuggestionUi";
import { InvoiceParsedInspectModal } from "./InvoiceParsedInspectModal";
import {
  formatInvoiceHeaderField,
  matchUnavailableReason,
  queueRowIssueSummary,
  queueRowLineCount,
  queueRowTitle,
  readInvoiceHeaderField,
  codPaymentContext,
} from "./invoiceReviewHeaderHelpers";
import type { VendorInvoiceImportStatus } from "./types";

const NAVY = "#0a3161";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

function reviewStatusLabel(status: VendorInvoiceImportReview["reviewStatus"]): string {
  if (status === "pending_review") return "Pending review";
  if (status === "approved") return "Approved";
  return "Rejected";
}

function StatusChip({
  importStatus,
  reviewStatus,
  orderNotes,
}: {
  importStatus: string;
  reviewStatus: VendorInvoiceImportReview["reviewStatus"];
  orderNotes?: string[];
}) {
  const importLabel = vendorInvoiceImportDisplayLabelForRow(
    importStatus as VendorInvoiceImportStatus,
    orderNotes,
  );
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
            ? "#fff7ed"
            : isWillCall
              ? "#fef3c7"
              : isDeliverToSite
                ? "#ecfdf5"
                : "#e8f0fe",
          color: isIssue
            ? "#9a3412"
            : isWillCall
              ? "#92400e"
              : isDeliverToSite
                ? "#166534"
                : NAVY,
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
              ? "#fff7ed"
              : reviewStatus === "approved"
                ? "#ecfdf5"
                : "#fef2f2",
          color:
            reviewStatus === "pending_review"
              ? "#9a3412"
              : reviewStatus === "approved"
                ? "#166534"
                : "#991b1b",
          fontWeight: 600,
          fontSize: 11,
          padding: "3px 8px",
          borderRadius: 999,
          whiteSpace: "nowrap",
        }}
      >
        {reviewStatusLabel(reviewStatus)}
      </span>
    </div>
  );
}

function CodPaymentChip({ label }: { label: string }) {
  return (
    <span
      data-testid="invoice-review-cod-chip"
      style={{
        backgroundColor: "#fef3c7",
        color: "#92400e",
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
  color: "#fff",
  border: "none",
  borderRadius: 4,
  padding: "8px 16px",
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
        backgroundColor: linked ? "#ecfdf5" : "#f3f4f6",
        color: linked ? "#166534" : "#6b7280",
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

function FieldCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ color: "#9ca3af", fontSize: 10, fontWeight: 600, textTransform: "uppercase" }}>
        {label}
      </div>
      <div
        style={{
          color: NAVY,
          fontSize: 12,
          fontWeight: value === "—" ? 400 : 500,
          overflow: "hidden",
          textOverflow: "ellipsis",
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
  const [imports, setImports] = useState<VendorInvoiceImportReview[]>([]);
  const [matchById, setMatchById] = useState<Record<string, InvoiceMatchResult>>({});
  const [matchUnavailableById, setMatchUnavailableById] = useState<Record<string, string>>(
    {},
  );
  const [deliveryById, setDeliveryById] = useState<Record<string, string>>({});
  const [matchLoadingId, setMatchLoadingId] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<QueueFilter>("pending");
  const [inspectImport, setInspectImport] =
    useState<VendorInvoiceImportReview | null>(null);
  const [recentDeliveries, setRecentDeliveries] = useState<DeliveryListRow[]>([]);
  const [recentDeliveriesLoading, setRecentDeliveriesLoading] = useState(false);
  const lastAppliedGeneration = useRef(0);

  const applyImports = useCallback((items: VendorInvoiceImportReview[]) => {
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
    return imports.filter((i) => i.reviewStatus === "pending_review");
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
      const top =
        result.deliveryOrderId ?? result.candidates[0]?.deliveryId ?? "";
      if (top) {
        setDeliveryById((prev) => (prev[rowId] ? prev : { ...prev, [rowId]: top }));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Match lookup failed.";
      setMatchUnavailableById((prev) =>
        prev[rowId] === message ? prev : { ...prev, [rowId]: message },
      );
    } finally {
      setMatchLoadingId((current) => (current === rowId ? null : current));
    }
  }, [imports]);

  const loadRecentDeliveries = useCallback(async () => {
    setRecentDeliveriesLoading(true);
    try {
      const result = await firestoreDataService.listDeliveries({
        pageSize: 30,
        sortBy: "deliveryDate",
        sortDirection: "desc",
      });
      setRecentDeliveries(result.items);
    } catch {
      setRecentDeliveries([]);
    } finally {
      setRecentDeliveriesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!inspectImport) return;

    const needsDeliveryPicker =
      (inspectImport.reviewStatus === "pending_review" ||
        inspectImport.reviewStatus === "rejected" ||
        (inspectImport.reviewStatus === "approved" &&
          !inspectImport.linkedDeliveryOrderId?.trim())) &&
      inspectImport.importStatus !== "issue";

    if (!needsDeliveryPicker) return;

    void loadRecentDeliveries();

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
    loadRecentDeliveries,
  ]);

  const submitApprove = async (
    row: VendorInvoiceImportReview,
    deliveryId?: string,
  ) => {
    if (row.importStatus === "issue") return;
    setActionLoadingId(row.id);
    setError(null);
    setSuccessMessage(null);
    try {
      const trimmedDeliveryId = deliveryId?.trim() ?? "";
      const result = await approveVendorInvoiceImport({
        vendorInvoiceImportId: row.id,
        action: "approve",
        ...(trimmedDeliveryId ? { deliveryOrderId: trimmedDeliveryId } : {}),
      });
      if (!trimmedDeliveryId) {
        if (result.shellError?.trim()) {
          setError(result.shellError);
          return;
        }
        if (!result.deliveryOrderId?.trim()) {
          setError(
            "Approved but no dashboard delivery was created. Use Refresh Now or link a delivery manually.",
          );
          return;
        }
        const jobNote = result.jobCreated ? " New job created from invoice P/O." : "";
        setSuccessMessage(
          `Approved — delivery ${result.deliveryOrderId} is on the dispatcher dashboard.${jobNote}`,
        );
        if (onApproveSuccess) {
          await onApproveSuccess();
        }
      }
      setInspectImport(null);
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed.");
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleReject = async (row: VendorInvoiceImportReview) => {
    setActionLoadingId(row.id);
    setError(null);
    try {
      await approveVendorInvoiceImport({
        vendorInvoiceImportId: row.id,
        action: "reject",
      });
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

  const handleLink = async (row: VendorInvoiceImportReview, deliveryId?: string) => {
    if (row.importStatus === "issue" || row.linkedDeliveryOrderId?.trim()) return;
    const trimmedDeliveryId = deliveryId?.trim() ?? "";
    if (!trimmedDeliveryId) {
      setError("Select a delivery to link.");
      return;
    }
    setActionLoadingId(row.id);
    setError(null);
    try {
      await approveVendorInvoiceImport({
        vendorInvoiceImportId: row.id,
        action: "link",
        deliveryOrderId: trimmedDeliveryId,
      });
      setInspectImport(null);
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Link failed.");
    } finally {
      setActionLoadingId(null);
    }
  };

  const inspectRowId = inspectImport?.id ?? null;
  const inspectSelectedDeliveryId = inspectRowId ? (deliveryById[inspectRowId] ?? "") : "";

  return (
    <div
      data-testid="invoice-review-panel"
      style={{
        fontFamily: FONT,
        minHeight: 480,
      }}
    >
      <div
        data-testid={listTestId(filter)}
        style={{
          backgroundColor: "#fff",
          border: "1px solid #e0e3e8",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid #e0e3e8",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontWeight: 700, color: NAVY, fontSize: 14 }}>
            {listHeading(filter)}
          </span>
          {!isArchiveFilter(filter) && (
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as QueueFilter)}
              style={{
                fontSize: 12,
                padding: "4px 8px",
                borderRadius: 4,
                border: "1px solid #d1d5db",
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
            style={{ padding: 16, color: "#6b7280", fontSize: 13, margin: 0 }}
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
          <p style={{ padding: 16, color: "#6b7280", fontSize: 13, margin: 0 }}>
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
                borderBottom: "1px solid #e0e3e8",
                backgroundColor: "#fff",
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
                        color: NAVY,
                        fontSize: 14,
                        marginBottom: 6,
                      }}
                    >
                      {queueRowTitle(row)}
                      <span style={{ fontWeight: 400, color: "#9ca3af", fontSize: 12 }}>
                        {" "}
                        · {row.pageId}
                      </span>
                    </div>
                    <StatusChip
                      importStatus={row.importStatus}
                      reviewStatus={row.reviewStatus}
                      orderNotes={row.orderNotes}
                    />
                    <AutoImportSuggestionBadge importRow={row} compact />
                    {codContext && <CodPaymentChip label={codContext.chipLabel} />}
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))",
                      gap: "10px 14px",
                    }}
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
                          value={formatReviewDate(row.approvedAt, row.updatedAt)}
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
                        color: "#9a3412",
                        lineHeight: 1.4,
                      }}
                    >
                      {issueSummary}
                    </div>
                  ) : (
                    !isArchiveFilter(filter) &&
                    row.reviewStatus !== "pending_review" &&
                    row.linkedDeliveryOrderId && (
                      <div style={{ marginTop: 10, fontSize: 12, color: "#166534" }}>
                        Linked delivery: {row.linkedDeliveryOrderId}
                      </div>
                    )
                  )}
                </div>

                {filter === "rejected" && row.reviewStatus === "rejected" && (
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
                      data-testid={`invoice-review-reopen-${row.id}`}
                      disabled={rowActionLoading}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleReopen(row);
                      }}
                      style={{
                        backgroundColor: "#fff",
                        color: NAVY,
                        border: `1px solid ${NAVY}`,
                        borderRadius: 4,
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
            data-testid="invoice-review-back-to-queue"
            onClick={() => setFilter("pending")}
            style={{
              backgroundColor: "#fff",
              color: NAVY,
              border: `1px solid ${NAVY}`,
              borderRadius: 4,
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
            backgroundColor: "#fef2f2",
            color: "#991b1b",
            borderRadius: 6,
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
            backgroundColor: "#ecfdf5",
            color: "#166534",
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          {successMessage}
        </div>
      )}

      {inspectImport && (
        <InvoiceParsedInspectModal
          importRow={inspectImport}
          onClose={() => setInspectImport(null)}
          matchResult={inspectRowId ? (matchById[inspectRowId] ?? null) : null}
          matchLoading={inspectRowId ? matchLoadingId === inspectRowId : false}
          selectedDeliveryId={inspectSelectedDeliveryId}
          onSelectDelivery={(deliveryId) => {
            if (!inspectRowId) return;
            setDeliveryById((prev) => ({ ...prev, [inspectRowId]: deliveryId }));
          }}
          recentDeliveries={recentDeliveries}
          recentDeliveriesLoading={recentDeliveriesLoading}
          actionLoading={actionLoadingId === inspectImport.id}
          onApprove={
            inspectImport.reviewStatus === "pending_review" ||
            inspectImport.reviewStatus === "rejected"
              ? () => {
                  void submitApprove(inspectImport, inspectSelectedDeliveryId);
                }
              : undefined
          }
          onReject={
            inspectImport.reviewStatus === "pending_review"
              ? () => {
                  void handleReject(inspectImport);
                }
              : undefined
          }
          onReopen={
            inspectImport.reviewStatus === "rejected"
              ? () => {
                  void handleReopen(inspectImport);
                }
              : undefined
          }
          onLink={
            inspectImport.reviewStatus === "approved" &&
            !inspectImport.linkedDeliveryOrderId?.trim()
              ? () => {
                  void handleLink(inspectImport, inspectSelectedDeliveryId);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
