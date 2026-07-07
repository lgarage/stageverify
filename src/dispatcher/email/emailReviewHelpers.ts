import type { EmailClassification } from "./types";
import type { ProposedEmailUpdate } from "./getProposedEmailUpdates";

/** First non-quoted reply lines for dispatcher preview (UI only). */
export function extractReplyPreview(bodyText: string, maxLen = 220): string {
  if (!bodyText.trim()) return "";

  const lines = bodyText.split(/\r?\n/);
  const replyLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (replyLines.length > 0) break;
      continue;
    }
    if (/^>/m.test(line)) break;
    if (/^On .+ wrote:$/i.test(trimmed)) break;
    if (/^-{2,}\s*Original Message/i.test(trimmed)) break;
    if (/^From:\s/i.test(trimmed) && replyLines.length > 0) break;
    replyLines.push(trimmed);
  }

  const joined = replyLines.join(" ").replace(/\s+/g, " ").trim();
  if (!joined) {
    const collapsed = bodyText.replace(/\s+/g, " ").trim();
    if (collapsed.length <= maxLen) return collapsed;
    return `${collapsed.slice(0, maxLen - 1)}…`;
  }
  if (joined.length <= maxLen) return joined;
  return `${joined.slice(0, maxLen - 1)}…`;
}

const REASON_TOKEN_LABEL: Record<string, string> = {
  ambiguous_po_multiple_records: "Multiple PO records matched",
  ambiguous_order_number: "Multiple order numbers matched",
  ambiguous_job_number: "Multiple job numbers matched",
  unknown_sender_domain: "Unknown sender or vendor domain",
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

export type EmailReviewDisplayTier =
  | "matched_vendor_reply"
  | "unmatched"
  | "ambiguous"
  | "spoof_conflict";

const SPOOF_CONFLICT_SIGNALS = [
  "spoofed_body_ref_failed_auth",
  "non_canonical_body_ref",
  "footer_ref_weak_match",
  "token_match_unknown_sender",
];

const AMBIGUOUS_SIGNALS = [
  "ambiguous_po",
  "ambiguous_order",
  "ambiguous_job",
  "unknown_sender",
  "po_job_conflict",
  "po_not_found",
  "same_vendor_multiple",
  "insufficient_signals",
  "references_match_requires_review",
  "thread_content_mismatch",
];

function reasonBlob(proposal: ProposedEmailUpdate): string {
  return [proposal.confidenceReason, proposal.applyConflictReason ?? ""]
    .join(";")
    .toLowerCase();
}

/** UI-only tier — maps ingest fields to calm vs caution copy. */
export function classifyEmailReviewDisplay(
  proposal: ProposedEmailUpdate,
): EmailReviewDisplayTier {
  const blob = reasonBlob(proposal);

  if (SPOOF_CONFLICT_SIGNALS.some((sig) => blob.includes(sig))) {
    return "spoof_conflict";
  }

  if (
    proposal.matchedBy === "bodyToken" &&
    (proposal.humanReviewRequired || blob.includes("footer_ref"))
  ) {
    return "spoof_conflict";
  }

  const unmatched =
    !proposal.matchedBy ||
    proposal.matchedBy === "none" ||
    proposal.classification === "unable_to_match";

  if (unmatched) {
    return "unmatched";
  }

  if (
    proposal.classification === "correction_to_earlier_email" ||
    AMBIGUOUS_SIGNALS.some((sig) => blob.includes(sig))
  ) {
    return "ambiguous";
  }

  return "matched_vendor_reply";
}

export interface EmailReviewHeadlines {
  primary: string;
  secondary: string;
  tier: EmailReviewDisplayTier;
}

/** Primary + secondary review labels for Needs Review / drawer evidence. */
export function getEmailReviewHeadlines(proposal: ProposedEmailUpdate): EmailReviewHeadlines {
  const tier = classifyEmailReviewDisplay(proposal);

  if (tier === "matched_vendor_reply") {
    return {
      tier,
      primary: "Vendor Reply — Needs Review",
      secondary:
        "Matched to an existing StageVerify email thread. Review before taking action.",
    };
  }

  if (tier === "spoof_conflict") {
    return {
      tier,
      primary: "Review Required — Suspicious or unclear content",
      secondary:
        "Reply may not belong to this thread. Verify sender and content before acting.",
    };
  }

  if (tier === "ambiguous") {
    return {
      tier,
      primary: `Review Required — ${getHumanReviewReason(proposal)}`,
      secondary: "Conflicting or ambiguous signals — confirm before taking action.",
    };
  }

  if (tier === "unmatched") {
    const reasonTokens = proposal.confidenceReason.split(";").map((t) => t.trim());
    const unknownDomain = reasonTokens.includes("unknown_sender_domain");
    const secondary = unknownDomain
      ? "Unknown sender or vendor domain. This email did not match an existing StageVerify thread. Review before taking action."
      : "This email did not match an existing StageVerify thread. Review before taking action.";
    return {
      tier,
      primary: "Unmatched Email — Needs Review",
      secondary,
    };
  }

  return {
    tier,
    primary: `Review Required — ${getHumanReviewReason(proposal)}`,
    secondary: "Could not confidently link this email to a delivery.",
  };
}

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

function normalizeReviewSubject(subject: string): string {
  return subject.replace(/^Subject:\s*/i, "").trim();
}

function normalizeReviewPreviewExcerpt(text: string): string {
  return text.replace(/^Body:\s*/i, "").trim();
}

/** Reply preview above raw email — sender metadata + first non-quoted lines. */
export function formatEmailReviewPreview(proposal: ProposedEmailUpdate): {
  sender: string;
  subject: string;
  receivedLabel: string;
  replyPreview: string;
} {
  let receivedLabel = proposal.receivedAt.slice(0, 10);
  try {
    receivedLabel = new Date(proposal.receivedAt).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    // keep date slice
  }

  const rawExcerpt = proposal.bodyExcerpt || proposal.originalBody;
  const cleanedExcerpt = normalizeReviewPreviewExcerpt(rawExcerpt);
  const replyPreview =
    normalizeReviewPreviewExcerpt(
      extractReplyPreview(cleanedExcerpt || rawExcerpt) || cleanedExcerpt,
    ) || "(No preview available)";

  return {
    sender: proposal.vendorName ?? proposal.senderEmail,
    subject: normalizeReviewSubject(proposal.subject),
    receivedLabel,
    replyPreview,
  };
}
