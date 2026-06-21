import { matchEmailToRecords, shouldAutoApplyVendorOrderComplete } from "./matchEmailToRecords";
import { contentFingerprint, parseVendorEmail } from "./parseVendorEmail";
import type { EmailProcessingResult, InboundEmailMessage } from "./types";
import type { MatchContext } from "./matchEmailToRecords";
import { EMAIL_AUTO_APPLY_CONFIDENCE } from "./types";

export interface ExistingEmailIndex {
  byMessageId: Map<string, string>;
  byFingerprint: Map<string, string>;
}

export function processInboundEmail(
  message: InboundEmailMessage,
  ctx: MatchContext,
  existing: ExistingEmailIndex,
): EmailProcessingResult {
  const parsed = parseVendorEmail(message);
  const fingerprint = contentFingerprint(message);
  const match = matchEmailToRecords(message, parsed, ctx);

  const duplicateOfMessage = existing.byMessageId.get(message.sourceMessageId);
  const duplicateOfFingerprint = existing.byFingerprint.get(fingerprint);
  const duplicate = Boolean(duplicateOfMessage || duplicateOfFingerprint);

  let reviewStatus: EmailProcessingResult["reviewStatus"] = "pending_review";
  if (duplicate) {
    reviewStatus = "rejected";
  } else if (parsed.classification === "irrelevant") {
    reviewStatus = "rejected";
  } else if (
    shouldAutoApplyVendorOrderComplete(parsed, match) &&
    match.confidenceScore >= EMAIL_AUTO_APPLY_CONFIDENCE
  ) {
    reviewStatus = "auto_processed";
  } else if (match.humanReviewRequired) {
    reviewStatus = "pending_review";
  }

  return {
    message,
    parsed,
    match,
    duplicate,
    duplicateOfEventId: duplicateOfMessage ?? duplicateOfFingerprint,
    reviewStatus,
  };
}

/** Condition 1 evidence only — readiness recalculation is a separate server step. */
export function buildVendorOrderCompletePatch(now: string): Record<string, unknown> {
  return {
    vendorOrderComplete: true,
    vendorOrderCompleteAt: now,
    vendorOrderCompleteSource: "vendor_email",
    updatedAt: now,
  };
}
