import type { DeliveryDetails } from "../models";

const RED = "#bf0a30";

export function DeliverToSitePanel({
  details,
  navy,
  font,
  loading,
  onSetConfirmed,
}: {
  details: DeliveryDetails;
  navy: string;
  font: string;
  loading: boolean;
  onSetConfirmed: (confirmed: boolean) => Promise<void>;
}) {
  const delivery = details.delivery;
  if (delivery.invoiceDeliverToSite !== true) return null;

  const siteLabel = delivery.invoiceDeliverToLabel?.trim() || "Job site";
  const confirmed = delivery.invoiceDeliverToSiteConfirmed === true;
  const confirmedAt = delivery.invoiceDeliverToSiteConfirmedAt;
  const confirmedBy = delivery.invoiceDeliverToSiteConfirmedBy?.trim();

  return (
    <div
      data-testid="deliver-to-site-panel"
      style={{
        marginBottom: 12,
        padding: "12px 14px",
        borderRadius: 8,
        border: `1px solid ${confirmed ? "#bbf7d0" : "#fecaca"}`,
        backgroundColor: confirmed ? "#f0fdf4" : "#fff1f2",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "#64748b",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 6,
        }}
      >
        Deliver to site
      </div>
      <p
        data-testid="deliver-to-site-label"
        style={{
          margin: "0 0 10px",
          fontSize: 14,
          fontWeight: 700,
          color: navy,
          fontFamily: font,
        }}
      >
        {siteLabel}
      </p>
      {confirmed ? (
        <>
          <p
            data-testid="deliver-to-site-confirmed-status"
            style={{
              margin: "0 0 8px",
              fontSize: 13,
              fontWeight: 700,
              color: "#166534",
              fontFamily: font,
            }}
          >
            Delivered to site
          </p>
          {(confirmedAt || confirmedBy) && (
            <p
              data-testid="deliver-to-site-confirmed-meta"
              style={{
                margin: "0 0 10px",
                fontSize: 12,
                color: "#64748b",
                fontFamily: font,
              }}
            >
              {confirmedBy ? `${confirmedBy}` : "Dispatcher"}
              {confirmedAt
                ? ` · ${new Date(confirmedAt).toLocaleString()}`
                : ""}
            </p>
          )}
          <button
            type="button"
            data-testid="deliver-to-site-mark-not-delivered"
            disabled={loading}
            onClick={() => void onSetConfirmed(false)}
            style={{
              backgroundColor: "#fff",
              color: RED,
              border: `1.5px solid ${RED}`,
              borderRadius: 4,
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              fontFamily: font,
              opacity: loading ? 0.6 : 1,
            }}
          >
            Not yet delivered
          </button>
        </>
      ) : (
        <button
          type="button"
          data-testid="deliver-to-site-mark-delivered"
          disabled={loading}
          onClick={() => void onSetConfirmed(true)}
          style={{
            backgroundColor: navy,
            color: "#fff",
            border: "none",
            borderRadius: 4,
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 700,
            cursor: loading ? "not-allowed" : "pointer",
            fontFamily: font,
            opacity: loading ? 0.6 : 1,
          }}
        >
          Mark delivered to site
        </button>
      )}
    </div>
  );
}
