/**
 * setInvoiceReviewDraftStagingLocations — persist draft staging picks on pending imports.
 */
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { requireDispatcherAuth } from "./inboundEmail/dispatcherAuth";
import {
  DraftStagingLocationsInputError,
  runSetInvoiceReviewDraftStagingLocationsCore,
  type SetInvoiceReviewDraftStagingLocationsResult,
} from "./invoice/fulfillmentOverride/setDraftStagingLocationsCore";

function getDb() {
  return admin.firestore();
}

function mapError(err: DraftStagingLocationsInputError): HttpsError {
  if (err.code === "not-found") {
    return new HttpsError("not-found", err.message);
  }
  if (err.code === "failed-precondition") {
    return new HttpsError("failed-precondition", err.message);
  }
  return new HttpsError("invalid-argument", err.message);
}

export const setInvoiceReviewDraftStagingLocations = onCall(
  { region: "us-central1" },
  async (request): Promise<SetInvoiceReviewDraftStagingLocationsResult> => {
    const uid = await requireDispatcherAuth(request);
    const data = (request.data ?? {}) as {
      vendorInvoiceImportId?: unknown;
      stagingLocationIds?: unknown;
    };

    const vendorInvoiceImportId =
      typeof data.vendorInvoiceImportId === "string"
        ? data.vendorInvoiceImportId.trim()
        : "";
    const stagingLocationIds = Array.isArray(data.stagingLocationIds)
      ? (data.stagingLocationIds as string[])
      : data.stagingLocationIds === undefined
        ? []
        : null;

    if (!vendorInvoiceImportId) {
      throw new HttpsError("invalid-argument", "vendorInvoiceImportId is required.");
    }
    if (stagingLocationIds === null) {
      throw new HttpsError(
        "invalid-argument",
        "stagingLocationIds must be an array (use [] to clear).",
      );
    }

    try {
      return await runSetInvoiceReviewDraftStagingLocationsCore({
        db: getDb(),
        uid,
        vendorInvoiceImportId,
        stagingLocationIds,
      });
    } catch (err) {
      if (err instanceof DraftStagingLocationsInputError) {
        throw mapError(err);
      }
      console.error("setInvoiceReviewDraftStagingLocations failed:", err);
      throw new HttpsError(
        "internal",
        "Could not save draft staging locations right now.",
      );
    }
  },
);
