/**
 * Lane C C1 — Invoice Review Chat callables (read/explain only).
 * Never mutates vendorInvoiceImports parse fields, deliveries, ignore rules, or playbooks.
 */
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { requireDispatcherAuth } from "./inboundEmail/dispatcherAuth";
import { ReviewChatRateLimitError } from "./invoice/reviewChat/reviewAgentRateLimit";
import { checkAndIncrementReviewChatRateLimit } from "./invoice/reviewChat/reviewAgentRateLimit";
import {
  ReviewAgentTurnInputError,
  runReviewAgentTurnCore,
} from "./invoice/reviewChat/runReviewAgentTurn";
import type { ReviewAgentTurnResult } from "./invoice/reviewChat/reviewAgentTypes";

function getDb() {
  return admin.firestore();
}

export const reviewAgentTurn = onCall(
  { region: "us-central1" },
  async (request): Promise<ReviewAgentTurnResult> => {
    const uid = await requireDispatcherAuth(request);
    const data = (request.data ?? {}) as {
      vendorInvoiceImportId?: unknown;
      message?: unknown;
    };
    const vendorInvoiceImportId =
      typeof data.vendorInvoiceImportId === "string"
        ? data.vendorInvoiceImportId.trim()
        : "";
    const message =
      typeof data.message === "string" ? data.message.trim() : "";
    if (!vendorInvoiceImportId || !message) {
      throw new HttpsError(
        "invalid-argument",
        "vendorInvoiceImportId and message are required.",
      );
    }

    try {
      await checkAndIncrementReviewChatRateLimit(getDb(), uid);
    } catch (err) {
      if (err instanceof ReviewChatRateLimitError) {
        throw new HttpsError("resource-exhausted", err.message);
      }
      throw err;
    }

    try {
      return await runReviewAgentTurnCore({
        db: getDb(),
        uid,
        vendorInvoiceImportId,
        message,
      });
    } catch (err) {
      if (err instanceof ReviewAgentTurnInputError) {
        throw new HttpsError("invalid-argument", err.message);
      }
      console.error("reviewAgentTurn failed:", err);
      throw new HttpsError(
        "internal",
        "Invoice Review Chat is temporarily unavailable.",
      );
    }
  },
);
