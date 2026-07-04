import { useCallback, useEffect, useMemo, useState } from "react";
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
import type { VendorInvoiceImportStatus } from "./types";

const NAVY = "#0a3161";
const RED = "#bf0a30";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

function headerString(
  header: Record<string, unknown> | undefined,
  key: string,
): string {
  const v = header?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : "—";
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso.slice(0, 16);
  }
}

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
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      <span
        data-testid="invoice-review-status-chip"
        style={{
          backgroundColor: isWillCall ? "#fef3c7" : "#e8f0fe",
          color: isWillCall ? "#92400e" : NAVY,
          fontWeight: 700,
          fontSize: 12,
          padding: "4px 10px",
          borderRadius: 999,
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
          fontSize: 12,
          padding: "4px 10px",
          borderRadius: 999,
        }}
      >
        {reviewStatusLabel(reviewStatus)}
      </span>
    </div>
  );
}

export function InvoiceReviewPanel({
  onRegisterLoadQueue,
}: {
  onRegisterLoadQueue?: (loadQueue: () => Promise<void>) => void;
}) {
  const [imports, setImports] = useState<VendorInvoiceImportReview[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [matchResult, setMatchResult] = useState<InvoiceMatchResult | null>(null);
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [matchLoading, setMatchLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "all">("pending");

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await listVendorInvoiceImports({ limit: 50 });
      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setImports(items);
      setSelectedId((prev) => {
        if (prev && items.some((i) => i.id === prev)) return prev;
        const firstPending = items.find((i) => i.reviewStatus === "pending_review");
        return firstPending?.id ?? items[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load invoice imports.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    onRegisterLoadQueue?.(loadQueue);
  }, [loadQueue, onRegisterLoadQueue]);

  const selected = useMemo(
    () => imports.find((i) => i.id === selectedId) ?? null,
    [imports, selectedId],
  );

  const filteredImports = useMemo(() => {
    if (filter === "all") return imports;
    return imports.filter((i) => i.reviewStatus === "pending_review");
  }, [imports, filter]);

  useEffect(() => {
    if (!selected || selected.reviewStatus !== "pending_review") {
      setMatchResult(null);
      setSelectedDeliveryId("");
      return;
    }

    let cancelled = false;
    setMatchLoading(true);
    setError(null);
    void matchInvoiceToRecords(selected.id)
      .then((result) => {
        if (cancelled) return;
        setMatchResult(result);
        const top =
          result.deliveryOrderId ??
          result.candidates[0]?.deliveryId ??
          "";
        setSelectedDeliveryId(top);
      })
      .catch((err) => {
        if (cancelled) return;
        setMatchResult(null);
        setError(err instanceof Error ? err.message : "Match lookup failed.");
      })
      .finally(() => {
        if (!cancelled) setMatchLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selected]);

  const handleApprove = async () => {
    if (!selected || !selectedDeliveryId) return;
    setActionLoading(true);
    setError(null);
    try {
      await approveVendorInvoiceImport({
        vendorInvoiceImportId: selected.id,
        action: "approve",
        deliveryOrderId: selectedDeliveryId,
      });
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!selected) return;
    setActionLoading(true);
    setError(null);
    try {
      await approveVendorInvoiceImport({
        vendorInvoiceImportId: selected.id,
        action: "reject",
      });
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reject failed.");
    } finally {
      setActionLoading(false);
    }
  };

  const header = selected?.parsedHeader;

  return (
    <div
      data-testid="invoice-review-panel"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(280px, 340px) 1fr",
        gap: 16,
        minHeight: 480,
        fontFamily: FONT,
      }}
    >
      <div
        data-testid="invoice-review-queue"
        style={{
          backgroundColor: "#fff",
          border: "1px solid #e0e3e8",
          borderRadius: 8,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
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
            onChange={(e) =>
              setFilter(e.target.value as "pending" | "all")
            }
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
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading && (
            <p style={{ padding: 16, color: "#6b7280", fontSize: 13 }}>
              Loading…
            </p>
          )}
          {!loading && filteredImports.length === 0 && (
            <p style={{ padding: 16, color: "#6b7280", fontSize: 13 }}>
              {filter === "pending" && imports.some((i) => i.reviewStatus !== "pending_review")
                ? "No pending imports — switch to All imports or use Refresh Now to sync Gmail."
                : "No invoice imports in queue. Use Refresh Now to sync Gmail, then check All imports if a message was already processed without a queued invoice."}
            </p>
          )}
          {filteredImports.map((row) => {
            const active = row.id === selectedId;
            const invoiceNum = headerString(row.parsedHeader, "vendorInvoiceNumber");
            const po = headerString(row.parsedHeader, "customerPoOrReference");
            return (
              <button
                key={row.id}
                type="button"
                data-testid={`invoice-review-queue-row-${row.id}`}
                onClick={() => setSelectedId(row.id)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "12px 16px",
                  border: "none",
                  borderBottom: "1px solid #f0f2f5",
                  backgroundColor: active ? "#f0f4ff" : "#fff",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 700, color: NAVY, fontSize: 13 }}>
                  Invoice {invoiceNum !== "—" ? invoiceNum : row.pageId}
                </div>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                  {po}
                </div>
                <div style={{ marginTop: 8 }}>
                  <StatusChip
                    importStatus={row.importStatus}
                    reviewStatus={row.reviewStatus}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div
        data-testid="invoice-review-detail"
        style={{
          backgroundColor: "#fff",
          border: "1px solid #e0e3e8",
          borderRadius: 8,
          padding: 20,
          overflowY: "auto",
        }}
      >
        {!selected && (
          <p style={{ color: "#6b7280", fontSize: 14 }}>
            Select an import from the queue to review lines and match a delivery.
          </p>
        )}

        {selected && (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 16,
              }}
            >
              <div>
                <h2
                  style={{
                    margin: 0,
                    fontSize: 18,
                    fontWeight: 700,
                    color: NAVY,
                  }}
                >
                  Invoice {headerString(header, "vendorInvoiceNumber")}
                </h2>
                <p style={{ margin: "6px 0 0", fontSize: 13, color: "#6b7280" }}>
                  Sales order {headerString(header, "vendorOrderNumber")} · Received{" "}
                  {formatDate(selected.createdAt)}
                </p>
              </div>
              <StatusChip
                importStatus={selected.importStatus}
                reviewStatus={selected.reviewStatus}
              />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12,
                marginBottom: 20,
                fontSize: 13,
              }}
            >
              <div>
                <div style={{ color: "#6b7280", fontWeight: 600 }}>Customer P/O #</div>
                <div style={{ color: NAVY, fontWeight: 600 }}>
                  {headerString(header, "customerPoOrReference")}
                </div>
              </div>
              <div>
                <div style={{ color: "#6b7280", fontWeight: 600 }}>Branch</div>
                <div style={{ color: NAVY }}>
                  {headerString(header, "vendorBranchName")}
                  {headerString(header, "vendorBranchPhone") !== "—" && (
                    <>
                      {" "}
                      ·{" "}
                      <a
                        href={`tel:${headerString(header, "vendorBranchPhone").replace(/\D/g, "")}`}
                        style={{ color: RED }}
                      >
                        {headerString(header, "vendorBranchPhone")}
                      </a>
                    </>
                  )}
                </div>
              </div>
              <div>
                <div style={{ color: "#6b7280", fontWeight: 600 }}>Buyer</div>
                <div>{headerString(header, "buyerName")}</div>
              </div>
              <div>
                <div style={{ color: "#6b7280", fontWeight: 600 }}>Confidence</div>
                <div>{selected.confidenceScore}%</div>
              </div>
            </div>

            <h3
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: NAVY,
                margin: "0 0 10px",
              }}
            >
              Line items
            </h3>
            <div style={{ overflowX: "auto", marginBottom: 20 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ backgroundColor: "#f8fafc", textAlign: "left" }}>
                    <th style={{ padding: "8px 10px" }}>LN</th>
                    <th style={{ padding: "8px 10px" }}>Product</th>
                    <th style={{ padding: "8px 10px" }}>Description</th>
                    <th style={{ padding: "8px 10px" }}>Ord</th>
                    <th style={{ padding: "8px 10px" }}>Ship</th>
                    <th style={{ padding: "8px 10px" }}>B/O</th>
                  </tr>
                </thead>
                <tbody>
                  {(selected.parsedLines ?? []).map((line) => (
                    <tr
                      key={line.lineNumber}
                      data-testid="invoice-review-line-row"
                      style={{
                        borderTop: "1px solid #e5e7eb",
                        opacity: line.excludeFromExpectedItems ? 0.55 : 1,
                      }}
                    >
                      <td style={{ padding: "8px 10px" }}>{line.lineNumber}</td>
                      <td style={{ padding: "8px 10px", fontWeight: 600 }}>
                        {line.vendorProductNumber}
                      </td>
                      <td style={{ padding: "8px 10px" }}>{line.description}</td>
                      <td style={{ padding: "8px 10px" }}>{line.quantityOrdered}</td>
                      <td style={{ padding: "8px 10px" }}>{line.quantityShipped}</td>
                      <td style={{ padding: "8px 10px" }}>{line.quantityBackordered}</td>
                    </tr>
                  ))}
                  {(selected.parsedLines ?? []).length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ padding: 16, color: "#6b7280" }}>
                        No parsed lines on this import.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {selected.reviewStatus === "pending_review" && (
              <>
                <h3
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: NAVY,
                    margin: "0 0 10px",
                  }}
                >
                  Match to delivery
                </h3>
                {matchLoading && (
                  <p style={{ fontSize: 13, color: "#6b7280" }}>Finding candidates…</p>
                )}
                {!matchLoading && matchResult && (
                  <>
                    <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 10 }}>
                      {matchResult.confidenceReason} (score {matchResult.confidenceScore})
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {matchResult.candidates.length === 0 && (
                        <p style={{ fontSize: 13, color: "#b45309" }}>
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
                            gap: 10,
                            padding: "10px 12px",
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
                            name="invoice-match"
                            checked={selectedDeliveryId === c.deliveryId}
                            onChange={() => setSelectedDeliveryId(c.deliveryId)}
                            style={{ marginTop: 3 }}
                          />
                          <div>
                            <div style={{ fontWeight: 700, color: NAVY }}>
                              {c.orderNumber}
                            </div>
                            <div style={{ fontSize: 12, color: "#6b7280" }}>
                              {c.matchReasons.join(" · ")} · score {c.confidenceScore}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </>
                )}

                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    marginTop: 20,
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    type="button"
                    data-testid="invoice-review-approve"
                    disabled={actionLoading || !selectedDeliveryId}
                    onClick={() => void handleApprove()}
                    style={{
                      backgroundColor: NAVY,
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      padding: "10px 18px",
                      fontWeight: 700,
                      fontSize: 14,
                      cursor:
                        actionLoading || !selectedDeliveryId ? "not-allowed" : "pointer",
                      opacity: actionLoading || !selectedDeliveryId ? 0.6 : 1,
                    }}
                  >
                    Approve & apply expected items
                  </button>
                  <button
                    type="button"
                    data-testid="invoice-review-reject"
                    disabled={actionLoading}
                    onClick={() => void handleReject()}
                    style={{
                      backgroundColor: "#fff",
                      color: RED,
                      border: `1px solid ${RED}`,
                      borderRadius: 6,
                      padding: "10px 18px",
                      fontWeight: 700,
                      fontSize: 14,
                      cursor: actionLoading ? "not-allowed" : "pointer",
                      opacity: actionLoading ? 0.6 : 1,
                    }}
                  >
                    Reject
                  </button>
                </div>
              </>
            )}

            {selected.reviewStatus !== "pending_review" && selected.linkedDeliveryOrderId && (
              <p style={{ fontSize: 13, color: "#166534", fontWeight: 600 }}>
                Linked delivery: {selected.linkedDeliveryOrderId}
              </p>
            )}
          </>
        )}

        {error && (
          <div
            style={{
              marginTop: 16,
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
      </div>
    </div>
  );
}
