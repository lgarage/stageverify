import type { DeliveryOrder, Item } from "../models";
import { computeDeliveryReadiness } from "../readiness";
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

/** Apply high-confidence vendor-order-complete email evidence to delivery fields (server-side only). */
export function buildVendorOrderCompletePatch(
  delivery: DeliveryOrder,
  items: Item[],
  now: string,
): Partial<DeliveryOrder> {
  const readiness = computeDeliveryReadiness(
    {
      ...delivery,
      vendorOrderComplete: true,
      vendorOrderCompleteAt: now,
      vendorOrderCompleteSource: "vendor_email",
    },
    items,
  );
  return {
    vendorOrderComplete: true,
    vendorOrderCompleteAt: now,
    vendorOrderCompleteSource: "vendor_email",
    physicalDropoffComplete: readiness.evidence.physicalDropoffComplete,
    physicalDropoffCompleteAt: readiness.evidence.physicalDropoffComplete
      ? delivery.physicalDropoffCompleteAt ?? now
      : undefined,
    stagingAssignmentComplete: readiness.evidence.stagingAssignmentComplete,
    readinessStatus: readiness.readinessStatus,
    status: readiness.deliveryStatus,
    readinessBlockReasons: readiness.evidence.readinessBlockReasons,
    updatedAt: now,
  };
}
