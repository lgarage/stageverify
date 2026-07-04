"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renewGmailWatch = void 0;
/**
 * Scheduled Gmail watch renewal — watch expires ~7 days; renew before expiry.
 */
const admin = require("firebase-admin");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const gmailApi_1 = require("./gmailApi");
const gmailInbound_1 = require("./gmailInbound");
const gmailWatchShared_1 = require("./gmailWatchShared");
function getDb() {
    return admin.firestore();
}
exports.renewGmailWatch = (0, scheduler_1.onSchedule)({
    schedule: "every 24 hours",
    region: "us-central1",
    secrets: [gmailApi_1.gmailClientId, gmailApi_1.gmailClientSecret, gmailWatchShared_1.gmailPubsubTopic],
}, async () => {
    if (!(0, gmailInbound_1.gmailOAuthSecretsConfigured)()) {
        console.log("renewGmailWatch: OAuth secrets not configured — skipping");
        return;
    }
    if (!(0, gmailWatchShared_1.getGmailPubsubTopicName)()) {
        console.log("renewGmailWatch: GMAIL_PUBSUB_TOPIC not set — skipping");
        return;
    }
    const result = await (0, gmailWatchShared_1.renewGmailWatchIfNeeded)(getDb());
    if (result.ok) {
        console.log(`renewGmailWatch: renewed watch exp=${result.watchExpiration ?? "unknown"}`);
        return;
    }
    console.log(`renewGmailWatch: skipped (${result.skippedReason ?? "unknown"})`);
});
//# sourceMappingURL=renewGmailWatch.js.map