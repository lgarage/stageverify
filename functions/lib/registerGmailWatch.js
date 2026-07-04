"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerGmailWatchCallable = void 0;
/**
 * Callable: register Gmail push watch after OAuth connect (optional Pub/Sub topic).
 * Also refreshes inbound sync history baseline.
 */
const admin = require("firebase-admin");
const params_1 = require("firebase-functions/params");
const https_1 = require("firebase-functions/v2/https");
const gmailInbound_1 = require("./gmailInbound");
const gmailApi_1 = require("./gmailApi");
const syncInboundGmail_1 = require("./syncInboundGmail");
const PROVIDER_ID = "gmail";
const gmailPubsubTopic = (0, params_1.defineSecret)("GMAIL_PUBSUB_TOPIC");
function getDb() {
    return admin.firestore();
}
function connectionRef(db) {
    return db.collection("emailProviderConnections").doc(PROVIDER_ID);
}
function secretsRef(db) {
    return db.collection("emailProviderSecrets").doc(PROVIDER_ID);
}
exports.registerGmailWatchCallable = (0, https_1.onCall)({
    region: "us-central1",
    secrets: [gmailApi_1.gmailClientId, gmailApi_1.gmailClientSecret, gmailPubsubTopic],
}, async (request) => {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError("unauthenticated", "Sign in to register Gmail watch.");
    }
    if (!(0, gmailInbound_1.gmailOAuthSecretsConfigured)()) {
        throw new https_1.HttpsError("failed-precondition", "Gmail OAuth is not configured.");
    }
    const topicName = (gmailPubsubTopic.value() ?? "").trim();
    if (!topicName) {
        throw new https_1.HttpsError("failed-precondition", "GMAIL_PUBSUB_TOPIC secret is not set. Scheduled poll sync still runs via syncInboundGmail.");
    }
    const db = getDb();
    const conn = await connectionRef(db).get();
    if (!conn.exists || conn.data().status !== "connected") {
        throw new https_1.HttpsError("failed-precondition", "Gmail is not connected.");
    }
    const secretSnap = await secretsRef(db).get();
    const refreshToken = secretSnap.data().refreshToken;
    if (!refreshToken) {
        throw new https_1.HttpsError("failed-precondition", "Gmail refresh token missing.");
    }
    const accessToken = await (0, gmailInbound_1.getGmailAccessTokenForProvider)(refreshToken);
    const watch = await (0, gmailInbound_1.registerGmailWatch)(accessToken, topicName);
    const profile = await (0, gmailInbound_1.getGmailProfile)(accessToken);
    const now = new Date().toISOString();
    await connectionRef(db).set({
        inboundSync: {
            lastHistoryId: watch.historyId ?? profile.historyId,
            lastSyncAt: now,
            watchExpiration: new Date(Number(watch.expiration)).toISOString(),
        },
        updatedAt: now,
    }, { merge: true });
    const syncResult = await (0, syncInboundGmail_1.runInboundGmailSync)();
    return {
        ok: true,
        historyId: watch.historyId,
        watchExpiration: new Date(Number(watch.expiration)).toISOString(),
        initialSync: syncResult,
    };
});
//# sourceMappingURL=registerGmailWatch.js.map