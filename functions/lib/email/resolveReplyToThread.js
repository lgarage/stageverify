"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveReplyToThread = resolveReplyToThread;
/**
 * Deterministic inbound reply matching ladder (Stage 1 — no AI).
 * Pure function — testable offline.
 */
const matchEmailToRecords_1 = require("./matchEmailToRecords");
const parseVendorEmail_1 = require("./parseVendorEmail");
const trackingToken_1 = require("./trackingToken");
function normalizeMessageId(id) {
    return id.replace(/^<|>$/g, "").trim().toLowerCase();
}
function referenceIds(headers) {
    const ids = [];
    if (headers.inReplyTo)
        ids.push(normalizeMessageId(headers.inReplyTo));
    for (const ref of headers.references ?? []) {
        ids.push(normalizeMessageId(ref));
    }
    return ids.filter(Boolean);
}
function findOutboundByThreadId(threadId, outbound) {
    if (!threadId)
        return undefined;
    return outbound.find((e) => e.threadId === threadId);
}
function findOutboundByReferences(refIds, outbound) {
    if (refIds.length === 0)
        return undefined;
    return outbound.find((e) => {
        if (!e.rfc822MessageId)
            return false;
        const normalized = normalizeMessageId(e.rfc822MessageId);
        return refIds.includes(normalized);
    });
}
function findOutboundByToken(token, outbound) {
    if (!token)
        return undefined;
    return outbound.find((e) => (0, trackingToken_1.tokensEqual)(e.trackingToken, token));
}
function contentMatchPointsToDifferentDelivery(outbound, contentMatch) {
    if (!outbound.deliveryOrderId || !contentMatch.deliveryOrderId)
        return false;
    return outbound.deliveryOrderId !== contentMatch.deliveryOrderId;
}
function multiPoReviewRequired(parsed) {
    return parsed.poNumbers.length > 1 || parsed.orderNumbers.length > 1;
}
/** First-hit-wins ladder with conflict and spoof guards. */
function resolveReplyToThread(input) {
    const { message, headers, outboundEvents, matchContext, senderDomainKnown } = input;
    const parsed = (0, parseVendorEmail_1.parseVendorEmail)(message);
    const contentMatch = (0, matchEmailToRecords_1.matchEmailToRecords)(message, parsed, matchContext);
    const refIds = referenceIds(headers);
    const allRecipientAddresses = [
        ...(headers.toAddresses ?? []),
        ...(headers.ccAddresses ?? []),
        ...(headers.deliveredTo ?? []),
        ...message.recipientEmails,
    ];
    const plusToken = (0, trackingToken_1.extractTokenFromAddresses)(allRecipientAddresses);
    const subjectToken = (0, trackingToken_1.extractTokenFromSubject)(message.subject);
    const bodyToken = (0, trackingToken_1.extractTokenFromBody)(message.bodyText);
    const anyToken = plusToken ?? subjectToken ?? bodyToken;
    let matchedBy = "none";
    let outboundEvent;
    let trackingToken;
    const threadHit = findOutboundByThreadId(headers.threadId ?? message.threadId, outboundEvents);
    if (threadHit) {
        matchedBy = "threadId";
        outboundEvent = threadHit;
        trackingToken = threadHit.trackingToken;
    }
    else {
        const refHit = findOutboundByReferences(refIds, outboundEvents);
        if (refHit) {
            matchedBy = "references";
            outboundEvent = refHit;
            trackingToken = refHit.trackingToken;
        }
        else if (plusToken) {
            const plusHit = findOutboundByToken(plusToken, outboundEvents);
            if (plusHit) {
                matchedBy = "plusToken";
                outboundEvent = plusHit;
                trackingToken = plusToken;
            }
        }
        else if (subjectToken) {
            const subHit = findOutboundByToken(subjectToken, outboundEvents);
            if (subHit) {
                matchedBy = "subjectToken";
                outboundEvent = subHit;
                trackingToken = subjectToken;
            }
        }
        else if (bodyToken) {
            const bodyHit = findOutboundByToken(bodyToken, outboundEvents);
            if (bodyHit) {
                matchedBy = "bodyToken";
                outboundEvent = bodyHit;
                trackingToken = bodyToken;
            }
        }
    }
    let humanReviewRequired = true;
    let applyConflictReason;
    let confidenceScore = contentMatch.confidenceScore;
    let confidenceReason = contentMatch.confidenceReason;
    if (outboundEvent) {
        confidenceScore = 95;
        confidenceReason = `thread_ladder:${matchedBy}`;
        humanReviewRequired = false;
        if (matchedBy === "references") {
            humanReviewRequired = true;
            applyConflictReason = applyConflictReason ?? "references_match_requires_review";
        }
        if (contentMatchPointsToDifferentDelivery(outboundEvent, contentMatch)) {
            humanReviewRequired = true;
            applyConflictReason = "thread_content_mismatch";
            confidenceReason = `${confidenceReason}; thread_content_mismatch`;
        }
        const tokenOnlyMatch = (matchedBy === "subjectToken" || matchedBy === "plusToken" || matchedBy === "bodyToken") &&
            !senderDomainKnown;
        if (tokenOnlyMatch) {
            humanReviewRequired = true;
            applyConflictReason = applyConflictReason ?? "token_match_unknown_sender";
            confidenceReason = `${confidenceReason}; token_match_unknown_sender`;
        }
    }
    else if (contentMatch.confidenceScore >= 60) {
        matchedBy = "deterministic";
        humanReviewRequired = contentMatch.humanReviewRequired;
        confidenceScore = contentMatch.confidenceScore;
        confidenceReason = contentMatch.confidenceReason;
    }
    else {
        matchedBy = "none";
        humanReviewRequired = true;
        confidenceScore = Math.min(contentMatch.confidenceScore, 30);
        confidenceReason = contentMatch.confidenceReason || "unmatched_inbound_reply";
    }
    if (multiPoReviewRequired(parsed)) {
        humanReviewRequired = true;
        applyConflictReason = applyConflictReason ?? "multiple_po_references";
        confidenceReason = `${confidenceReason}; multiple_po_references`;
    }
    if (parsed.classification === "irrelevant") {
        humanReviewRequired = true;
        applyConflictReason = applyConflictReason ?? "irrelevant_classification";
    }
    return {
        matchedBy,
        outboundEvent,
        deterministicMatch: matchedBy === "deterministic" ? contentMatch : undefined,
        trackingToken: trackingToken ?? anyToken ?? undefined,
        humanReviewRequired,
        applyConflictReason,
        confidenceScore,
        confidenceReason,
    };
}
//# sourceMappingURL=resolveReplyToThread.js.map