/**
 * Callable: re-parse one vendor invoice import from cached inbound PDF text.
 * Used by Parsed import data modal — Re-parse button.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { VendorInvoiceImportDoc } from "./inboundEmail/types";
import { requireDispatcherAuth } from "./inboundEmail/dispatcherAuth";
import { reparseVendorInvoiceImportFromCache } from "./inboundEmail/processInboundGmailMessage";
import { sanitizeVendorInvoiceImportForClient } from "./inboundEmail/sanitizeVendorInvoiceImport";

export const reparseVendorInvoiceImportCallable = onCall(
  { region: "us-central1", timeoutSeconds: 120 },
  async (request) => {
    await requireDispatcherAuth(request);
    const data = (request.data ?? {}) as { vendorInvoiceImportId?: string };
    const importId =
      typeof data.vendorInvoiceImportId === "string"
        ? data.vendorInvoiceImportId.trim()
        : "";
    if (!importId || importId.length > 256) {
      throw new HttpsError("invalid-argument", "vendorInvoiceImportId is required.");
    }

    try {
      const { importDoc, reparse } = await reparseVendorInvoiceImportFromCache(importId);
      return {
        ok: true,
        import: sanitizeVendorInvoiceImportForClient(importDoc as VendorInvoiceImportDoc),
        reparse,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/not found/i.test(message)) {
        throw new HttpsError("not-found", message);
      }
      if (/approved or rejected|No cached|legacy font encoding/i.test(message)) {
        throw new HttpsError("failed-precondition", message);
      }
      throw new HttpsError("internal", message.slice(0, 500));
    }
  },
);
