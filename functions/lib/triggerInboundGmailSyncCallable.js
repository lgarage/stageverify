"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.triggerInboundGmailSyncCallable = void 0;
/**
 * Callable: manual inbound Gmail sync (same as scheduled syncInboundGmail).
 * Dispatcher auth required — used by dashboard Refresh Now.
 */
const https_1 = require("firebase-functions/v2/https");
const gmailApi_1 = require("./gmailApi");
const gmailInbound_1 = require("./gmailInbound");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
const syncInboundGmail_1 = require("./syncInboundGmail");
exports.triggerInboundGmailSyncCallable = (0, https_1.onCall)({
    region: "us-central1",
    secrets: [gmailApi_1.gmailClientId, gmailApi_1.gmailClientSecret],
    timeoutSeconds: 300,
}, async (request) => {
    await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    if (!(0, gmailInbound_1.gmailOAuthSecretsConfigured)()) {
        throw new https_1.HttpsError("failed-precondition", "Gmail OAuth is not configured on the server.");
    }
    const result = await (0, syncInboundGmail_1.runInboundGmailSync)({ retryOnError: true });
    return {
        ok: true,
        processed: result.processed,
        skipped: result.skipped,
        errors: result.errors,
        invoicesQueued: result.invoicesQueued,
        skippedByStatus: result.skippedByStatus,
        skippedReviewCounts: result.skippedReviewCounts,
        errorDetails: result.errorDetails,
    };
});
//# sourceMappingURL=triggerInboundGmailSyncCallable.js.map