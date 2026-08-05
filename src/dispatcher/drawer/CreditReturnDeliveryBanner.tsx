import type { VendorInvoiceImportReview } from "../models";
import {
  canRejectLinkedImport,
  linkedImportRejectBlockedReason,
} from "../invoice/deliveryCreditReturn";

const RED = "#bf0a30";
const RED_BG = "#fef2f2";
const RED_BORDER = "#fecaca";

export function CreditReturnDeliveryBanner({
  importRow,
  importId,
  importLoading,
  font,
  mutationLoading,
  onRejectClick,
}: {
  importRow: VendorInvoiceImportReview | null;
  importId: string | undefined;
  importLoading: boolean;
  font: string;
  mutationLoading: boolean;
  onRejectClick: () => void;
}) {
  const rejectBlocked = linkedImportRejectBlockedReason(importRow, importId);
  const canReject =
    Boolean(importId?.trim()) &&
    !importLoading &&
    importRow &&
    canRejectLinkedImport(importRow);

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
            material. Do not assign staging or mark ready for pickup — reject the
            linked import to move it to Rejected Invoices and teach the parser.
          </p>
          {importLoading ? (
            <p style={{ margin: "8px 0 0", fontSize: 11, color: "#9ca3af" }}>
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
              style={{ margin: "8px 0 0", fontSize: 11, color: "#6b7280" }}
            >
              {rejectBlocked}
            </p>
          ) : null}
        </div>
      </div>
      {canReject ? (
        <button
          type="button"
          data-testid="delivery-credit-return-reject-btn"
          disabled={mutationLoading}
          onClick={onRejectClick}
          style={{
            marginTop: 10,
            width: "100%",
            boxSizing: "border-box",
            padding: "8px 12px",
            fontSize: 12,
            fontWeight: 700,
            fontFamily: font,
            color: "#fff",
            backgroundColor: RED,
            border: "none",
            borderRadius: 6,
            cursor: mutationLoading ? "wait" : "pointer",
            opacity: mutationLoading ? 0.7 : 1,
          }}
        >
          Reject linked import…
        </button>
      ) : null}
    </div>
  );
}
