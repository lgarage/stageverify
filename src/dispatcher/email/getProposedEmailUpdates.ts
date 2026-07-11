import type { DeliveryOrder, VendorEmailEvent } from "../models";
import type { EmailClassification, EmailProcessingResult } from "./types";
import { bodyExcerpt } from "./proposedEmailDetail";

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
  /** Live match target — filter drawer evidence by delivery.id or order+PO. */
  matchedDeliveryOrderId: string | null;
  itemLines: Array<{ description: string; qty?: number }>;
  bodyExcerpt: string;
  /** Full original body — shown only after View Original Email. */
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

/** Map live Firestore vendor email events to drawer/readiness proposal rows. */
export function vendorEmailEventToProposal(event: VendorEmailEvent): ProposedEmailUpdate {
  const originalBody = event.bodyText ?? event.bodyExcerpt ?? "";
  return {
    messageId: event.sourceMessageId,
    subject: event.subject,
    senderEmail: event.senderEmail,
    receivedAt: event.receivedAt,
    classification: (event.emailClassification ??
      "needs_dispatcher_review") as ProposedEmailUpdate["classification"],
    poNumber: event.proposedPoNumber ?? null,
    vendorName: null,
    confidenceScore: event.confidenceScore ?? 0,
    confidenceReason: event.confidenceReason ?? event.applyConflictReason ?? "pending_review",
    reviewStatus: "pending_review",
    duplicate: false,
    matchedJobNumber: event.proposedJobNumber ?? null,
    matchedPoLabel: event.proposedPoNumber ?? null,
    matchedOrderLabel: event.proposedOrderNumber ?? null,
    matchedDeliveryLabel: event.deliveryOrderId ?? null,
    matchedDeliveryOrderId: event.deliveryOrderId ?? null,
    itemLines: [],
    bodyExcerpt: event.bodyExcerpt ?? bodyExcerpt(originalBody),
    originalBody,
    recipientEmails: event.recipientEmails ?? [],
    threadId: event.threadId,
    proposedOperationalMeaning:
      event.matchedBy && event.matchedBy !== "none"
        ? "Matched vendor reply — dispatcher confirm required"
        : "Unmatched inbound reply",
    affectsCondition1: false,
    condition1ApprovalNote: "",
    matchedBy: event.matchedBy,
    humanReviewRequired: event.humanReviewRequired,
    applyConflictReason: event.applyConflictReason,
  };
}

export function inboundVendorEventsToProposals(
  events: readonly VendorEmailEvent[],
): ProposedEmailUpdate[] {
  return events
    .filter((event) => event.direction === "inbound" || !event.direction)
    .map(vendorEmailEventToProposal)
    .sort(
      (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
    );
}

/**
 * Offline fixture proposals removed — dispatcher UI uses live VendorEmailEvent
 * and vendorInvoiceImports (invoice review queue) only.
 */
export function getProposedEmailUpdates(): ProposedEmailUpdate[] {
  return [];
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
