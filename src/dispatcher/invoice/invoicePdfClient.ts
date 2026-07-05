import type { VendorInvoicePdfPayload } from "../firestoreService";

/** Open invoice PDF in a new browser tab from a CF payload. Caller revokes object URL when done. */
export function openVendorInvoicePdfInNewTab(payload: VendorInvoicePdfPayload): void {
  const binary = atob(payload.dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], {
    type: payload.mimeType || "application/pdf",
  });
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    URL.revokeObjectURL(url);
    throw new Error("Pop-up blocked — allow pop-ups to view the invoice PDF.");
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function vendorInvoicePdfUnavailableMessage(error: unknown): string {
  if (error instanceof Error) {
    if (/not connected|credentials|refresh token/i.test(error.message)) {
      return "Invoice PDF unavailable — Gmail is not connected for inbound sync.";
    }
    if (/not found|no pdf|attachment metadata/i.test(error.message)) {
      return "Invoice PDF is not available for this import.";
    }
    if (/pop-up blocked/i.test(error.message)) {
      return error.message;
    }
    return error.message;
  }
  return "Invoice PDF could not be loaded.";
}
