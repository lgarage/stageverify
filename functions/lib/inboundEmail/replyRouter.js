"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processInboundReply = processInboundReply;
/**
 * Inbound non-PDF reply router — writes vendorEmailEvents only.
 * NEVER mutates deliveries, items, or invoice imports.
 */
const admin = require("firebase-admin");
const crypto_1 = require("crypto");
const parseVendorEmail_1 = require("../email/parseVendorEmail");
const loadMatchContext_1 = require("../email/loadMatchContext");
const loadOutboundEmailContext_1 = require("../email/loadOutboundEmailContext");
const resolveReplyToThread_1 = require("../email/resolveReplyToThread");
const MAX_BODY_STORE = 12_000;
const BODY_EXCERPT_LEN = 500;
function omitUndefined(data) {
    const out = {};
    for (const [k, v] of Object.entries(data)) {
        if (v !== undefined)
            out[k] = v;
    }
    return out;
}
function getDb() {
    return admin.firestore();
}
function bodyExcerpt(body) {
    const trimmed = body.trim();
    if (trimmed.length <= BODY_EXCERPT_LEN)
        return trimmed;
    return `${trimmed.slice(0, BODY_EXCERPT_LEN - 1)}…`;
}
function capBody(body) {
    if (body.length <= MAX_BODY_STORE)
        return body;
    return `${body.slice(0, MAX_BODY_STORE - 1)}…`;
}
function senderDomainKnown(senderEmail, ctx) {
    const domain = senderEmail.split("@")[1]?.toLowerCase();
    if (!domain)
        return false;
    return ctx.vendors.some((v) => {
        const contact = v.email?.split("@")[1]?.toLowerCase();
        return contact === domain;
    });
}
function isAutoReply(headers) {
    const auto = headers.autoSubmitted?.toLowerCase() ?? "";
    const prec = headers.precedence?.toLowerCase() ?? "";
    return auto.includes("auto-replied") || auto.includes("auto-generated") || prec === "bulk";
}
/** Route a non-PDF inbound message to vendorEmailEvents (pending review only). */
async function processInboundReply(input) {
    if (!input.settings.enabled) {
        return { skipped: true, skipReason: "reply_ingest_disabled" };
    }
    const db = getDb();
    const existingIndex = await (0, loadMatchContext_1.loadExistingEmailIndex)();
    const duplicateOf = existingIndex.byMessageId.get(input.gmailMessageId);
    if (duplicateOf) {
        return { skipped: true, skipReason: "duplicate_source_message", duplicate: true, eventId: duplicateOf };
    }
    if (isAutoReply(input.headers)) {
        return { skipped: true, skipReason: "auto_reply" };
    }
    const message = {
        sourceMessageId: input.gmailMessageId,
        threadId: input.threadId,
        senderEmail: input.headers.senderEmail,
        recipientEmails: [
            ...(input.headers.toAddresses ?? []),
            ...(input.headers.deliveredTo ?? []),
        ],
        subject: input.headers.subject,
        bodyText: capBody(input.bodyText),
        receivedAt: input.headers.receivedAt,
    };
    const fingerprint = (0, parseVendorEmail_1.contentFingerprint)(message);
    const dupFingerprint = existingIndex.byFingerprint.get(fingerprint);
    if (dupFingerprint) {
        return {
            skipped: true,
            skipReason: "duplicate_fingerprint",
            duplicate: true,
            eventId: dupFingerprint,
        };
    }
    const [matchContext, outboundEvents] = await Promise.all([
        (0, loadMatchContext_1.loadEmailMatchContext)(),
        (0, loadOutboundEmailContext_1.loadOutboundEmailContext)(),
    ]);
    const resolved = (0, resolveReplyToThread_1.resolveReplyToThread)({
        message,
        headers: {
            threadId: input.threadId,
            messageIdHeader: input.headers.messageIdHeader,
            inReplyTo: input.headers.inReplyTo,
            references: input.headers.references,
            toAddresses: input.headers.toAddresses,
            ccAddresses: input.headers.ccAddresses,
            deliveredTo: input.headers.deliveredTo,
            replyToAddresses: input.headers.replyToAddresses,
        },
        outboundEvents,
        matchContext,
        senderDomainKnown: senderDomainKnown(message.senderEmail, matchContext),
        senderAuthPass: input.headers.authenticationResults
            ? !/spf=(?:fail|softfail)|dkim=(?:fail|softfail)/i.test(input.headers.authenticationResults)
            : undefined,
    });
    const parsed = (0, parseVendorEmail_1.parseVendorEmail)(message);
    const now = new Date().toISOString();
    const eventId = `vee-${(0, crypto_1.randomUUID)()}`;
    const outbound = resolved.outboundEvent;
    const det = resolved.deterministicMatch;
    const deliveryOrderId = outbound?.deliveryOrderId ?? det?.deliveryOrderId;
    const vendorId = outbound?.vendorId ?? det?.vendorId;
    const jobId = outbound?.jobId ?? det?.jobId;
    const purchaseOrderId = outbound?.purchaseOrderId ?? det?.purchaseOrderId;
    const reviewStatus = resolved.matchedBy === "none" ? "pending_review" : "pending_review";
    const eventDoc = {
        id: eventId,
        sourceMessageId: input.gmailMessageId,
        threadId: input.threadId,
        contentFingerprint: fingerprint,
        direction: "inbound",
        communicationPurpose: "vendor_order_update",
        senderEmail: message.senderEmail,
        recipientEmails: message.recipientEmails,
        subject: message.subject,
        receivedAt: message.receivedAt,
        vendorId,
        jobId,
        deliveryOrderId,
        purchaseOrderId,
        vendorInvoiceImportId: outbound?.vendorInvoiceImportId,
        proposedPoNumber: parsed.poNumbers[0],
        proposedOrderNumber: parsed.orderNumbers[0],
        proposedJobNumber: parsed.jobNumbers[0],
        emailClassification: parsed.classification,
        confidenceScore: resolved.confidenceScore,
        confidenceReason: resolved.confidenceReason,
        humanReviewRequired: resolved.humanReviewRequired,
        reviewStatus,
        matchedBy: resolved.matchedBy,
        trackingToken: resolved.trackingToken,
        rfc822MessageId: input.headers.messageIdHeader,
        inReplyTo: input.headers.inReplyTo,
        references: input.headers.references,
        bodyExcerpt: bodyExcerpt(message.bodyText),
        snippet: input.snippet?.slice(0, 500),
        senderAuthPass: input.headers.authenticationResults
            ? !/spf=(?:fail|softfail)|dkim=(?:fail|softfail)/i.test(input.headers.authenticationResults)
            : undefined,
        provider: "gmail",
        createdAt: now,
        updatedAt: now,
    };
    if (resolved.applyConflictReason) {
        eventDoc.applyConflictReason = resolved.applyConflictReason;
    }
    await db.collection("vendorEmailEvents").doc(eventId).set(omitUndefined(eventDoc));
    return { eventId, skipped: false };
}
//# sourceMappingURL=replyRouter.js.map