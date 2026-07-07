/**
 * Deterministic inbound reply matching ladder (Stage 1 — no AI).
 * Pure function — testable offline.
 */
import { matchEmailToRecords } from "./matchEmailToRecords";
import { parseVendorEmail } from "./parseVendorEmail";
import {
  extractCanonicalFooterTokenFromBody,
  extractNonCanonicalBodyRefTokens,
  extractTokenFromAddresses,
  extractTokenFromSubject,
  tokensEqual,
} from "./trackingToken";
import type { EmailMatchCandidate, InboundEmailMessage } from "./types";
import type { MatchContext } from "./matchEmailToRecords";

export type ReplyMatchMethod =
  | "threadId"
  | "references"
  | "plusToken"
  | "subjectToken"
  | "bodyToken"
  | "deterministic"
  | "none";

export interface OutboundThreadContext {
  eventId: string;
  threadId?: string;
  rfc822MessageId?: string;
  trackingToken?: string;
  deliveryOrderId?: string;
  vendorInvoiceImportId?: string;
  vendorId?: string;
  jobId?: string;
  purchaseOrderId?: string;
}

export interface ReplyHeaderContext {
  threadId?: string;
  messageIdHeader?: string;
  inReplyTo?: string;
  references?: string[];
  toAddresses?: string[];
  ccAddresses?: string[];
  deliveredTo?: string[];
  replyToAddresses?: string[];
}

export interface ResolveReplyInput {
  message: InboundEmailMessage;
  headers: ReplyHeaderContext;
  outboundEvents: OutboundThreadContext[];
  matchContext: MatchContext;
  senderDomainKnown: boolean;
  /** Gmail Authentication-Results verdict — false when SPF/DKIM failed. */
  senderAuthPass?: boolean;
}

export interface ResolveReplyResult {
  matchedBy: ReplyMatchMethod;
  outboundEvent?: OutboundThreadContext;
  deterministicMatch?: EmailMatchCandidate;
  trackingToken?: string;
  humanReviewRequired: boolean;
  applyConflictReason?: string;
  confidenceScore: number;
  confidenceReason: string;
}

function normalizeMessageId(id: string): string {
  return id.replace(/^<|>$/g, "").trim().toLowerCase();
}

function referenceIds(headers: ReplyHeaderContext): string[] {
  const ids: string[] = [];
  if (headers.inReplyTo) ids.push(normalizeMessageId(headers.inReplyTo));
  for (const ref of headers.references ?? []) {
    ids.push(normalizeMessageId(ref));
  }
  return ids.filter(Boolean);
}

function findOutboundByThreadId(
  threadId: string | undefined,
  outbound: OutboundThreadContext[],
): OutboundThreadContext | undefined {
  if (!threadId) return undefined;
  return outbound.find((e) => e.threadId === threadId);
}

function findOutboundByReferences(
  refIds: string[],
  outbound: OutboundThreadContext[],
): OutboundThreadContext | undefined {
  if (refIds.length === 0) return undefined;
  return outbound.find((e) => {
    if (!e.rfc822MessageId) return false;
    const normalized = normalizeMessageId(e.rfc822MessageId);
    return refIds.includes(normalized);
  });
}

function findOutboundByToken(
  token: string | null,
  outbound: OutboundThreadContext[],
): OutboundThreadContext | undefined {
  if (!token) return undefined;
  return outbound.find((e) => tokensEqual(e.trackingToken, token));
}

function contentMatchPointsToDifferentDelivery(
  outbound: OutboundThreadContext,
  contentMatch: EmailMatchCandidate,
): boolean {
  if (!outbound.deliveryOrderId || !contentMatch.deliveryOrderId) return false;
  return outbound.deliveryOrderId !== contentMatch.deliveryOrderId;
}

function multiPoReviewRequired(parsed: ReturnType<typeof parseVendorEmail>): boolean {
  return parsed.poNumbers.length > 1 || parsed.orderNumbers.length > 1;
}

function footerRefConflictsWithOutbound(
  footerToken: string,
  outbound: OutboundThreadContext,
): boolean {
  if (!outbound.trackingToken) return false;
  return !tokensEqual(footerToken, outbound.trackingToken);
}

function nonCanonicalRefConflicts(
  nonCanonicalRefs: string[],
  outbound: OutboundThreadContext,
): boolean {
  if (nonCanonicalRefs.length === 0) return false;
  if (!outbound.trackingToken) return nonCanonicalRefs.length > 0;
  return nonCanonicalRefs.some((t) => !tokensEqual(t, outbound.trackingToken));
}

/** First-hit-wins ladder with conflict and spoof guards. */
export function resolveReplyToThread(input: ResolveReplyInput): ResolveReplyResult {
  const {
    message,
    headers,
    outboundEvents,
    matchContext,
    senderDomainKnown,
    senderAuthPass,
  } = input;
  const parsed = parseVendorEmail(message);
  const contentMatch = matchEmailToRecords(message, parsed, matchContext);
  const refIds = referenceIds(headers);

  const allRecipientAddresses = [
    ...(headers.replyToAddresses ?? []),
    ...(headers.toAddresses ?? []),
    ...(headers.ccAddresses ?? []),
    ...(headers.deliveredTo ?? []),
    ...message.recipientEmails,
  ];

  const plusToken = extractTokenFromAddresses(allRecipientAddresses);
  const subjectToken = extractTokenFromSubject(message.subject);
  const footerToken = extractCanonicalFooterTokenFromBody(message.bodyText);
  const nonCanonicalRefs = extractNonCanonicalBodyRefTokens(message.bodyText);

  let matchedBy: ReplyMatchMethod = "none";
  let outboundEvent: OutboundThreadContext | undefined;
  let trackingToken: string | undefined;

  // 1. Gmail threadId
  const threadHit = findOutboundByThreadId(headers.threadId ?? message.threadId, outboundEvents);
  if (threadHit) {
    matchedBy = "threadId";
    outboundEvent = threadHit;
    trackingToken = threadHit.trackingToken;
  } else {
    // 2. Message-ID / In-Reply-To / References
    const refHit = findOutboundByReferences(refIds, outboundEvents);
    if (refHit) {
      matchedBy = "references";
      outboundEvent = refHit;
      trackingToken = refHit.trackingToken;
    } else if (plusToken) {
      // 3. Reply-To / plus-address token → 5. stored outbound token linkage
      const plusHit = findOutboundByToken(plusToken, outboundEvents);
      if (plusHit) {
        matchedBy = "plusToken";
        outboundEvent = plusHit;
        trackingToken = plusToken;
      }
    } else if (subjectToken) {
      // 4. subject SV token (legacy) → 5. stored outbound token linkage
      const subHit = findOutboundByToken(subjectToken, outboundEvents);
      if (subHit) {
        matchedBy = "subjectToken";
        outboundEvent = subHit;
        trackingToken = subjectToken;
      }
    } else if (footerToken) {
      // 6. body/footer Ref — weak fallback only (canonical server footer)
      const footerHit = findOutboundByToken(footerToken, outboundEvents);
      if (footerHit) {
        matchedBy = "bodyToken";
        outboundEvent = footerHit;
        trackingToken = footerToken;
      }
    }
  }

  let humanReviewRequired = true;
  let applyConflictReason: string | undefined;
  let confidenceScore = contentMatch.confidenceScore;
  let confidenceReason = contentMatch.confidenceReason;

  if (outboundEvent) {
    confidenceScore = matchedBy === "bodyToken" ? 55 : 95;
    confidenceReason = `thread_ladder:${matchedBy}`;
    humanReviewRequired = matchedBy === "bodyToken";

    if (matchedBy === "references") {
      humanReviewRequired = true;
      applyConflictReason = applyConflictReason ?? "references_match_requires_review";
    }

    if (matchedBy === "bodyToken") {
      humanReviewRequired = true;
      applyConflictReason = applyConflictReason ?? "footer_ref_weak_match";
      confidenceReason = `${confidenceReason}; footer_ref_weak_match`;
    }

    if (contentMatchPointsToDifferentDelivery(outboundEvent, contentMatch)) {
      humanReviewRequired = true;
      applyConflictReason = "thread_content_mismatch";
      confidenceReason = `${confidenceReason}; thread_content_mismatch`;
    }

    const tokenOnlyMatch =
      (matchedBy === "subjectToken" || matchedBy === "plusToken" || matchedBy === "bodyToken") &&
      !senderDomainKnown;
    if (tokenOnlyMatch) {
      humanReviewRequired = true;
      applyConflictReason = applyConflictReason ?? "token_match_unknown_sender";
      confidenceReason = `${confidenceReason}; token_match_unknown_sender`;
    }

    if (
      (matchedBy === "subjectToken" || matchedBy === "plusToken") &&
      senderAuthPass === false
    ) {
      humanReviewRequired = true;
      applyConflictReason = applyConflictReason ?? "token_match_failed_sender_auth";
      confidenceReason = `${confidenceReason}; token_match_failed_sender_auth`;
    }

    // Strong match + conflicting canonical footer Ref → Needs Review
    if (
      matchedBy !== "bodyToken" &&
      footerToken &&
      footerRefConflictsWithOutbound(footerToken, outboundEvent)
    ) {
      humanReviewRequired = true;
      applyConflictReason = applyConflictReason ?? "body_ref_conflict";
      confidenceReason = `${confidenceReason}; body_ref_conflict`;
    }

    // Known vendor domain + forged body Ref + failed SPF → stay flagged (takes precedence)
    if (
      senderDomainKnown &&
      senderAuthPass === false &&
      (nonCanonicalRefs.length > 0 ||
        (footerToken && footerRefConflictsWithOutbound(footerToken, outboundEvent)))
    ) {
      humanReviewRequired = true;
      applyConflictReason = "spoofed_body_ref_failed_auth";
      confidenceReason = `${confidenceReason}; spoofed_body_ref_failed_auth`;
    } else if (matchedBy !== "bodyToken" && nonCanonicalRefConflicts(nonCanonicalRefs, outboundEvent)) {
      humanReviewRequired = true;
      applyConflictReason = applyConflictReason ?? "non_canonical_body_ref";
      confidenceReason = `${confidenceReason}; non_canonical_body_ref`;
    }
  } else if (contentMatch.confidenceScore >= 60) {
    // 7. matchEmailToRecords heuristics
    matchedBy = "deterministic";
    humanReviewRequired = contentMatch.humanReviewRequired;
    confidenceScore = contentMatch.confidenceScore;
    confidenceReason = contentMatch.confidenceReason;
  } else {
    // 8. Needs Review fallback
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

  const anyToken = plusToken ?? subjectToken ?? footerToken;

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
