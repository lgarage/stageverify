"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asParsedHeaderForImport = asParsedHeaderForImport;
const https_1 = require("firebase-functions/v2/https");
function asParsedHeaderForImport(raw) {
    const str = (key, required = false) => {
        const v = raw[key];
        if (typeof v === "string" && v.trim())
            return v.trim();
        if (required)
            throw new https_1.HttpsError("failed-precondition", `Invoice header missing ${key}.`);
        return "";
    };
    const vendorInvoiceNumber = str("vendorInvoiceNumber");
    const vendorOrderNumber = str("vendorOrderNumber");
    if (!vendorInvoiceNumber && !vendorOrderNumber) {
        throw new https_1.HttpsError("failed-precondition", "Invoice header missing identity — needs vendorInvoiceNumber or vendorOrderNumber.");
    }
    return {
        customerAccountNumber: str("customerAccountNumber"),
        vendorOrderNumber,
        vendorInvoiceNumber,
        customerPoOrReference: str("customerPoOrReference", true),
        quoteNumber: str("quoteNumber") || undefined,
        orderDate: str("orderDate", true),
        invoiceDate: str("invoiceDate"),
        shipDate: str("shipDate"),
        buyerName: str("buyerName") || undefined,
        shipViaRaw: str("shipViaRaw") || undefined,
        jobNumberRaw: str("jobNumberRaw") || undefined,
        vendorBranchName: str("vendorBranchName"),
        vendorBranchAddress: str("vendorBranchAddress"),
        vendorBranchPhone: str("vendorBranchPhone"),
        soldToName: str("soldToName"),
        shipToName: str("shipToName"),
        shipToAddress: str("shipToAddress"),
        fulfillmentMethod: raw.fulfillmentMethod === "delivery" ||
            raw.fulfillmentMethod === "will_call_pickup" ||
            raw.fulfillmentMethod === "unknown"
            ? raw.fulfillmentMethod
            : "unknown",
        shipCompletePolicy: raw.shipCompletePolicy === "hold_until_complete" ||
            raw.shipCompletePolicy === "allow_partial" ||
            raw.shipCompletePolicy === "unknown"
            ? raw.shipCompletePolicy
            : "unknown",
    };
}
//# sourceMappingURL=parsedHeaderValidation.js.map