"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gmailInboxPushIngest = void 0;
/**
 * Gmail inbox push ingest — Pub/Sub notification from users.watch triggers history sync.
 *
 * GCP setup (Dan): see docs/project_state.md § Gmail push ingest.
 * Firebase Eventarc subscribes to GMAIL_PUBSUB_TOPIC_ID; no manual push subscription needed.
 */
const admin = require("firebase-admin");
const pubsub_1 = require("firebase-functions/v2/pubsub");
const gmailApi_1 = require("./gmailApi");
const gmailInbound_1 = require("./gmailInbound");
const syncInboundGmail_1 = require("./syncInboundGmail");
const gmailWatchShared_1 = require("./gmailWatchShared");
const PROVIDER_ID = "gmail";
function getDb() {
    return admin.firestore();
}
exports.gmailInboxPushIngest = (0, pubsub_1.onMessagePublished)({
    topic: gmailWatchShared_1.GMAIL_PUBSUB_TOPIC_ID,
    region: "us-central1",
    secrets: [gmailApi_1.gmailClientId, gmailApi_1.gmailClientSecret],
}, async (event) => {
    const rawData = event.data.message.data;
    if (!rawData) {
        console.log("gmailInboxPushIngest: empty message data — skipping");
        return;
    }
    const notification = (0, gmailInbound_1.parseGmailPushNotification)(rawData);
    if (!notification) {
        console.log("gmailInboxPushIngest: unparseable push payload — skipping");
        return;
    }
    const conn = await getDb().collection("emailProviderConnections").doc(PROVIDER_ID).get();
    const connectedEmail = (conn.data()?.connectedAccountEmail ?? "")
        .trim()
        .toLowerCase();
    if (connectedEmail && notification.emailAddress !== connectedEmail) {
        console.log(`gmailInboxPushIngest: push email ${notification.emailAddress} != connected ${connectedEmail} — skipping`);
        return;
    }
    console.log(`gmailInboxPushIngest: push for ${notification.emailAddress} historyId=${notification.historyId}`);
    const result = await (0, syncInboundGmail_1.runInboundGmailSync)();
    console.log(`gmailInboxPushIngest: sync processed=${result.processed} skipped=${result.skipped} errors=${result.errors}`);
});
//# sourceMappingURL=gmailPubSubIngest.js.map