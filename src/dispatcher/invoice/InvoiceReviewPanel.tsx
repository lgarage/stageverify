import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  InvoiceDeliveryMatchCandidate,
  InvoiceMatchResult,
  VendorInvoiceImportReview,
} from "../models";
import {
  approveVendorInvoiceImport,
  listVendorInvoiceImports,
  matchInvoiceToRecords,
} from "../firestoreService";
import { vendorInvoiceImportDisplayLabel } from "./invoiceDisplayHelpers";
import { InvoiceParsedInspectModal } from "./InvoiceParsedInspectModal";
import {
  formatInvoiceHeaderField,
  matchUnavailableReason,
  shipDateMissingWarning,
  queueRowIssueSummary,
  queueRowLineCount,
  queueRowTitle,
  readInvoiceHeaderField,
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

function MatchSection({
  row,
  matchResult,
  matchLoading,
  matchUnavailable,
  shipDateWarning,
  selectedDeliveryId,
  onSelectDelivery,
}: {
  row: VendorInvoiceImportReview;
  matchResult: InvoiceMatchResult | null;
  matchLoading: boolean;
  matchUnavailable: string | null;
  shipDateWarning: string | null;
  selectedDeliveryId: string;
  onSelectDelivery: (deliveryId: string) => void;
}) {
  if (row.reviewStatus !== "pending_review") return null;

  return (
    <div
      data-testid={`invoice-review-row-match-${row.id}`}
      style={{
        marginTop: 12,
        paddingTop: 12,
        borderTop: "1px solid #e5e7eb",
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: NAVY, marginBottom: 8 }}>
        Match to delivery
      </div>
      {shipDateWarning && (
        <p
          data-testid="invoice-review-ship-date-warning"
          style={{ fontSize: 12, color: "#b45309", margin: "0 0 8px", lineHeight: 1.4 }}
        >
          {shipDateWarning}
        </p>
      )}
      {matchUnavailable && (
        <p
          data-testid="invoice-review-match-unavailable"
          style={{ fontSize: 12, color: "#9a3412", margin: 0, lineHeight: 1.4 }}
        >
          {matchUnavailable}
        </p>
      )}
      {matchLoading && !matchUnavailable && (
        <p style={{ fontSize: 12, color: "#6b7280", margin: 0 }}>Finding candidates…</p>
      )}
      {!matchLoading && !matchUnavailable && matchResult && (
        <>
          <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 8px" }}>
            {matchResult.confidenceReason} (score {matchResult.confidenceScore})
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {matchResult.candidates.length === 0 && (
              <p style={{ fontSize: 12, color: "#b45309", margin: 0 }}>
                No delivery candidates — reject or wait for a matching order.
              </p>
            )}
            {matchResult.candidates.map((c: InvoiceDeliveryMatchCandidate) => (
              <label
                key={c.deliveryId}
                data-testid="invoice-review-match-candidate"
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  padding: "8px 10px",
                  border:
                    selectedDeliveryId === c.deliveryId
                      ? `2px solid ${RED}`
                      : "1px solid #e0e3e8",
                  borderRadius: 6,
                  cursor: "pointer",
                  backgroundColor:
                    selectedDeliveryId === c.deliveryId ? "#fff5f7" : "#fff",
                }}
              >
                <input
                  type="radio"
                  name={`invoice-match-${row.id}`}
                  checked={selectedDeliveryId === c.deliveryId}
                  onChange={() => onSelectDelivery(c.deliveryId)}
                  style={{ marginTop: 2 }}
                />
                <div>
                  <div style={{ fontWeight: 700, color: NAVY, fontSize: 12 }}>
                    {c.orderNumber}
                  </div>
                  <div style={{ fontSize: 11, color: "#6b7280" }}>
                    {c.matchReasons.join(" · ")} · score {c.confidenceScore}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </>
      )}
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
  const lastAppliedGeneration = useRef(0);

  const applyImports = useCallback((items: VendorInvoiceImportReview[]) => {
    setImports(items);
    setExpandedId((prev) => {
      if (prev && items.some((i) => i.id === prev)) return prev;
      return items.find((i) => i.reviewStatus === "pending_review")?.id ?? null;
    });
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
        setDeliveryById((prev) => ({ ...prev, [rowId]: top }));
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

  useEffect(() => {
    if (!expandedId) return;
    const row = imports.find((i) => i.id === expandedId);
    if (!row || row.reviewStatus !== "pending_review") return;

    const unavailable = matchUnavailableReason(row);
    if (unavailable) {
      setMatchUnavailableById((prev) =>
        prev[expandedId] === unavailable ? prev : { ...prev, [expandedId]: unavailable },
      );
      return;
    }

    if (
      matchById[expandedId] ||
      matchLoadingId === expandedId ||
      matchUnavailableById[expandedId]
    ) {
      return;
    }
    void loadMatchForRow(expandedId);
  }, [
    expandedId,
    imports,
    matchById,
    matchLoadingId,
    matchUnavailableById,
    loadMatchForRow,
  ]);

  const handleApprove = async (row: VendorInvoiceImportReview) => {
    const deliveryId = deliveryById[row.id];
    if (!deliveryId || row.importStatus === "issue") return;
    if (!expandedId || expandedId !== row.id) {
      setExpandedId(row.id);
      if (!matchById[row.id]) {
        await loadMatchForRow(row.id);
      }
      if (!deliveryById[row.id]) return;
    }
    setActionLoadingId(row.id);
    setError(null);
    try {
      await approveVendorInvoiceImport({
        vendorInvoiceImportId: row.id,
        action: "approve",
        deliveryOrderId: deliveryById[row.id],
      });
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
          const expanded = expandedId === row.id;
          const matchResult = matchById[row.id] ?? null;
          const matchUnavailable = matchUnavailableById[row.id] ?? null;
          const selectedDeliveryId = deliveryById[row.id] ?? "";
          const rowActionLoading = actionLoadingId === row.id;
          const isFirstPending = row.id === firstPendingRowId;
          const shipDateWarning = shipDateMissingWarning(row);

          return (
            <div
              key={row.id}
              data-testid={`invoice-review-queue-row-${row.id}`}
              style={{
                borderBottom: "1px solid #e0e3e8",
                backgroundColor: expanded ? "#f8fafc" : "#fff",
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
                    />
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
                    gap: 6,
                    flexShrink: 0,
                    minWidth: 140,
                  }}
                >
                  {row.reviewStatus === "pending_review" && (
                    <>
                      <button
                        type="button"
                        data-testid={
                          isFirstPending
                            ? "invoice-review-approve"
                            : `invoice-review-approve-${row.id}`
                        }
                        disabled={
                          rowActionLoading || approveBlocked || !selectedDeliveryId
                        }
                        onClick={() => void handleApprove(row)}
                        title={
                          approveBlocked
                            ? "Approve blocked for issue imports"
                            : !selectedDeliveryId
                              ? "Open Match to delivery and select a candidate"
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
                            rowActionLoading || approveBlocked || !selectedDeliveryId
                              ? "not-allowed"
                              : "pointer",
                          opacity:
                            rowActionLoading || approveBlocked || !selectedDeliveryId
                              ? 0.55
                              : 1,
                        }}
                      >
                        Approve
                      </button>
                      {approveBlocked && (
                        <span
                          data-testid="invoice-review-approve-blocked-copy"
                          style={{ fontSize: 10, color: "#9a3412", lineHeight: 1.3 }}
                        >
                          Approve blocked — issue import
                        </span>
                      )}
                      <button
                        type="button"
                        data-testid={
                          isFirstPending
                            ? "invoice-review-reject"
                            : `invoice-review-reject-${row.id}`
                        }
                        disabled={rowActionLoading}
                        onClick={() => void handleReject(row)}
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
                        }}
                      >
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </div>

              {row.reviewStatus === "pending_review" && (
                <button
                  type="button"
                  data-testid={`invoice-review-match-toggle-${row.id}`}
                  onClick={() => setExpandedId(expanded ? null : row.id)}
                  style={{
                    marginTop: 10,
                    background: "none",
                    border: "none",
                    padding: 0,
                    color: NAVY,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  {expanded ? "Hide delivery match" : "Match to delivery"}
                </button>
              )}

              {expanded && (
                <MatchSection
                  row={row}
                  matchResult={matchResult}
                  matchLoading={matchLoadingId === row.id}
                  matchUnavailable={matchUnavailable}
                  shipDateWarning={shipDateWarning}
                  selectedDeliveryId={selectedDeliveryId}
                  onSelectDelivery={(deliveryId) =>
                    setDeliveryById((prev) => ({ ...prev, [row.id]: deliveryId }))
                  }
                />
              )}
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
          onClose={() => setInspectImport(null)}
        />
      )}
    </div>
  );
}
