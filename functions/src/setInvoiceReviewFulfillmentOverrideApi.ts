/**
 * setInvoiceReviewFulfillmentOverride — Will-Call → Vendor Drop-Off human override.
 */
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { requireDispatcherAuth } from "./inboundEmail/dispatcherAuth";
import {
  FulfillmentOverrideInputError,
  runSetInvoiceReviewFulfillmentOverrideCore,
  type SetInvoiceReviewFulfillmentOverrideResult,
} from "./invoice/fulfillmentOverride/setFulfillmentOverrideCore";

function getDb() {
  return admin.firestore();
}

function mapError(err: FulfillmentOverrideInputError): HttpsError {
  if (err.code === "not-found") {
    return new HttpsError("not-found", err.message);
  }
  if (err.code === "failed-precondition") {
    const friendly: Record<string, string> = {
      import_not_pending_review:
        "Fulfillment override can only be applied while the invoice is pending review.",
      fulfillment_override_requires_will_call:
        "Assign Location override applies only to Will-Call / Pickup @ Vendor imports.",
    };
    return new HttpsError(
      "failed-precondition",
      friendly[err.message] ?? err.message,
    );
  }
  return new HttpsError("invalid-argument", err.message);
}

export const setInvoiceReviewFulfillmentOverride = onCall(
  { region: "us-central1" },
  async (request): Promise<SetInvoiceReviewFulfillmentOverrideResult> => {
    const uid = await requireDispatcherAuth(request);
    const data = (request.data ?? {}) as {
      vendorInvoiceImportId?: unknown;
      toFulfillmentMethod?: unknown;
      idempotencyKey?: unknown;
    };

    const vendorInvoiceImportId =
      typeof data.vendorInvoiceImportId === "string"
        ? data.vendorInvoiceImportId.trim()
        : "";
    const toFulfillmentMethod =
      typeof data.toFulfillmentMethod === "string"
        ? data.toFulfillmentMethod.trim()
        : "";
    const idempotencyKey =
      typeof data.idempotencyKey === "string" ? data.idempotencyKey.trim() : "";

    if (!vendorInvoiceImportId || !idempotencyKey) {
      throw new HttpsError(
        "invalid-argument",
        "vendorInvoiceImportId and idempotencyKey are required.",
      );
    }
    if (toFulfillmentMethod !== "delivery") {
      throw new HttpsError(
        "invalid-argument",
        "toFulfillmentMethod must be delivery.",
      );
    }

    try {
      return await runSetInvoiceReviewFulfillmentOverrideCore({
        db: getDb(),
        uid,
        vendorInvoiceImportId,
        toFulfillmentMethod: "delivery",
        idempotencyKey,
      });
    } catch (err) {
      if (err instanceof FulfillmentOverrideInputError) {
        throw mapError(err);
      }
      console.error("setInvoiceReviewFulfillmentOverride failed:", err);
      throw new HttpsError(
        "internal",
        "Could not apply fulfillment override right now.",
      );
    }
  },
);
