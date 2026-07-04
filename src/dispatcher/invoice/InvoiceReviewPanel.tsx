import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DeliveryListRow,
  InvoiceMatchResult,
  VendorInvoiceImportReview,
} from "../models";
import {
  approveVendorInvoiceImport,
  firestoreDataService,
  listVendorInvoiceImports,
  matchInvoiceToRecords,
} from "../firestoreService";
import { vendorInvoiceImportDisplayLabel } from "./invoiceDisplayHelpers";
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
const RED = "#bf0a30";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

function reviewStatusLabel(status: VendorInvoiceImportReview["reviewStatus"]): string {
  if (status === "pending_review") return "Pending review";
  if (status === "approved") return "Approved";
  return "Rejected";
}

function StatusChip({
  importStatus,
  reviewStatus,
}: {
  importStatus: string;
  reviewStatus: VendorInvoiceImportReview["reviewStatus"];
}) {
  const importLabel = vendorInvoiceImportDisplayLabel(
    importStatus as VendorInvoiceImportStatus,
  );
  const isWillCall = importStatus === "pickup_at_vendor";
  const isIssue = importStatus === "issue";
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      <span
        data-testid="invoice-review-status-chip"
        style={{
          backgroundColor: isIssue ? "#fff7ed" : isWillCall ? "#fef3c7" : "#e8f0fe",
          color: isIssue ? "#9a3412" : isWillCall ? "#92400e" : NAVY,
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
}: {
  syncedImports?: VendorInvoiceImportReview[] | null;
  refreshGeneration?: number;
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
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [inspectImport, setInspectImport] =
    useState<VendorInvoiceImportReview | null>(null);
  const [approvePromptForId, setApprovePromptForId] = useState<string | null>(null);
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
      const items = await listVendorInvoiceImports({ limit: 50 });
      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      applyImports(items);
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
      setError(null);
      return;
    }
    if (syncedImports == null) {
      void loadQueue();
    }
  }, [syncedImports, refreshGeneration, applyImports, loadQueue]);

  const filteredImports = useMemo(() => {
    if (filter === "all") return imports;
    return imports.filter((i) => i.reviewStatus === "pending_review");
  }, [imports, filter]);

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
    if (!inspectImport || inspectImport.reviewStatus !== "pending_review") return;

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

  const submitApprove = async (row: VendorInvoiceImportReview, deliveryId: string) => {
    if (!deliveryId.trim() || row.importStatus === "issue") return;
    setActionLoadingId(row.id);
    setError(null);
    try {
      await approveVendorInvoiceImport({
        vendorInvoiceImportId: row.id,
        action: "approve",
        deliveryOrderId: deliveryId.trim(),
      });
      setInspectImport(null);
      setApprovePromptForId(null);
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed.");
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleApprove = async (row: VendorInvoiceImportReview) => {
    const deliveryId = deliveryById[row.id]?.trim() ?? "";
    if (row.importStatus === "issue") return;

    if (!deliveryId) {
      setApprovePromptForId(row.id);
      setInspectImport(row);
      return;
    }

    await submitApprove(row, deliveryId);
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
      setApprovePromptForId(null);
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reject failed.");
    } finally {
      setActionLoadingId(null);
    }
  };

  const firstPendingRowId = filteredImports.find(
    (r) => r.reviewStatus === "pending_review",
  )?.id;

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
        data-testid="invoice-review-queue"
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
            Review queue
          </span>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as "pending" | "all")}
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
        </div>

        {!loading && filteredImports.length === 0 && (
          <p
            data-testid="invoice-review-empty"
            style={{ padding: 16, color: "#6b7280", fontSize: 13, margin: 0 }}
          >
            {filter === "pending" && imports.some((i) => i.reviewStatus !== "pending_review")
              ? "No pending imports — switch to All imports or use Refresh Now to sync Gmail."
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
          const approveBlocked = row.importStatus === "issue";
          const issueSummary = queueRowIssueSummary(row);
          const lineCount = queueRowLineCount(row);
          const selectedDeliveryId = deliveryById[row.id] ?? "";
          const rowActionLoading = actionLoadingId === row.id;
          const isFirstPending = row.id === firstPendingRowId;
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
                  onClick={() => {
                    setApprovePromptForId(null);
                    setInspectImport(row);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setApprovePromptForId(null);
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
                    />
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
                      label="P/O #"
                      value={formatInvoiceHeaderField(
                        readInvoiceHeaderField(header, "customerPoOrReference"),
                      )}
                    />
                    <FieldCell
                      label="S/O #"
                      value={formatInvoiceHeaderField(
                        readInvoiceHeaderField(header, "vendorOrderNumber"),
                      )}
                    />
                    <FieldCell
                      label="Invoice #"
                      value={formatInvoiceHeaderField(
                        readInvoiceHeaderField(header, "vendorInvoiceNumber"),
                      )}
                    />
                    <FieldCell
                      label="Buyer"
                      value={formatInvoiceHeaderField(
                        readInvoiceHeaderField(header, "buyerName"),
                      )}
                    />
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
                    row.reviewStatus !== "pending_review" &&
                    row.linkedDeliveryOrderId && (
                      <div style={{ marginTop: 10, fontSize: 12, color: "#166534" }}>
                        Linked delivery: {row.linkedDeliveryOrderId}
                      </div>
                    )
                  )}
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 4,
                    flexShrink: 0,
                  }}
                >
                  {row.reviewStatus === "pending_review" && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <button
                        type="button"
                        data-testid={
                          isFirstPending
                            ? "invoice-review-approve"
                            : `invoice-review-approve-${row.id}`
                        }
                        disabled={rowActionLoading || approveBlocked}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleApprove(row);
                        }}
                        title={
                          approveBlocked
                            ? "Approve blocked for issue imports"
                            : !selectedDeliveryId
                              ? "Opens inspect modal to pick or enter delivery ID"
                              : undefined
                        }
                        style={{
                          backgroundColor: NAVY,
                          color: "#fff",
                          border: "none",
                          borderRadius: 4,
                          padding: "6px 10px",
                          fontSize: 12,
                          fontWeight: 700,
                          cursor:
                            rowActionLoading || approveBlocked
                              ? "not-allowed"
                              : "pointer",
                          opacity:
                            rowActionLoading || approveBlocked
                              ? 0.55
                              : 1,
                          whiteSpace: "nowrap",
                        }}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        data-testid={
                          isFirstPending
                            ? "invoice-review-reject"
                            : `invoice-review-reject-${row.id}`
                        }
                        disabled={rowActionLoading}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleReject(row);
                        }}
                        style={{
                          backgroundColor: "#fff",
                          color: RED,
                          border: `1px solid ${RED}`,
                          borderRadius: 4,
                          padding: "6px 10px",
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: rowActionLoading ? "not-allowed" : "pointer",
                          opacity: rowActionLoading ? 0.6 : 1,
                          whiteSpace: "nowrap",
                        }}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                  {approveBlocked && row.reviewStatus === "pending_review" && (
                    <span
                      data-testid="invoice-review-approve-blocked-copy"
                      style={{ fontSize: 10, color: "#9a3412", lineHeight: 1.3 }}
                    >
                      Approve blocked — issue import
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <div
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

      {inspectImport && (
        <InvoiceParsedInspectModal
          importRow={inspectImport}
          onClose={() => {
            setInspectImport(null);
            setApprovePromptForId(null);
          }}
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
          highlightApprove={approvePromptForId === inspectImport.id}
          onApprove={
            inspectImport.reviewStatus === "pending_review"
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
        />
      )}
    </div>
  );
}
