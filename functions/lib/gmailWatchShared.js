"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gmailPubsubTopic = exports.GMAIL_PUBSUB_TOPIC_ID = void 0;
exports.getGmailPubsubTopicName = getGmailPubsubTopicName;
exports.registerGmailWatchForConnection = registerGmailWatchForConnection;
exports.renewGmailWatchIfNeeded = renewGmailWatchIfNeeded;
const params_1 = require("firebase-functions/params");
const gmailInbound_1 = require("./gmailInbound");
const syncInboundGmail_1 = require("./syncInboundGmail");
/** Pub/Sub topic ID — must match GMAIL_PUBSUB_TOPIC secret full path suffix. */
exports.GMAIL_PUBSUB_TOPIC_ID = "gmail-inbox-notifications";
exports.gmailPubsubTopic = (0, params_1.defineSecret)("GMAIL_PUBSUB_TOPIC");
const PROVIDER_ID = "gmail";
function connectionRef(db) {
    return db.collection("emailProviderConnections").doc(PROVIDER_ID);
}
function secretsRef(db) {
    return db.collection("emailProviderSecrets").doc(PROVIDER_ID);
}
/** Full topic path from secret, or null when unset. */
function getGmailPubsubTopicName() {
    try {
        const topicName = (exports.gmailPubsubTopic.value() ?? "").trim();
        return topicName || null;
    }
    catch {
        return null;
    }
}
async function registerGmailWatchForConnection(db, options) {
    const conn = await connectionRef(db).get();
    if (!conn.exists || conn.data().status !== "connected") {
        return { ok: false, skippedReason: "not_connected" };
    }
    const secretSnap = await secretsRef(db).get();
    const refreshToken = secretSnap.data().refreshToken;
    if (!refreshToken) {
        return { ok: false, skippedReason: "missing_refresh_token" };
    }
    const accessToken = options.accessToken ?? (await (0, gmailInbound_1.getGmailAccessTokenForProvider)(refreshToken));
    const watch = await (0, gmailInbound_1.registerGmailWatch)(accessToken, options.topicName);
    const profile = await (0, gmailInbound_1.getGmailProfile)(accessToken);
    const now = new Date().toISOString();
    const watchExpiration = new Date(Number(watch.expiration)).toISOString();
    await connectionRef(db).set({
        inboundSync: {
            lastHistoryId: watch.historyId ?? profile.historyId,
            lastSyncAt: now,
            watchExpiration,
        },
        updatedAt: now,
    }, { merge: true });
    const initialSync = options.runInitialSync ? await (0, syncInboundGmail_1.runInboundGmailSync)() : undefined;
    return {
        ok: true,
        historyId: watch.historyId,
        watchExpiration,
        initialSync,
    };
}
/** Renew watch when missing or expiring within the buffer window. */
async function renewGmailWatchIfNeeded(db, options) {
    const topicName = getGmailPubsubTopicName();
    if (!topicName) {
        return { ok: false, skippedReason: "topic_not_configured" };
    }
    const conn = await connectionRef(db).get();
    if (!conn.exists || conn.data().status !== "connected") {
        return { ok: false, skippedReason: "not_connected" };
    }
    const inboundSync = conn.data()
        .inboundSync;
    const bufferMs = options?.expirationBufferMs ?? 48 * 60 * 60 * 1000;
    const expiresAt = inboundSync?.watchExpiration
        ? Date.parse(inboundSync.watchExpiration)
        : NaN;
    if (Number.isFinite(expiresAt) && expiresAt - Date.now() > bufferMs) {
        return { ok: false, skippedReason: "watch_still_valid" };
    }
    return registerGmailWatchForConnection(db, { topicName, runInitialSync: false });
}
//# sourceMappingURL=gmailWatchShared.js.map