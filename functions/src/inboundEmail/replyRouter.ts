/**
 * Inbound non-PDF reply router — writes vendorEmailEvents only.
 * NEVER mutates deliveries, items, or invoice imports.
 */
import * as admin from "firebase-admin";
import { randomUUID } from "crypto";
import { contentFingerprint, parseVendorEmail } from "../email/parseVendorEmail";
import { loadEmailMatchContext, loadExistingEmailIndex } from "../email/loadMatchContext";
import {
  loadOutboundEmailContext,
  type ReplyIngestSettings,
} from "../email/loadOutboundEmailContext";
import { resolveReplyToThread } from "../email/resolveReplyToThread";
import type { ParsedGmailHeaders } from "../gmailInbound";
import type { InboundEmailMessage } from "../email/types";
import type { MatchContext } from "../email/matchEmailToRecords";

const MAX_BODY_STORE = 12_000;
const BODY_EXCERPT_LEN = 500;

function omitUndefined(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function getDb() {
  return admin.firestore();
}

function bodyExcerpt(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length <= BODY_EXCERPT_LEN) return trimmed;
  return `${trimmed.slice(0, BODY_EXCERPT_LEN - 1)}…`;
}

function capBody(body: string): string {
  if (body.length <= MAX_BODY_STORE) return body;
  return `${body.slice(0, MAX_BODY_STORE - 1)}…`;
}

function senderDomainKnown(senderEmail: string, ctx: MatchContext): boolean {
  const domain = senderEmail.split("@")[1]?.toLowerCase();
  if (!domain) return false;
  return ctx.vendors.some((v) => {
    const contact = v.email?.split("@")[1]?.toLowerCase();
    return contact === domain;
  });
}

function isAutoReply(headers: ParsedGmailHeaders): boolean {
  const auto = headers.autoSubmitted?.toLowerCase() ?? "";
  const prec = headers.precedence?.toLowerCase() ?? "";
  return auto.includes("auto-replied") || auto.includes("auto-generated") || prec === "bulk";
}

export interface ProcessInboundReplyInput {
  gmailMessageId: string;
  threadId?: string;
  headers: ParsedGmailHeaders;
  bodyText: string;
  snippet?: string;
  settings: ReplyIngestSettings;
}

export interface ProcessInboundReplyResult {
  eventId?: string;
  skipped: boolean;
  skipReason?: string;
  duplicate?: boolean;
}

/** Route a non-PDF inbound message to vendorEmailEvents (pending review only). */
export async function processInboundReply(
  input: ProcessInboundReplyInput,
): Promise<ProcessInboundReplyResult> {
  if (!input.settings.enabled) {
    return { skipped: true, skipReason: "reply_ingest_disabled" };
  }

  const db = getDb();
  const existingIndex = await loadExistingEmailIndex();
  const duplicateOf = existingIndex.byMessageId.get(input.gmailMessageId);
  if (duplicateOf) {
    return { skipped: true, skipReason: "duplicate_source_message", duplicate: true, eventId: duplicateOf };
  }

  if (isAutoReply(input.headers)) {
    return { skipped: true, skipReason: "auto_reply" };
  }

  const message: InboundEmailMessage = {
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

  const fingerprint = contentFingerprint(message);
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
    loadEmailMatchContext(),
    loadOutboundEmailContext(),
  ]);

  const resolved = resolveReplyToThread({
    message,
    headers: {
      threadId: input.threadId,
      messageIdHeader: input.headers.messageIdHeader,
      inReplyTo: input.headers.inReplyTo,
      references: input.headers.references,
      toAddresses: input.headers.toAddresses,
      ccAddresses: input.headers.ccAddresses,
      deliveredTo: input.headers.deliveredTo,
    },
    outboundEvents,
    matchContext,
    senderDomainKnown: senderDomainKnown(message.senderEmail, matchContext),
  });

  const parsed = parseVendorEmail(message);
  const now = new Date().toISOString();
  const eventId = `vee-${randomUUID()}`;

  const outbound = resolved.outboundEvent;
  const det = resolved.deterministicMatch;

  const deliveryOrderId = outbound?.deliveryOrderId ?? det?.deliveryOrderId;
  const vendorId = outbound?.vendorId ?? det?.vendorId;
  const jobId = outbound?.jobId ?? det?.jobId;
  const purchaseOrderId = outbound?.purchaseOrderId ?? det?.purchaseOrderId;

  const reviewStatus = resolved.matchedBy === "none" ? "pending_review" : "pending_review";

  const eventDoc: Record<string, unknown> = {
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
      ? !/fail|softfail/i.test(input.headers.authenticationResults)
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
