"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reparseVendorInvoiceImportCallable = void 0;
/**
 * Callable: re-parse one vendor invoice import from cached inbound PDF text.
 * Used by Parsed import data modal — Re-parse button.
 */
const https_1 = require("firebase-functions/v2/https");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
const processInboundGmailMessage_1 = require("./inboundEmail/processInboundGmailMessage");
const sanitizeVendorInvoiceImport_1 = require("./inboundEmail/sanitizeVendorInvoiceImport");
exports.reparseVendorInvoiceImportCallable = (0, https_1.onCall)({ region: "us-central1", timeoutSeconds: 120 }, async (request) => {
    await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    const data = (request.data ?? {});
    const importId = typeof data.vendorInvoiceImportId === "string"
        ? data.vendorInvoiceImportId.trim()
        : "";
    if (!importId || importId.length > 256) {
        throw new https_1.HttpsError("invalid-argument", "vendorInvoiceImportId is required.");
    }
    try {
        const { importDoc, reparse } = await (0, processInboundGmailMessage_1.reparseVendorInvoiceImportFromCache)(importId);
        return {
            ok: true,
            import: (0, sanitizeVendorInvoiceImport_1.sanitizeVendorInvoiceImportForClient)(importDoc),
            reparse,
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/not found/i.test(message)) {
            throw new https_1.HttpsError("not-found", message);
        }
        if (/approved or rejected|No cached|legacy font encoding/i.test(message)) {
            throw new https_1.HttpsError("failed-precondition", message);
        }
        throw new https_1.HttpsError("internal", message.slice(0, 500));
    }
});
//# sourceMappingURL=reparseVendorInvoiceImportCallable.js.map