import type { DeliveryListRow, InvoiceDeliveryMatchCandidate, InvoiceMatchResult, VendorInvoiceImportReview } from "../models";

const NAVY = "#0a3161";
const RED = "#bf0a30";

export function InvoiceDeliveryMatchSection({
  importRow,
  matchResult,
  matchLoading,
  matchUnavailable,
  shipDateWarning,
  selectedDeliveryId,
  onSelectDelivery,
  recentDeliveries,
  recentDeliveriesLoading,
}: {
  importRow: VendorInvoiceImportReview;
  matchResult: InvoiceMatchResult | null;
  matchLoading: boolean;
  matchUnavailable: string | null;
  shipDateWarning: string | null;
  selectedDeliveryId: string;
  onSelectDelivery: (deliveryId: string) => void;
  recentDeliveries?: DeliveryListRow[];
  recentDeliveriesLoading?: boolean;
}) {
  if (importRow.reviewStatus !== "pending_review") return null;

  return (
    <div
      data-testid="invoice-delivery-match-section"
      style={{
        marginBottom: 20,
        padding: "14px 16px",
        backgroundColor: "#f8fafc",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
      }}
    >
      <h3 style={{ fontSize: 14, fontWeight: 700, color: NAVY, margin: "0 0 10px" }}>
        Delivery match
      </h3>
      <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 12px", lineHeight: 1.45 }}>
        Optional — link this import to a delivery when you have a match. Approve works from
        parsed data alone; linking applies expected line items to that delivery.
      </p>

      {shipDateWarning && (
        <p
          data-testid="invoice-review-ship-date-warning"
          style={{ fontSize: 12, color: "#b45309", margin: "0 0 10px", lineHeight: 1.4 }}
        >
          {shipDateWarning}
        </p>
      )}

      {matchUnavailable && (
        <p
          data-testid="invoice-review-match-unavailable"
          style={{ fontSize: 12, color: "#9a3412", margin: "0 0 10px", lineHeight: 1.4 }}
        >
          {matchUnavailable}
        </p>
      )}

      {matchLoading && !matchUnavailable && (
        <p data-testid="invoice-delivery-match-loading" style={{ fontSize: 12, color: "#6b7280", margin: "0 0 10px" }}>
          Finding candidates…
        </p>
      )}

      {!matchLoading && !matchUnavailable && matchResult && (
        <>
          <p
            data-testid="invoice-delivery-match-confidence"
            style={{ fontSize: 12, color: "#6b7280", margin: "0 0 8px" }}
          >
            {matchResult.confidenceReason} (score {matchResult.confidenceScore})
          </p>
          {matchResult.candidates.length === 0 && (
            <p
              data-testid="invoice-delivery-match-no-candidates"
              style={{ fontSize: 12, color: "#b45309", margin: "0 0 10px" }}
            >
              No delivery candidates — you can still approve from parsed data, or link manually below.
            </p>
          )}
          {matchResult.candidates.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
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
                    name={`invoice-match-${importRow.id}`}
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
          )}
        </>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: NAVY }}>
            Delivery ID (manual)
          </span>
          <input
            type="text"
            data-testid="invoice-delivery-manual-id"
            value={selectedDeliveryId}
            onChange={(e) => onSelectDelivery(e.target.value.trim())}
            placeholder="Paste or type delivery order ID"
            style={{
              fontSize: 13,
              padding: "8px 10px",
              border: "1px solid #d1d5db",
              borderRadius: 6,
              fontFamily: "inherit",
            }}
          />
        </label>

        {(recentDeliveriesLoading || (recentDeliveries && recentDeliveries.length > 0)) && (
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: NAVY }}>
              Recent deliveries
            </span>
            <select
              data-testid="invoice-delivery-recent-select"
              value={
                recentDeliveries?.some((d) => d.deliveryId === selectedDeliveryId)
                  ? selectedDeliveryId
                  : ""
              }
              disabled={recentDeliveriesLoading}
              onChange={(e) => {
                if (e.target.value) onSelectDelivery(e.target.value);
              }}
              style={{
                fontSize: 13,
                padding: "8px 10px",
                border: "1px solid #d1d5db",
                borderRadius: 6,
                fontFamily: "inherit",
              }}
            >
              <option value="">
                {recentDeliveriesLoading ? "Loading deliveries…" : "Choose a delivery…"}
              </option>
              {(recentDeliveries ?? []).map((d) => (
                <option key={d.deliveryId} value={d.deliveryId}>
                  {d.orderNumber} · {d.jobNumber} · {d.vendorName} ({d.deliveryDate})
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}
