import { EMAIL_FIXTURES, MULTI_VENDOR_MATCH_CONTEXT } from "./emailFixtures";
import { contentFingerprint } from "./parseVendorEmail";
import { processInboundEmail } from "./processEmailMessage";
import {
  bodyExcerpt,
  describeCondition1Impact,
  describeOperationalMeaning,
  resolveMatchLabels,
} from "./proposedEmailDetail";
import type { DeliveryOrder } from "../models";
import type { EmailClassification, EmailProcessingResult } from "./types";

export interface ProposedEmailUpdate {
  messageId: string;
  subject: string;
  senderEmail: string;
  receivedAt: string;
  classification: EmailClassification;
  poNumber: string | null;
  vendorName: string | null;
  confidenceScore: number;
  confidenceReason: string;
  reviewStatus: EmailProcessingResult["reviewStatus"];
  duplicate: boolean;
  matchedJobNumber: string | null;
  matchedPoLabel: string | null;
  matchedOrderLabel: string | null;
  matchedDeliveryLabel: string | null;
  /** Fixture/offline match target — filter drawer evidence by delivery.id or order+PO. */
  matchedDeliveryOrderId: string | null;
  itemLines: Array<{ description: string; qty?: number }>;
  bodyExcerpt: string;
  /** Full original body — shown only after View Original Email (fixtures / future VendorEmailEvent). */
  originalBody: string;
  recipientEmails: string[];
  threadId?: string;
  proposedOperationalMeaning: string;
  affectsCondition1: boolean;
  condition1ApprovalNote: string;
  /** Live inbound reply-router fields — UI classification only. */
  matchedBy?: string;
  humanReviewRequired?: boolean;
  applyConflictReason?: string;
}

const vendorNameById = new Map(
  MULTI_VENDOR_MATCH_CONTEXT.vendors.map((v) => [v.id, v.name]),
);

/** Offline fixture-derived proposals for dispatcher review (read-only — no Firestore writes). */
export function getProposedEmailUpdates(): ProposedEmailUpdate[] {
  if (import.meta.env.PROD) {
    return [];
  }

  const existing = {
    byMessageId: new Map<string, string>(),
    byFingerprint: new Map<string, string>(),
  };
  const proposals: ProposedEmailUpdate[] = [];

  for (const fixture of EMAIL_FIXTURES) {
    const result = processInboundEmail(fixture, MULTI_VENDOR_MATCH_CONTEXT, existing);
    if (result.duplicate) continue;
    existing.byMessageId.set(fixture.sourceMessageId, fixture.sourceMessageId);
    existing.byFingerprint.set(contentFingerprint(fixture), fixture.sourceMessageId);

    if (result.reviewStatus === "rejected") continue;

    const labels = resolveMatchLabels(result.match, result.parsed, MULTI_VENDOR_MATCH_CONTEXT);
    const condition1 = describeCondition1Impact(result);

    proposals.push({
      messageId: fixture.sourceMessageId,
      subject: fixture.subject,
      senderEmail: fixture.senderEmail,
      receivedAt: fixture.receivedAt,
      classification: result.parsed.classification,
      poNumber: result.parsed.poNumbers[0] ?? null,
      vendorName: result.match.vendorId
        ? (vendorNameById.get(result.match.vendorId) ?? result.match.vendorId)
        : null,
      confidenceScore: result.match.confidenceScore,
      confidenceReason: result.match.confidenceReason,
      reviewStatus: result.reviewStatus,
      duplicate: result.duplicate,
      matchedJobNumber: labels.jobNumber,
      matchedPoLabel: labels.poLabel,
      matchedOrderLabel: labels.orderLabel,
      matchedDeliveryLabel: labels.deliveryLabel,
      matchedDeliveryOrderId: result.match.deliveryOrderId ?? null,
      itemLines: result.parsed.itemLines,
      bodyExcerpt: bodyExcerpt(fixture.bodyText),
      originalBody: fixture.bodyText,
      recipientEmails: fixture.recipientEmails,
      threadId: fixture.threadId,
      proposedOperationalMeaning: describeOperationalMeaning(
        result.parsed.classification,
        result.parsed,
      ),
      affectsCondition1: condition1.affectsCondition1,
      condition1ApprovalNote: condition1.note,
    });
  }

  return proposals.sort(
    (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
  );
}

/**
 * Delivery-scoped email evidence (Phase 5 read-only drawer).
 * Future parent-match strategy (Job rollup vs PO rollup) TBD — see docs/project_state.md.
 */
export function filterProposalsForDelivery(
  proposals: ProposedEmailUpdate[],
  delivery: Pick<DeliveryOrder, "id" | "orderNumber">,
  poNumber?: string | null,
): ProposedEmailUpdate[] {
  return proposals.filter((p) => {
    if (
      p.classification === "unable_to_match" ||
      p.classification === "needs_dispatcher_review"
    ) {
      return false;
    }
    if (p.matchedDeliveryOrderId && p.matchedDeliveryOrderId === delivery.id) {
      return true;
    }
    const orderMatch =
      p.matchedOrderLabel === delivery.orderNumber ||
      (p.matchedOrderLabel?.includes(delivery.orderNumber) ?? false);
    if (!orderMatch) return false;
    if (!poNumber) return true;
    return p.matchedPoLabel === poNumber || p.poNumber === poNumber;
  });
}
