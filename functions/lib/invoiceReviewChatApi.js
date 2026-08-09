"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reviewAgentTurn = void 0;
/**
 * Lane C C1/C2 — Invoice Review Chat callables.
 * May propose corrections (C2); never mutates parsed fields here — apply is a separate callable.
 * Never touches deliveries, ignore rules, or playbooks.
 */
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
const reviewAgentRateLimit_1 = require("./invoice/reviewChat/reviewAgentRateLimit");
const reviewAgentRateLimit_2 = require("./invoice/reviewChat/reviewAgentRateLimit");
const runReviewAgentTurn_1 = require("./invoice/reviewChat/runReviewAgentTurn");
function getDb() {
    return admin.firestore();
}
exports.reviewAgentTurn = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    const uid = await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    const data = (request.data ?? {});
    const vendorInvoiceImportId = typeof data.vendorInvoiceImportId === "string"
        ? data.vendorInvoiceImportId.trim()
        : "";
    const message = typeof data.message === "string" ? data.message.trim() : "";
    if (!vendorInvoiceImportId || !message) {
        throw new https_1.HttpsError("invalid-argument", "vendorInvoiceImportId and message are required.");
    }
    try {
        await (0, reviewAgentRateLimit_2.checkAndIncrementReviewChatRateLimit)(getDb(), uid);
    }
    catch (err) {
        if (err instanceof reviewAgentRateLimit_1.ReviewChatRateLimitError) {
            throw new https_1.HttpsError("resource-exhausted", err.message);
        }
        throw err;
    }
    try {
        return await (0, runReviewAgentTurn_1.runReviewAgentTurnCore)({
            db: getDb(),
            uid,
            vendorInvoiceImportId,
            message,
        });
    }
    catch (err) {
        if (err instanceof runReviewAgentTurn_1.ReviewAgentTurnInputError) {
            throw new https_1.HttpsError("invalid-argument", err.message);
        }
        console.error("reviewAgentTurn failed:", err);
        throw new https_1.HttpsError("internal", "Invoice Review Chat is temporarily unavailable.");
    }
});
//# sourceMappingURL=invoiceReviewChatApi.js.map