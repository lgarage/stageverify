import type { VendorInvoicePdfPayload } from "../firestoreService";

function payloadToBlobUrl(payload: VendorInvoicePdfPayload): string {
  const binary = atob(payload.dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], {
    type: payload.mimeType || "application/pdf",
  });
  return URL.createObjectURL(blob);
}

/** Open a blank tab synchronously on user click — required before async CF fetch (popup blockers). */
export function openBlankPdfViewerTab(): Window | null {
  const popup = window.open("about:blank", "_blank");
  if (!popup) return null;
  try {
    popup.document.title = "Loading invoice PDF…";
    popup.document.body.innerHTML =
      '<p style="font-family:Helvetica Neue,Helvetica,Arial,sans-serif;padding:24px;color:#0a3161">Loading invoice PDF…</p>';
  } catch {
    // Ignore if the blank document is not writable in this browser.
  }
  return popup;
}

/** Open invoice PDF in a new browser tab from a CF payload. Caller revokes object URL when done. */
export function openVendorInvoicePdfInNewTab(
  payload: VendorInvoicePdfPayload,
  preOpenedWindow?: Window | null,
): void {
  const url = payloadToBlobUrl(payload);
  if (preOpenedWindow && !preOpenedWindow.closed) {
    preOpenedWindow.location.assign(url);
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    URL.revokeObjectURL(url);
    throw new Error("Pop-up blocked — allow pop-ups to view the invoice PDF.");
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function callableErrorMessage(error: unknown): string | null {
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message: string }).message).trim();
    if (message && message !== "INTERNAL") return message;
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message && message !== "INTERNAL") return message;
  }
  return null;
}

export function vendorInvoicePdfUnavailableMessage(error: unknown): string {
  const message = callableErrorMessage(error);
  if (message) {
    if (/not connected|credentials|refresh token/i.test(message)) {
      return "Invoice PDF unavailable — Gmail is not connected for inbound sync.";
    }
    if (/not found|no pdf|attachment metadata/i.test(message)) {
      return "Invoice PDF is not available for this import.";
    }
    if (/pop-up blocked|viewer tab was closed/i.test(message)) {
      return message;
    }
    return message;
  }
  return "Invoice PDF could not be loaded — server error while fetching the Gmail attachment.";
}
