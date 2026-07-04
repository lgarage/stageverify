"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncInboundGmail = void 0;
exports.runInboundGmailSync = runInboundGmailSync;
/**
 * Scheduled Gmail inbound sync — polls inbox for PDF invoice emails.
 * Fallback when push/watch is not configured; idempotent by gmailMessageId.
 */
const admin = require("firebase-admin");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const gmailApi_1 = require("./gmailApi");
const gmailInbound_1 = require("./gmailInbound");
const processInboundGmailMessage_1 = require("./inboundEmail/processInboundGmailMessage");
const PROVIDER_ID = "gmail";
function getDb() {
    return admin.firestore();
}
function connectionRef(db) {
    return db.collection("emailProviderConnections").doc(PROVIDER_ID);
}
function secretsRef(db) {
    return db.collection("emailProviderSecrets").doc(PROVIDER_ID);
}
async function loadRefreshToken(db) {
    const conn = await connectionRef(db).get();
    if (!conn.exists)
        return null;
    const status = conn.data().status;
    if (status !== "connected")
        return null;
    const secretSnap = await secretsRef(db).get();
    if (!secretSnap.exists)
        return null;
    const refreshToken = secretSnap.data().refreshToken;
    return refreshToken?.trim() || null;
}
async function collectMessageIdsFromHistory(accessToken, startHistoryId) {
    const { history, historyId } = await (0, gmailInbound_1.listGmailHistory)(accessToken, startHistoryId);
    const ids = new Set();
    for (const record of history) {
        for (const added of record.messagesAdded ?? []) {
            if (added.message?.id)
                ids.add(added.message.id);
        }
        for (const msg of record.messages ?? []) {
            if (msg.id)
                ids.add(msg.id);
        }
    }
    return { messageIds: [...ids], latestHistoryId: historyId };
}
async function runInboundGmailSync() {
    const db = getDb();
    if (!(0, gmailInbound_1.gmailOAuthSecretsConfigured)()) {
        console.log("syncInboundGmail: OAuth secrets not configured — skipping");
        return { processed: 0, skipped: 0, errors: 0 };
    }
    const refreshToken = await loadRefreshToken(db);
    if (!refreshToken) {
        console.log("syncInboundGmail: Gmail not connected — skipping");
        return { processed: 0, skipped: 0, errors: 0 };
    }
    const accessToken = await (0, gmailInbound_1.getGmailAccessTokenForProvider)(refreshToken);
    const connSnap = await connectionRef(db).get();
    const connData = connSnap.data();
    const inboundSync = connData?.inboundSync ?? {};
    let messageIds = [];
    let latestHistoryId = inboundSync.lastHistoryId;
    if (inboundSync.lastHistoryId) {
        const historyResult = await collectMessageIdsFromHistory(accessToken, inboundSync.lastHistoryId);
        messageIds = historyResult.messageIds;
        if (historyResult.latestHistoryId) {
            latestHistoryId = historyResult.latestHistoryId;
        }
    }
    if (messageIds.length === 0) {
        const recent = await (0, gmailInbound_1.listRecentInboxMessageIds)(accessToken, { maxResults: 15 });
        messageIds = recent.map((m) => m.id);
    }
    if (!latestHistoryId) {
        const profile = await (0, gmailInbound_1.getGmailProfile)(accessToken);
        if (profile.historyId)
            latestHistoryId = profile.historyId;
    }
    let processed = 0;
    let skipped = 0;
    let errors = 0;
    for (const messageId of messageIds) {
        try {
            const result = await (0, processInboundGmailMessage_1.processInboundGmailMessage)(accessToken, messageId);
            if (result.skipped)
                skipped += 1;
            else
                processed += 1;
        }
        catch (err) {
            errors += 1;
            const message = err instanceof Error ? err.message : String(err);
            console.error(`syncInboundGmail: message ${messageId} failed — ${message}`);
        }
    }
    const now = new Date().toISOString();
    await connectionRef(db).set({
        inboundSync: {
            ...inboundSync,
            lastHistoryId: latestHistoryId ?? inboundSync.lastHistoryId,
            lastSyncAt: now,
        },
        updatedAt: now,
    }, { merge: true });
    console.log(`syncInboundGmail: processed=${processed} skipped=${skipped} errors=${errors}`);
    return { processed, skipped, errors };
}
exports.syncInboundGmail = (0, scheduler_1.onSchedule)({
    schedule: "every 5 minutes",
    region: "us-central1",
    secrets: [gmailApi_1.gmailClientId, gmailApi_1.gmailClientSecret],
    timeoutSeconds: 300,
}, async () => {
    await runInboundGmailSync();
});
//# sourceMappingURL=syncInboundGmail.js.map