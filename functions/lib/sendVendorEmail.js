"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendVendorEmail = void 0;
/**
 * Phase 6 slice 2 — outbound vendor email from Resolve Issue flow.
 * Requires Gmail OAuth connected + refresh token in Admin-only storage.
 * No reply watch or inbound ingest.
 */
const admin = require("firebase-admin");
const crypto_1 = require("crypto");
const https_1 = require("firebase-functions/v2/https");
const gmailApi_1 = require("./gmailApi");
const PROVIDER_ID = "gmail";
const MAX_SUBJECT_LEN = 500;
const MAX_BODY_LEN = 12_000;
const MAX_EMAIL_LEN = 254;
const MAX_ID_LEN = 128;
const BODY_EXCERPT_LEN = 500;
function getDb() {
    return admin.firestore();
}
function connectionRef(db) {
    return db.collection("emailProviderConnections").doc(PROVIDER_ID);
}
function secretsRef(db) {
    return db.collection("emailProviderSecrets").doc(PROVIDER_ID);
}
function asNonEmptyString(value, maxLen) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > maxLen)
        return null;
    if ((0, gmailApi_1.containsCrlfInEmailHeader)(trimmed))
        return null;
    return trimmed;
}
function asEmail(value) {
    const s = asNonEmptyString(value, MAX_EMAIL_LEN);
    if (!s || !s.includes("@"))
        return null;
    return s.toLowerCase();
}
function omitUndefined(data) {
    const out = {};
    for (const [k, v] of Object.entries(data)) {
        if (v !== undefined)
            out[k] = v;
    }
    return out;
}
function bodyExcerpt(body) {
    const trimmed = body.trim();
    if (trimmed.length <= BODY_EXCERPT_LEN)
        return trimmed;
    return `${trimmed.slice(0, BODY_EXCERPT_LEN - 1)}…`;
}
exports.sendVendorEmail = (0, https_1.onCall)({
    region: "us-central1",
    secrets: [gmailApi_1.gmailClientId, gmailApi_1.gmailClientSecret],
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError("permission-denied", "Sign in as a dispatcher to send vendor email.");
    }
    const data = (request.data ?? {});
    const deliveryOrderId = asNonEmptyString(data.deliveryOrderId, MAX_ID_LEN);
    const materialIssueId = data.materialIssueId
        ? asNonEmptyString(data.materialIssueId, MAX_ID_LEN)
        : null;
    const to = asEmail(data.to);
    const subject = asNonEmptyString(data.subject, MAX_SUBJECT_LEN);
    const body = asNonEmptyString(data.body, MAX_BODY_LEN);
    if (!deliveryOrderId || !to || !subject || !body) {
        throw new https_1.HttpsError("invalid-argument", "deliveryOrderId, to, subject, and body are required.");
    }
    const db = getDb();
    const connSnap = await connectionRef(db).get();
    if (!connSnap.exists) {
        throw new https_1.HttpsError("failed-precondition", "Gmail is not connected. Connect in Settings first.");
    }
    const conn = connSnap.data();
    if (conn.status !== "connected") {
        throw new https_1.HttpsError("failed-precondition", "Gmail is not connected. Connect in Settings first.");
    }
    const fromEmail = conn.connectedAccountEmail?.trim();
    if (!fromEmail || (0, gmailApi_1.containsCrlfInEmailHeader)(fromEmail)) {
        throw new https_1.HttpsError("failed-precondition", "Gmail connection is missing account email. Reconnect in Settings.");
    }
    const secretSnap = await secretsRef(db).get();
    const refreshToken = secretSnap.exists
        ? secretSnap.data().refreshToken?.trim()
        : undefined;
    if (!refreshToken) {
        throw new https_1.HttpsError("failed-precondition", "Gmail refresh token missing. Reconnect in Settings.");
    }
    const deliverySnap = await db.collection("deliveries").doc(deliveryOrderId).get();
    if (!deliverySnap.exists) {
        throw new https_1.HttpsError("not-found", "Delivery not found.");
    }
    const delivery = deliverySnap.data();
    if (!delivery.vendorId) {
        throw new https_1.HttpsError("failed-precondition", "Delivery has no vendor.");
    }
    const vendorSnap = await db.collection("vendors").doc(delivery.vendorId).get();
    if (!vendorSnap.exists) {
        throw new https_1.HttpsError("not-found", "Vendor not found.");
    }
    const vendor = vendorSnap.data();
    const vendorEmail = vendor.email?.trim().toLowerCase();
    if (!vendorEmail) {
        throw new https_1.HttpsError("failed-precondition", "Vendor has no email on file.");
    }
    if (to !== vendorEmail) {
        throw new https_1.HttpsError("invalid-argument", "Recipient must match vendor email on file.");
    }
    if (materialIssueId) {
        const issueSnap = await db.collection("materialIssues").doc(materialIssueId).get();
        if (!issueSnap.exists) {
            throw new https_1.HttpsError("not-found", "Material issue not found.");
        }
        const issue = issueSnap.data();
        if (issue.deliveryOrderId !== deliveryOrderId) {
            throw new https_1.HttpsError("invalid-argument", "Material issue does not belong to this delivery.");
        }
    }
    let accessToken;
    try {
        accessToken = await (0, gmailApi_1.refreshGmailAccessToken)(refreshToken);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("sendVendorEmail token refresh failed:", message);
        const now = new Date().toISOString();
        await connectionRef(db).set({
            provider: PROVIDER_ID,
            status: "token_expired",
            updatedAt: now,
        }, { merge: true });
        throw new https_1.HttpsError("failed-precondition", "Gmail token expired. Reconnect in Settings.");
    }
    const raw = (0, gmailApi_1.buildGmailRawMessage)(to, fromEmail, subject, body);
    let gmailResult;
    try {
        gmailResult = await (0, gmailApi_1.sendGmailMessage)(accessToken, raw);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("sendVendorEmail gmail send failed:", message);
        throw new https_1.HttpsError("internal", "Failed to send email. Check Gmail connection and try again.");
    }
    const now = new Date().toISOString();
    const eventId = `vee-${(0, crypto_1.randomUUID)()}`;
    const eventDoc = omitUndefined({
        id: eventId,
        sourceMessageId: gmailResult.id,
        threadId: gmailResult.threadId,
        direction: "outbound",
        communicationPurpose: "need_more_information",
        materialIssueId: materialIssueId ?? undefined,
        senderEmail: fromEmail,
        recipientEmails: [to],
        subject,
        receivedAt: now,
        vendorId: delivery.vendorId,
        jobId: delivery.jobId,
        deliveryOrderId,
        purchaseOrderId: delivery.purchaseOrderId,
        reviewStatus: "approved",
        sentBy: request.auth.uid,
        sentAt: now,
        bodyExcerpt: bodyExcerpt(body),
        provider: PROVIDER_ID,
        createdAt: now,
        updatedAt: now,
    });
    await db.collection("vendorEmailEvents").doc(eventId).set(eventDoc);
    return {
        eventId,
        sourceMessageId: gmailResult.id,
        threadId: gmailResult.threadId ?? null,
        sentAt: now,
    };
});
//# sourceMappingURL=sendVendorEmail.js.map