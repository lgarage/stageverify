"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncInboundGmail = void 0;
exports.runInboundGmailSync = runInboundGmailSync;
/**
 * Scheduled Gmail inbound sync — fallback poll for PDF invoice emails.
 *
 * Primary path: Gmail users.watch → Pub/Sub → gmailInboxPushIngest → runInboundGmailSync.
 * This schedule runs every 30 minutes when push/watch is unavailable or as a safety net.
 * Idempotent by gmailMessageId.
 */
const admin = require("firebase-admin");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const gmailApi_1 = require("./gmailApi");
const gmailInbound_1 = require("./gmailInbound");
const gmailInboundCatchUp_1 = require("./inboundEmail/gmailInboundCatchUp");
const processInboundGmailMessage_1 = require("./inboundEmail/processInboundGmailMessage");
const loadOutboundEmailContext_1 = require("./email/loadOutboundEmailContext");
const REVIEW_COLLECTION = "vendorInvoiceImports";
const INBOUND_COLLECTION = "inboundEmailProcessing";
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
async function collectRetryOnErrorMessageIds(db) {
    const ids = new Set();
    const reparseStaleReviewIds = new Set();
    const [errorSnap, parsedSnap, issueReviewSnap] = await Promise.all([
        db
            .collection(INBOUND_COLLECTION)
            .where("processingStatus", "==", "error")
            .limit(50)
            .get(),
        db
            .collection(INBOUND_COLLECTION)
            .where("processingStatus", "==", "parsed")
            .limit(100)
            .get(),
        db
            .collection(REVIEW_COLLECTION)
            .where("reviewStatus", "==", "pending_review")
            .where("importStatus", "==", "issue")
            .limit(50)
            .get(),
    ]);
    for (const doc of errorSnap.docs) {
        const gmailMessageId = doc.data().gmailMessageId;
        if (gmailMessageId)
            ids.add(gmailMessageId);
    }
    for (const doc of parsedSnap.docs) {
        const data = doc.data();
        if ((0, processInboundGmailMessage_1.shouldReprocessExistingDoc)(data, { retryOnError: true })) {
            ids.add(data.gmailMessageId);
        }
    }
    for (const doc of issueReviewSnap.docs) {
        const gmailMessageId = doc.data().gmailMessageId;
        if (gmailMessageId) {
            ids.add(gmailMessageId);
            reparseStaleReviewIds.add(gmailMessageId);
        }
    }
    return { messageIds: [...ids], reparseStaleReviewIds };
}
async function collectStaleIssueImportMessageIds(db) {
    const reparseStaleReviewIds = new Set();
    const [issueReviewSnap, partialReviewSnap] = await Promise.all([
        db
            .collection(REVIEW_COLLECTION)
            .where("reviewStatus", "==", "pending_review")
            .where("importStatus", "==", "issue")
            .limit(50)
            .get(),
        db
            .collection(REVIEW_COLLECTION)
            .where("reviewStatus", "==", "pending_review")
            .where("importStatus", "==", "partial")
            .limit(50)
            .get(),
    ]);
    for (const doc of issueReviewSnap.docs) {
        const gmailMessageId = doc.data().gmailMessageId;
        if (gmailMessageId)
            reparseStaleReviewIds.add(gmailMessageId);
    }
    for (const doc of partialReviewSnap.docs) {
        const row = doc.data();
        const lineCount = row.parsedLineCount ?? row.parsedLines?.length ?? 0;
        if (lineCount === 0 && row.gmailMessageId) {
            reparseStaleReviewIds.add(row.gmailMessageId);
        }
    }
    return reparseStaleReviewIds;
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
    const { history, historyId, listingComplete } = await (0, gmailInbound_1.listGmailHistory)(accessToken, startHistoryId);
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
    return {
        messageIds: [...ids],
        latestHistoryId: historyId,
        listingComplete: listingComplete ?? true,
    };
}
function inboundProcessingDocId(gmailMessageId) {
    return `inbound-${gmailMessageId}`;
}
async function filterUnprocessedCatchUpMessageIds(db, gmailMessageIds) {
    const unprocessed = [];
    const chunkSize = 100;
    for (let i = 0; i < gmailMessageIds.length; i += chunkSize) {
        const chunk = gmailMessageIds.slice(i, i + chunkSize);
        const refs = chunk.map((id) => db.collection(INBOUND_COLLECTION).doc(inboundProcessingDocId(id)));
        const snaps = await db.getAll(...refs);
        for (let j = 0; j < chunk.length; j += 1) {
            if (!snaps[j]?.exists) {
                unprocessed.push(chunk[j]);
            }
        }
    }
    return unprocessed;
}
async function runInboundGmailSync(options) {
    const db = getDb();
    if (!(0, gmailInbound_1.gmailOAuthSecretsConfigured)()) {
        console.log("syncInboundGmail: OAuth secrets not configured — skipping");
        return {
            processed: 0,
            skipped: 0,
            errors: 0,
            invoicesQueued: 0,
            skippedByStatus: {},
            skippedReviewCounts: {},
            errorDetails: [],
        };
    }
    const refreshToken = await loadRefreshToken(db);
    if (!refreshToken) {
        console.log("syncInboundGmail: Gmail not connected — skipping");
        return {
            processed: 0,
            skipped: 0,
            errors: 0,
            invoicesQueued: 0,
            skippedByStatus: {},
            skippedReviewCounts: {},
            errorDetails: [],
        };
    }
    const accessToken = await (0, gmailInbound_1.getGmailAccessTokenForProvider)(refreshToken);
    const connSnap = await connectionRef(db).get();
    const connData = connSnap.data();
    const inboundSync = connData?.inboundSync ?? {};
    let latestHistoryId = inboundSync.lastHistoryId;
    const nowMs = Date.now();
    const replySettings = await (0, loadOutboundEmailContext_1.loadReplyIngestSettings)();
    let historyMessageIds = [];
    let historyListingComplete = true;
    if (inboundSync.lastHistoryId) {
        const historyResult = await collectMessageIdsFromHistory(accessToken, inboundSync.lastHistoryId);
        historyMessageIds = historyResult.messageIds;
        historyListingComplete = historyResult.listingComplete;
        if (historyResult.latestHistoryId) {
            latestHistoryId = historyResult.latestHistoryId;
        }
    }
    const catchUpQuery = (0, gmailInboundCatchUp_1.buildInboxCatchUpQuery)({
        lastSyncAt: inboundSync.lastSyncAt,
        replyEnabled: replySettings.enabled,
        nowMs,
    });
    const afterListResult = await (0, gmailInbound_1.listInboxMessageIdsPaginated)(accessToken, {
        query: catchUpQuery,
        listCap: gmailInboundCatchUp_1.LIST_CAP,
    });
    const afterMessageIdsOldestFirst = (0, gmailInboundCatchUp_1.oldestFirstInboxIds)(afterListResult.messages.map((m) => m.id));
    const afterListingComplete = afterListResult.listingComplete;
    const catchUpIds = (0, gmailInboundCatchUp_1.uniquePreserveOrder)([
        ...historyMessageIds,
        ...afterMessageIdsOldestFirst,
    ]);
    const unprocessedCatchUpIds = await filterUnprocessedCatchUpMessageIds(db, catchUpIds);
    const { processNow, remainderCount } = (0, gmailInboundCatchUp_1.applyCatchUpCap)({
        listedIds: unprocessedCatchUpIds,
        cap: gmailInboundCatchUp_1.PROCESS_CAP,
    });
    const listingComplete = historyListingComplete && afterListingComplete;
    if (!latestHistoryId) {
        const profile = await (0, gmailInbound_1.getGmailProfile)(accessToken);
        if (profile.historyId)
            latestHistoryId = profile.historyId;
    }
    let messageIds = [...processNow];
    let reparseStaleReviewIds = await collectStaleIssueImportMessageIds(db);
    messageIds = [...new Set([...messageIds, ...reparseStaleReviewIds])];
    if (options?.retryOnError) {
        const backfill = await collectRetryOnErrorMessageIds(db);
        reparseStaleReviewIds = new Set([
            ...reparseStaleReviewIds,
            ...backfill.reparseStaleReviewIds,
        ]);
        messageIds = [...new Set([...messageIds, ...backfill.messageIds])];
    }
    let processed = 0;
    let skipped = 0;
    let errors = 0;
    let invoicesQueued = 0;
    const skippedByStatus = {};
    const skippedReviewCounts = {};
    const errorDetails = [];
    for (const messageId of messageIds) {
        try {
            const result = await (0, processInboundGmailMessage_1.processInboundGmailMessage)(accessToken, messageId, {
                retryOnError: options?.retryOnError,
                reparseStaleReviews: reparseStaleReviewIds.has(messageId),
            });
            if (result.skipped) {
                skipped += 1;
                const status = result.skippedProcessingStatus ?? result.processingStatus;
                skippedByStatus[status] = (skippedByStatus[status] ?? 0) + 1;
                const reviewCount = result.reviewRecordIds.length;
                skippedReviewCounts[status] =
                    (skippedReviewCounts[status] ?? 0) + reviewCount;
            }
            else {
                processed += 1;
                invoicesQueued += result.reviewRecordIds.length;
            }
        }
        catch (err) {
            errors += 1;
            const message = err instanceof Error ? err.message : String(err);
            errorDetails.push({ gmailMessageId: messageId, message: message.slice(0, 200) });
            console.error(`syncInboundGmail: message ${messageId} failed — ${message}`);
        }
    }
    const now = new Date().toISOString();
    const advanceCursor = (0, gmailInboundCatchUp_1.shouldAdvanceInboundSyncCursor)({
        listingComplete,
        remainderCount,
    });
    await connectionRef(db).set({
        inboundSync: {
            ...inboundSync,
            ...(advanceCursor
                ? {
                    lastHistoryId: latestHistoryId ?? inboundSync.lastHistoryId,
                    lastSyncAt: now,
                }
                : {}),
        },
        updatedAt: now,
    }, { merge: true });
    console.log(`syncInboundGmail: catchUpListed=${catchUpIds.length} catchUpUnprocessed=${unprocessedCatchUpIds.length} catchUpProcessNow=${processNow.length} remainder=${remainderCount} listingComplete=${listingComplete} advanceCursor=${advanceCursor} processed=${processed} skipped=${skipped} errors=${errors}`);
    return {
        processed,
        skipped,
        errors,
        invoicesQueued,
        skippedByStatus,
        skippedReviewCounts,
        errorDetails,
    };
}
exports.syncInboundGmail = (0, scheduler_1.onSchedule)({
    schedule: "every 30 minutes",
    region: "us-central1",
    secrets: [gmailApi_1.gmailClientId, gmailApi_1.gmailClientSecret],
    timeoutSeconds: 300,
}, async () => {
    await runInboundGmailSync();
});
//# sourceMappingURL=syncInboundGmail.js.map