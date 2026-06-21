import type { EmailClassification } from "./types";
import type { ProposedEmailUpdate } from "./getProposedEmailUpdates";

const REASON_TOKEN_LABEL: Record<string, string> = {
  ambiguous_po_multiple_records: "Multiple PO records matched",
  ambiguous_order_number: "Multiple order numbers matched",
  ambiguous_job_number: "Multiple job numbers matched",
  unknown_sender_domain: "Unknown vendor",
  correction_to_earlier_email: "Correction to previous email",
  po_job_conflict: "PO and job number conflict",
  po_not_found: "PO number not found",
  same_vendor_multiple_open_pos: "Multiple open POs for same vendor",
  insufficient_signals: "Insufficient match signals",
  unable_to_match: "Could not match to job, PO, or delivery",
  needs_dispatcher_review: "Suspicious or unclear content",
};

const CLASSIFICATION_REVIEW_LABEL: Partial<Record<EmailClassification, string>> = {
  unable_to_match: "Could not match to job, PO, or delivery",
  needs_dispatcher_review: "Suspicious or unclear content",
  correction_to_earlier_email: "Correction to previous email",
};

/** Human-readable review reason — never "confidence low". */
export function getHumanReviewReason(proposal: ProposedEmailUpdate): string {
  const fromClass = CLASSIFICATION_REVIEW_LABEL[proposal.classification];
  if (fromClass) return fromClass;

  const tokens = proposal.confidenceReason.split(";").map((t) => t.trim());
  for (const token of tokens) {
    const label = REASON_TOKEN_LABEL[token];
    if (label) return label;
  }

  if (proposal.reviewStatus === "pending_review") {
    return "Requires dispatcher review";
  }
  return proposal.confidenceReason || "Requires dispatcher review";
}

/** Dashboard Needs Review strip — unmatched, ambiguous, corrections, conflicts, parser failures only. */
export function isNeedsReviewDashboardEmail(proposal: ProposedEmailUpdate): boolean {
  if (proposal.reviewStatus === "auto_processed") return false;

  if (
    proposal.classification === "unable_to_match" ||
    proposal.classification === "needs_dispatcher_review" ||
    proposal.classification === "correction_to_earlier_email"
  ) {
    return true;
  }

  const reason = proposal.confidenceReason.toLowerCase();
  const dashboardSignals = [
    "ambiguous_po",
    "ambiguous_order",
    "ambiguous_job",
    "unknown_sender",
    "po_job_conflict",
    "po_not_found",
    "same_vendor_multiple",
    "insufficient_signals",
  ];
  if (dashboardSignals.some((sig) => reason.includes(sig))) return true;

  const hasMatch =
    Boolean(proposal.matchedDeliveryOrderId) ||
    Boolean(proposal.matchedPoLabel && proposal.matchedOrderLabel);

  if (!hasMatch) return true;

  return false;
}

export function filterNeedsReviewEmails(
  proposals: ProposedEmailUpdate[],
): ProposedEmailUpdate[] {
  return proposals.filter(isNeedsReviewDashboardEmail);
}

export interface SvInterpretationLine {
  ok: boolean;
  label: string;
}

/** Compact SV interpretation bullets for drawer evidence cards. */
export function getSvInterpretation(proposal: ProposedEmailUpdate): SvInterpretationLine[] {
  const lines: SvInterpretationLine[] = [];

  if (
    proposal.classification === "vendor_order_complete" ||
    proposal.proposedOperationalMeaning.toLowerCase().includes("complete")
  ) {
    lines.push({ ok: true, label: "Order shipped complete" });
  }

  if (proposal.matchedPoLabel || proposal.poNumber) {
    lines.push({ ok: true, label: "Applies to PO" });
  }

  if (proposal.affectsCondition1) {
    if (proposal.reviewStatus === "auto_processed") {
      lines.push({ ok: true, label: "Condition 1 satisfied" });
    } else {
      lines.push({ ok: false, label: "Condition 1 pending review" });
    }
  }

  return lines;
}

export function proposalNeedsDrawerReview(proposal: ProposedEmailUpdate): boolean {
  if (proposal.reviewStatus === "pending_review" && proposal.affectsCondition1) {
    return true;
  }
  if (proposal.classification === "correction_to_earlier_email") {
    return true;
  }
  return isNeedsReviewDashboardEmail(proposal);
}
