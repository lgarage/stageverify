import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { applyDeliveryReadinessTransaction } from "./applyDeliveryReadiness";
import type { ItemDoc } from "./deliveryReadiness";
import { hasVendorOrderCompleteApplyConflict } from "./email/applyConflicts";
import {
  loadEmailMatchContext,
  loadExistingEmailIndex,
  resolveTargetDeliveryId,
} from "./email/loadMatchContext";
import {
  buildVendorOrderCompletePatch,
  processInboundEmail,
} from "./email/processEmailMessage";
import { contentFingerprint } from "./email/parseVendorEmail";
import type { InboundEmailMessage } from "./email/types";

function getDb() {
  return admin.firestore();
}

/** Firestore rejects explicit undefined field values in documents. */
function omitUndefined(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function vendorEmailEventForWrite(event: object): Record<string, unknown> {
  return omitUndefined(event as Record<string, unknown>);
}

const MAX_EMAIL_FIELD_LEN = 4096;
const MAX_MESSAGE_ID_LEN = 256;

function asInboundEmailMessage(data: unknown): InboundEmailMessage {
  if (!data || typeof data !== "object") {
    throw new HttpsError("invalid-argument", "message payload is required.");
  }
  const raw = data as Record<string, unknown>;
  const sourceMessageId =
    typeof raw.sourceMessageId === "string" ? raw.sourceMessageId.trim() : "";
  const senderEmail =
    typeof raw.senderEmail === "string" ? raw.senderEmail.trim().toLowerCase() : "";
  const subject = typeof raw.subject === "string" ? raw.subject.trim() : "";
  const bodyText = typeof raw.bodyText === "string" ? raw.bodyText : "";
  const receivedAt =
    typeof raw.receivedAt === "string" ? raw.receivedAt.trim() : "";

  if (
    !sourceMessageId ||
    sourceMessageId.length > MAX_MESSAGE_ID_LEN ||
    !senderEmail ||
    senderEmail.length > 320 ||
    !subject ||
    subject.length > MAX_EMAIL_FIELD_LEN ||
    !bodyText ||
    bodyText.length > MAX_EMAIL_FIELD_LEN ||
    !receivedAt
  ) {
    throw new HttpsError("invalid-argument", "Invalid inbound email message.");
  }

  const recipientEmails = Array.isArray(raw.recipientEmails)
    ? raw.recipientEmails
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .slice(0, 20)
    : [];

  return {
    sourceMessageId,
    threadId:
      typeof raw.threadId === "string" && raw.threadId.length <= MAX_MESSAGE_ID_LEN
        ? raw.threadId.trim()
        : undefined,
    senderEmail,
    recipientEmails,
    subject,
    bodyText,
    receivedAt,
  };
}

interface VendorEmailEventDoc {
  id: string;
  sourceMessageId: string;
  threadId?: string;
  contentFingerprint: string;
  direction?: "inbound" | "outbound";
  communicationPurpose?:
    | "vendor_order_update"
    | "need_more_information"
    | "issue_resolution"
    | "general"
    | "unknown";
  materialIssueId?: string;
  senderEmail: string;
  recipientEmails?: string[];
  subject: string;
  receivedAt: string;
  vendorId?: string;
  jobId?: string;
  deliveryOrderId?: string;
  purchaseOrderId?: string;
  proposedPoNumber?: string;
  proposedOrderNumber?: string;
  proposedJobNumber?: string;
  emailClassification?: string;
  confidenceScore?: number;
  confidenceReason?: string;
  humanReviewRequired?: boolean;
  reviewStatus: "pending_review" | "approved" | "rejected" | "auto_processed";
  duplicateOfEventId?: string;
  applyConflictReason?: string;
  appliedAt?: string;
  sentBy?: string;
  sentAt?: string;
  bodyExcerpt?: string;
  provider?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Server-only Phase 5 write path: high-confidence vendor_order_complete auto-apply.
 * Requires Firebase Auth (dispatcher). No client Firestore writes to delivery evidence.
 */
export const processInboundVendorEmail = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError(
        "permission-denied",
        "Dispatcher sign-in required for email ingestion.",
      );
    }

    const message = asInboundEmailMessage(
      (request.data as { message?: unknown } | undefined)?.message,
    );
    const fingerprint = contentFingerprint(message);
    const now = new Date().toISOString();
    const ctx = await loadEmailMatchContext();
    const existing = await loadExistingEmailIndex();
    const result = processInboundEmail(message, ctx, existing);

    const eventId = `vee-${crypto.randomUUID()}`;
    const baseEvent: VendorEmailEventDoc = {
      id: eventId,
      sourceMessageId: message.sourceMessageId,
      threadId: message.threadId,
      contentFingerprint: fingerprint,
      direction: "inbound",
      communicationPurpose: "vendor_order_update",
      senderEmail: message.senderEmail,
      recipientEmails: message.recipientEmails,
      subject: message.subject,
      receivedAt: message.receivedAt,
      vendorId: result.match.vendorId,
      jobId: result.match.jobId,
      deliveryOrderId: result.match.deliveryOrderId,
      purchaseOrderId: result.match.purchaseOrderId,
      proposedPoNumber: result.parsed.poNumbers[0],
      proposedOrderNumber: result.parsed.orderNumbers[0],
      proposedJobNumber: result.parsed.jobNumbers[0],
      emailClassification: result.parsed.classification,
      confidenceScore: result.match.confidenceScore,
      confidenceReason: result.match.confidenceReason,
      humanReviewRequired: result.match.humanReviewRequired,
      reviewStatus:
        result.reviewStatus === "auto_processed"
          ? "auto_processed"
          : result.duplicate
            ? "rejected"
            : "pending_review",
      duplicateOfEventId: result.duplicateOfEventId,
      createdAt: now,
      updatedAt: now,
    };

    if (result.duplicate) {
      await getDb()
        .collection("vendorEmailEvents")
        .doc(eventId)
        .set(vendorEmailEventForWrite(baseEvent));
      return {
        eventId,
        reviewStatus: "rejected",
        duplicate: true,
        duplicateOfEventId: result.duplicateOfEventId,
        autoApplied: false,
      };
    }

    if (result.reviewStatus !== "auto_processed") {
      await getDb()
        .collection("vendorEmailEvents")
        .doc(eventId)
        .set(vendorEmailEventForWrite(baseEvent));
      return {
        eventId,
        reviewStatus: result.reviewStatus,
        duplicate: false,
        autoApplied: false,
        confidenceScore: result.match.confidenceScore,
        classification: result.parsed.classification,
      };
    }

    const deliveryOrderId = resolveTargetDeliveryId(result.match, ctx);
    if (!deliveryOrderId) {
      const pendingEvent = {
        ...baseEvent,
        reviewStatus: "pending_review" as const,
        humanReviewRequired: true,
        applyConflictReason: "ambiguous_delivery_target",
      };
      await getDb()
        .collection("vendorEmailEvents")
        .doc(eventId)
        .set(vendorEmailEventForWrite(pendingEvent));
      return {
        eventId,
        reviewStatus: "pending_review",
        duplicate: false,
        autoApplied: false,
        applyConflictReason: "ambiguous_delivery_target",
      };
    }

    const deliveryRef = getDb().collection("deliveries").doc(deliveryOrderId);
    const deliverySnap = await deliveryRef.get();
    if (!deliverySnap.exists) {
      throw new HttpsError("not-found", "Matched delivery not found.");
    }

    const deliveryData = deliverySnap.data() as Record<string, unknown>;
    if (
      deliveryData.vendorOrderComplete === true &&
      deliveryData.vendorOrderCompleteSource === "vendor_email"
    ) {
      const idempotentEvent = {
        ...baseEvent,
        deliveryOrderId,
        reviewStatus: "auto_processed" as const,
        appliedAt: now,
      };
      await getDb()
        .collection("vendorEmailEvents")
        .doc(eventId)
        .set(vendorEmailEventForWrite(idempotentEvent));
      return {
        eventId,
        deliveryOrderId,
        reviewStatus: "auto_processed",
        duplicate: false,
        autoApplied: false,
        idempotent: true,
        vendorOrderComplete: true,
      };
    }

    const itemsSnap = await getDb()
      .collection("items")
      .where("deliveryOrderId", "==", deliveryOrderId)
      .limit(501)
      .get();
    if (itemsSnap.empty) {
      throw new HttpsError("failed-precondition", "Delivery has no line items.");
    }
    if (itemsSnap.size > 500) {
      throw new HttpsError(
        "failed-precondition",
        "Delivery has too many line items for email apply.",
      );
    }

    const items = itemsSnap.docs.map((doc) => doc.data() as ItemDoc);
    const conflictReason = hasVendorOrderCompleteApplyConflict(
      {
        vendorPhysicalDropoffConfirmed:
          deliveryData.vendorPhysicalDropoffConfirmed === true,
        vendorOrderComplete: deliveryData.vendorOrderComplete === true,
        vendorOrderCompleteSource:
          typeof deliveryData.vendorOrderCompleteSource === "string"
            ? deliveryData.vendorOrderCompleteSource
            : undefined,
      },
      items,
      result.parsed,
    );

    if (conflictReason) {
      const conflictEvent = {
        ...baseEvent,
        deliveryOrderId,
        reviewStatus: "pending_review" as const,
        humanReviewRequired: true,
        applyConflictReason: conflictReason,
      };
      await getDb()
        .collection("vendorEmailEvents")
        .doc(eventId)
        .set(vendorEmailEventForWrite(conflictEvent));
      return {
        eventId,
        deliveryOrderId,
        reviewStatus: "pending_review",
        duplicate: false,
        autoApplied: false,
        applyConflictReason: conflictReason,
      };
    }

    const patch = {
      ...buildVendorOrderCompletePatch(now),
      vendorOrderCompleteConfidence: result.match.confidenceScore,
    };

    await getDb().runTransaction(async (tx) => {
      const freshSnap = await tx.get(deliveryRef);
      if (!freshSnap.exists) {
        throw new HttpsError("not-found", "Matched delivery not found.");
      }
      const fresh = freshSnap.data() as Record<string, unknown>;
      if (
        fresh.vendorOrderComplete === true &&
        fresh.vendorOrderCompleteSource === "vendor_email"
      ) {
        throw new HttpsError(
          "already-exists",
          "Vendor order complete already applied from email.",
        );
      }
      const freshConflict = hasVendorOrderCompleteApplyConflict(
        {
          vendorPhysicalDropoffConfirmed:
            fresh.vendorPhysicalDropoffConfirmed === true,
          vendorOrderComplete: fresh.vendorOrderComplete === true,
          vendorOrderCompleteSource:
            typeof fresh.vendorOrderCompleteSource === "string"
              ? fresh.vendorOrderCompleteSource
              : undefined,
        },
        items,
        result.parsed,
      );
      if (freshConflict) {
        throw new HttpsError(
          "failed-precondition",
          `Apply conflict: ${freshConflict}`,
        );
      }
      tx.update(deliveryRef, patch);
      tx.set(
        getDb().collection("vendorEmailEvents").doc(eventId),
        vendorEmailEventForWrite({
          ...baseEvent,
          deliveryOrderId,
          reviewStatus: "auto_processed",
          appliedAt: now,
        }),
      );
    });

    const readiness = await applyDeliveryReadinessTransaction(
      getDb(),
      deliveryOrderId,
      { historyReason: "Vendor email Condition 1 auto-apply readiness recalculation" },
    );

    return {
      eventId,
      deliveryOrderId,
      reviewStatus: "auto_processed",
      duplicate: false,
      autoApplied: true,
      vendorOrderComplete: true,
      vendorOrderCompleteConfidence: result.match.confidenceScore,
      readyForPickup: readiness.readyForPickup,
      readinessStatus: readiness.readinessStatus,
      deliveryStatus: readiness.deliveryStatus,
    };
  },
);
