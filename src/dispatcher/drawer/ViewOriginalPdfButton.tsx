import { useVendorInvoicePdfViewer } from "../invoice/useVendorInvoicePdfViewer";

const VIEW_PDF_BTN = {
  backgroundColor: "var(--admin-surface)",
  color: "var(--admin-accent-soft)",
  border: "1px solid var(--admin-accent)",
  borderRadius: 6,
  padding: "6px 12px",
  fontWeight: 600,
  fontSize: 12,
  fontFamily: "inherit",
  cursor: "pointer",
} as const;

export function ViewOriginalPdfButton({
  vendorInvoiceImportId,
  font,
}: {
  vendorInvoiceImportId?: string;
  font: string;
}) {
  const importId = vendorInvoiceImportId?.trim() ?? "";
  const {
    viewPdf,
    isLoading: pdfLoading,
    unavailableMessage: pdfUnavailableMessage,
  } = useVendorInvoicePdfViewer();
  const unavailableMessage = importId
    ? pdfUnavailableMessage(importId)
    : null;
  const isLoading = importId ? pdfLoading(importId) : false;
  const disabled = !importId || isLoading || Boolean(unavailableMessage);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 5,
      }}
    >
      <button
        type="button"
        data-testid="delivery-drawer-view-original-pdf"
        disabled={disabled}
        title={
          !importId
            ? "No linked invoice import — PDF unavailable"
            : (unavailableMessage ??
              "Open the vendor invoice PDF in a new browser tab")
        }
        onClick={() => {
          if (importId) void viewPdf(importId);
        }}
        style={{
          ...VIEW_PDF_BTN,
          fontFamily: font,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: !importId ? 0.45 : disabled ? 0.55 : 1,
          flexShrink: 0,
          whiteSpace: "nowrap",
        }}
      >
        {isLoading ? "Loading PDF…" : "View original PDF"}
      </button>
      {unavailableMessage ? (
        <p
          data-testid="delivery-drawer-pdf-unavailable"
          style={{
            margin: 0,
            maxWidth: 200,
            fontSize: 11,
            color: "var(--admin-warning-text)",
            lineHeight: 1.35,
            textAlign: "right",
          }}
        >
          {unavailableMessage}
        </p>
      ) : null}
    </div>
  );
}
