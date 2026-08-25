import { useEffect } from "react";
import type { DeliveryDetails, InboundEmailProcessing, VendorEmailEvent } from "../models";
import type { ProposedEmailUpdate } from "../email/getProposedEmailUpdates";
import {
  EmailEvidenceCard,
  VendorEmailEventCard,
} from "../email/emailEvidenceCards";
import { sourceEmailReviewFromInbound } from "../email/sourceEmailReview";
import { useVendorInvoicePdfViewer } from "../invoice/useVendorInvoicePdfViewer";

const EMPTY_BODY_COPY = "No message body was included with this email.";

function InvoiceSourceEmailReview({
  inbound,
  vendorInvoiceImportId,
  font,
}: {
  inbound: InboundEmailProcessing;
  vendorInvoiceImportId?: string;
  font: string;
}) {
  const review = sourceEmailReviewFromInbound(inbound);
  const importId = vendorInvoiceImportId?.trim() ?? "";
  const { viewPdf, isLoading, unavailableMessage } = useVendorInvoicePdfViewer();
  const pdfUnavailable = importId ? unavailableMessage(importId) : null;
  const pdfLoading = importId ? isLoading(importId) : false;
  const pdfDisabled = !importId || pdfLoading || Boolean(pdfUnavailable);

  const fieldRow = (label: string, value: string, testId: string) => (
    <div style={{ marginBottom: 6 }}>
      <span style={{ color: "var(--admin-text-muted)", fontWeight: 600 }}>{label}: </span>
      <span data-testid={testId} style={{ color: "var(--admin-text-secondary)" }}>
        {value}
      </span>
    </div>
  );

  return (
    <div
      style={{
        backgroundColor: "var(--admin-surface)",
        border: "1px solid var(--admin-border)",
        borderRadius: 6,
        padding: "14px 16px",
      }}
    >
      {fieldRow("From", review.from, "review-vendor-email-from")}
      {review.to ? fieldRow("To", review.to, "review-vendor-email-to") : null}
      {review.cc ? fieldRow("CC", review.cc, "review-vendor-email-cc") : null}
      {fieldRow("Date", review.dateLabel, "review-vendor-email-date")}
      {fieldRow("Subject", review.subject, "review-vendor-email-subject")}

      <div style={{ marginTop: 14, marginBottom: 8 }}>
        <p
          style={{
            margin: "0 0 8px",
            fontSize: 12,
            fontWeight: 700,
            color: "var(--admin-text-muted)",
            letterSpacing: "0.02em",
          }}
        >
          Message
        </p>
        {review.bodyText ? (
          <p
            data-testid="review-vendor-email-message"
            style={{
              margin: 0,
              fontSize: 13,
              color: "var(--admin-text-data)",
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
            }}
          >
            {review.bodyText}
          </p>
        ) : (
          <p
            data-testid="review-vendor-email-empty-body"
            style={{
              margin: 0,
              fontSize: 13,
              color: "var(--admin-text-muted)",
              fontStyle: "italic",
              lineHeight: 1.5,
            }}
          >
            {EMPTY_BODY_COPY}
          </p>
        )}
      </div>

      {review.attachments.length > 0 || importId ? (
        <div style={{ marginTop: 14 }}>
          <p
            style={{
              margin: "0 0 8px",
              fontSize: 12,
              fontWeight: 700,
              color: "var(--admin-text-muted)",
              letterSpacing: "0.02em",
            }}
          >
            Attachments
          </p>
          {review.attachments.length > 0 ? (
            <ul
              data-testid="review-vendor-email-attachments"
              style={{
                margin: "0 0 10px",
                paddingLeft: 20,
                fontSize: 13,
                color: "var(--admin-text-secondary)",
              }}
            >
              {review.attachments.map((att) => (
                <li key={att.filename}>{att.filename}</li>
              ))}
            </ul>
          ) : null}
          {importId ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <button
                type="button"
                data-testid="review-vendor-email-view-original-pdf"
                disabled={pdfDisabled}
                title={
                  pdfUnavailable ??
                  "Open the vendor invoice PDF in a new browser tab"
                }
                onClick={() => {
                  void viewPdf(importId);
                }}
                style={{
                  alignSelf: "flex-start",
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--admin-accent)",
                  backgroundColor: "var(--admin-surface)",
                  color: "var(--admin-accent-soft)",
                  fontSize: 12,
                  fontWeight: 600,
                  fontFamily: font,
                  cursor: pdfDisabled ? "not-allowed" : "pointer",
                  opacity: pdfDisabled ? 0.55 : 1,
                }}
              >
                {pdfLoading ? "Loading PDF…" : "View Original PDF"}
              </button>
              {pdfUnavailable ? (
                <p
                  style={{
                    margin: 0,
                    fontSize: 11,
                    color: "var(--admin-warning-text)",
                    lineHeight: 1.35,
                  }}
                >
                  {pdfUnavailable}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ReviewVendorEmailModal({
  open,
  details,
  navy,
  font,
  loading,
  invoiceSourceEmail,
  showInvoiceSourceEmail,
  vendorEmailEvents,
  proposals,
  onClose,
}: {
  open: boolean;
  details: DeliveryDetails;
  navy: string;
  font: string;
  loading: boolean;
  invoiceSourceEmail: InboundEmailProcessing | null;
  showInvoiceSourceEmail: boolean;
  vendorEmailEvents: VendorEmailEvent[];
  proposals: ProposedEmailUpdate[];
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  const { delivery, job, vendor } = details;
  const emailCount =
    proposals.length + vendorEmailEvents.length + (showInvoiceSourceEmail ? 1 : 0);
  const contextParts = [
    delivery.orderNumber ? `Order ${delivery.orderNumber}` : null,
    job?.jobName ?? null,
    vendor?.name ?? null,
  ].filter(Boolean);

  return (
    <div
      data-testid="review-vendor-email-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-vendor-email-modal-title"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 70,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        data-testid="review-vendor-email-modal-panel"
        className="admin-card"
        style={{
          width: "min(880px, 92vw)",
          maxHeight: "86vh",
          backgroundColor: "var(--admin-surface)",
          borderRadius: "var(--admin-radius-lg)",
          boxShadow: "var(--admin-shadow-card)",
          display: "flex",
          flexDirection: "column",
          boxSizing: "border-box",
          overflow: "hidden",
          fontFamily: font,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            padding: "20px 24px 16px",
            borderBottom: "1px solid var(--admin-border)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h2
              id="review-vendor-email-modal-title"
              data-testid="review-vendor-email-modal-title"
              style={{
                margin: "0 0 4px",
                fontSize: 20,
                fontWeight: 750,
                color: "var(--admin-text-data)",
              }}
            >
              Review Vendor Email
            </h2>
            <p
              data-testid="review-vendor-email-modal-context"
              style={{
                margin: 0,
                fontSize: 13,
                color: "var(--admin-text-secondary)",
              }}
            >
              {contextParts.join(" · ") || "Matched vendor email for this delivery"}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <button
              type="button"
              data-testid="review-vendor-email-modal-close-x"
              aria-label="Close"
              onClick={onClose}
              style={{
                width: 32,
                height: 32,
                borderRadius: 6,
                border: "1px solid var(--admin-border)",
                backgroundColor: "var(--admin-surface)",
                color: "var(--admin-text-data)",
                fontSize: 18,
                lineHeight: 1,
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>
        </header>

        <div
          data-testid="review-vendor-email-modal-body"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "18px 24px 8px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {loading ? (
            <p
              data-testid="review-vendor-email-modal-loading"
              style={{ margin: 0, fontSize: 13, color: "var(--admin-text-muted)" }}
            >
              Loading vendor emails…
            </p>
          ) : emailCount === 0 ? (
            <p
              data-testid="review-vendor-email-modal-empty"
              style={{ margin: 0, fontSize: 13, color: "var(--admin-text-muted)" }}
            >
              No matched email evidence for this delivery.
            </p>
          ) : (
            <>
              {showInvoiceSourceEmail && invoiceSourceEmail ? (
                <InvoiceSourceEmailReview
                  inbound={invoiceSourceEmail}
                  vendorInvoiceImportId={delivery.vendorInvoiceImportId}
                  font={font}
                />
              ) : null}
              {vendorEmailEvents.map((event) => (
                <VendorEmailEventCard key={event.id} event={event} defaultShowOriginal />
              ))}
              {proposals.map((row) => (
                <EmailEvidenceCard key={row.messageId} row={row} defaultShowOriginal />
              ))}
            </>
          )}
        </div>

        <footer
          style={{
            flexShrink: 0,
            display: "flex",
            justifyContent: "flex-end",
            padding: "14px 24px 18px",
            borderTop: "1px solid var(--admin-border)",
          }}
        >
          <button
            type="button"
            data-testid="review-vendor-email-modal-close"
            onClick={onClose}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "none",
              backgroundColor: navy,
              color: "var(--admin-on-navy)",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: font,
            }}
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
