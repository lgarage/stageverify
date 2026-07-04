"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerGmailWatchCallable = void 0;
/**
 * Callable: register Gmail push watch after OAuth connect (optional Pub/Sub topic).
 * Also refreshes inbound sync history baseline.
 */
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const gmailInbound_1 = require("./gmailInbound");
const gmailApi_1 = require("./gmailApi");
const gmailWatchShared_1 = require("./gmailWatchShared");
function getDb() {
    return admin.firestore();
}
exports.registerGmailWatchCallable = (0, https_1.onCall)({
    region: "us-central1",
    secrets: [gmailApi_1.gmailClientId, gmailApi_1.gmailClientSecret, gmailWatchShared_1.gmailPubsubTopic],
}, async (request) => {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError("unauthenticated", "Sign in to register Gmail watch.");
    }
    if (!(0, gmailInbound_1.gmailOAuthSecretsConfigured)()) {
        throw new https_1.HttpsError("failed-precondition", "Gmail OAuth is not configured.");
    }
    const topicName = (0, gmailWatchShared_1.getGmailPubsubTopicName)();
    if (!topicName) {
        throw new https_1.HttpsError("failed-precondition", "GMAIL_PUBSUB_TOPIC secret is not set. Fallback poll sync still runs via syncInboundGmail (every 30 minutes).");
    }
    const result = await (0, gmailWatchShared_1.registerGmailWatchForConnection)(getDb(), {
        topicName,
        runInitialSync: true,
    });
    if (!result.ok) {
        throw new https_1.HttpsError("failed-precondition", `Gmail watch registration failed: ${result.skippedReason ?? "unknown"}`);
    }
    return {
        ok: true,
        historyId: result.historyId,
        watchExpiration: result.watchExpiration,
        initialSync: result.initialSync,
    };
});
//# sourceMappingURL=registerGmailWatch.js.map