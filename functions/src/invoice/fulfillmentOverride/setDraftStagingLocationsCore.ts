/**
 * Invoice Review — draft planned staging locations (pending_review only; no occupancy claim).
 */
import type { Firestore } from "firebase-admin/firestore";
import type { VendorInvoiceImportDoc } from "../../inboundEmail/types";
import { sanitizePlannedStagingLocationIds } from "./sharedStagingIdSanitize";

const REVIEW_COLLECTION = "vendorInvoiceImports";

export class DraftStagingLocationsInputError extends Error {
  code:
    | "invalid-argument"
    | "not-found"
    | "failed-precondition";
  constructor(code: DraftStagingLocationsInputError["code"], message: string) {
    super(message);
    this.name = "DraftStagingLocationsInputError";
    this.code = code;
  }
}

export type SetInvoiceReviewDraftStagingLocationsResult = {
  vendorInvoiceImportId: string;
  draftPlannedStagingLocationIds: string[];
  reviewStatus: string;
};

function isoNow(): string {
  return new Date().toISOString();
}

export async function runSetInvoiceReviewDraftStagingLocationsCore(input: {
  db: Firestore;
  uid: string;
  vendorInvoiceImportId: string;
  stagingLocationIds: string[];
}): Promise<SetInvoiceReviewDraftStagingLocationsResult> {
  void input.uid;
  const importId = input.vendorInvoiceImportId.trim();
  if (!importId || importId.length > 256) {
    throw new DraftStagingLocationsInputError(
      "invalid-argument",
      "Invalid vendorInvoiceImportId.",
    );
  }

  const sanitized = sanitizePlannedStagingLocationIds(input.stagingLocationIds);

  const importRef = input.db.collection(REVIEW_COLLECTION).doc(importId);
  const importSnap = await importRef.get();
  if (!importSnap.exists) {
    throw new DraftStagingLocationsInputError("not-found", "Invoice import not found.");
  }

  const importDoc = importSnap.data() as VendorInvoiceImportDoc;
  if (importDoc.reviewStatus !== "pending_review") {
    throw new DraftStagingLocationsInputError(
      "failed-precondition",
      "import_not_pending_review",
    );
  }

  if (sanitized.length > 0) {
    const locSnaps = await Promise.all(
      sanitized.map((id) =>
        input.db.collection("stagingLocations").doc(id).get(),
      ),
    );
    if (locSnaps.some((snap) => !snap.exists)) {
      throw new DraftStagingLocationsInputError(
        "invalid-argument",
        "One or more selected staging locations no longer exist. Refresh and reselect.",
      );
    }
  }

  const now = isoNow();
  await importRef.update({
    draftPlannedStagingLocationIds: sanitized,
    updatedAt: now,
  });

  return {
    vendorInvoiceImportId: importId,
    draftPlannedStagingLocationIds: sanitized,
    reviewStatus: importDoc.reviewStatus,
  };
}
