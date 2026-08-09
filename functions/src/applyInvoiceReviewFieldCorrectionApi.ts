/**
 * Lane C C2 — applyInvoiceReviewFieldCorrection callable.
 * Mutates only vendorInvoiceImports.parsedHeader.<allowlisted field> + audit.
 */
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { requireDispatcherAuth } from "./inboundEmail/dispatcherAuth";
import {
  ApplyCorrectionInputError,
  runApplyInvoiceReviewFieldCorrectionCore,
  type ApplyCorrectionTriggerMode,
  type ApplyInvoiceReviewFieldCorrectionResult,
} from "./invoice/reviewChat/applyInvoiceReviewFieldCorrection";

function getDb() {
  return admin.firestore();
}

function mapApplyError(err: ApplyCorrectionInputError): HttpsError {
  if (err.code === "not-found") {
    return new HttpsError("not-found", err.message);
  }
  if (err.code === "permission-denied") {
    return new HttpsError("permission-denied", err.message);
  }
  if (err.code === "failed-precondition") {
    const friendly: Record<string, string> = {
      expected_current_value_stale:
        "The parsed value changed since this correction was proposed. Ask the agent to re-check, then apply again.",
      not_independently_verifiable:
        "I can't apply that value — it isn't in the invoice text and you haven't typed it exactly. Type the exact value in chat, then apply.",
      import_not_pending_review:
        "Corrections can only be applied while the invoice is still pending review.",
      field_not_allowed: "That field cannot be corrected via chat.",
      correction_no_longer_current:
        "This correction proposal is no longer current.",
    };
    return new HttpsError(
      "failed-precondition",
      friendly[err.message] ?? err.message,
    );
  }
  return new HttpsError("invalid-argument", err.message);
}

export const applyInvoiceReviewFieldCorrection = onCall(
  { region: "us-central1" },
  async (request): Promise<ApplyInvoiceReviewFieldCorrectionResult> => {
    const uid = await requireDispatcherAuth(request);
    const data = (request.data ?? {}) as {
      vendorInvoiceImportId?: unknown;
      sourceMessageId?: unknown;
      idempotencyKey?: unknown;
      triggerMode?: unknown;
    };
    const vendorInvoiceImportId =
      typeof data.vendorInvoiceImportId === "string"
        ? data.vendorInvoiceImportId.trim()
        : "";
    const sourceMessageId =
      typeof data.sourceMessageId === "string"
        ? data.sourceMessageId.trim()
        : "";
    const idempotencyKey =
      typeof data.idempotencyKey === "string"
        ? data.idempotencyKey.trim()
        : "";
    const triggerModeRaw =
      typeof data.triggerMode === "string" ? data.triggerMode.trim() : "";
    const triggerMode: ApplyCorrectionTriggerMode | undefined =
      triggerModeRaw === "apply_button" ||
      triggerModeRaw === "chat_direct_command" ||
      triggerModeRaw === "chat_confirmation"
        ? triggerModeRaw
        : undefined;

    if (!vendorInvoiceImportId || !sourceMessageId || !idempotencyKey) {
      throw new HttpsError(
        "invalid-argument",
        "vendorInvoiceImportId, sourceMessageId, and idempotencyKey are required.",
      );
    }

    try {
      return await runApplyInvoiceReviewFieldCorrectionCore({
        db: getDb(),
        uid,
        vendorInvoiceImportId,
        sourceMessageId,
        idempotencyKey,
        triggerMode,
      });
    } catch (err) {
      if (err instanceof ApplyCorrectionInputError) {
        throw mapApplyError(err);
      }
      console.error("applyInvoiceReviewFieldCorrection failed:", err);
      throw new HttpsError(
        "internal",
        "Could not apply the correction right now.",
      );
    }
  },
);
