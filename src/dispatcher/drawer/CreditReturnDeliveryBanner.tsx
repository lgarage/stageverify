import type { VendorInvoiceImportReview } from "../models";
import {
  linkedImportRejectBlockedReason,
} from "../invoice/deliveryCreditReturn";

const RED = "#bf0a30";
const RED_BG = "var(--admin-danger-bg)";
const RED_BORDER = "var(--admin-danger-border)";

export function CreditReturnDeliveryBanner({
  importRow,
  importId,
  importLoading,
  font,
}: {
  importRow: VendorInvoiceImportReview | null;
  importId: string | undefined;
  importLoading: boolean;
  font: string;
}) {
  const rejectBlocked = linkedImportRejectBlockedReason(importRow, importId);

  return (
    <div
      data-testid="delivery-credit-return-banner"
      style={{
        backgroundColor: RED_BG,
        border: `1.5px solid ${RED_BORDER}`,
        borderRadius: 8,
        padding: "12px 14px",
        marginBottom: 4,
        fontFamily: font,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
        }}
      >
        <span
          aria-hidden
          style={{
            fontSize: 18,
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          ⚠
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            data-testid="delivery-credit-return-banner-title"
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 700,
              color: RED,
              lineHeight: 1.35,
            }}
          >
            Credit/Return — do not stage or pickup
          </p>
          <p
            data-testid="delivery-credit-return-banner-body"
            style={{
              margin: "6px 0 0",
              fontSize: 12,
              color: "#7f1d1d",
              lineHeight: 1.45,
            }}
          >
            This delivery is linked to a vendor credit or return memo, not shippable
            material. Do not assign staging or mark ready for pickup — use Status →
            Reject to move the linked import to Rejected Invoices and teach the parser.
          </p>
          {importLoading ? (
            <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--admin-text-muted)" }}>
              Loading linked import…
            </p>
          ) : null}
          {!importId?.trim() ? (
            <p
              data-testid="delivery-credit-return-no-import"
              style={{ margin: "8px 0 0", fontSize: 11, color: "#7f1d1d" }}
            >
              No linked invoice import on this delivery.
            </p>
          ) : null}
          {rejectBlocked && importRow ? (
            <p
              data-testid="delivery-credit-return-reject-blocked"
              style={{ margin: "8px 0 0", fontSize: 11, color: "var(--admin-text-muted)" }}
            >
              {rejectBlocked}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
