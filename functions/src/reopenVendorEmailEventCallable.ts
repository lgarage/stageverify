/**
 * Callable: reopen (undo dismiss) one rejected inbound vendorEmailEvent for Needs Review.
 */
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { requireDispatcherAuth } from "./inboundEmail/dispatcherAuth";

function getDb() {
  return admin.firestore();
}

export const reopenVendorEmailEventCallable = onCall(
  { region: "us-central1" },
  async (request) => {
    await requireDispatcherAuth(request);
    const data = (request.data ?? {}) as { vendorEmailEventId?: string };
    const eventId =
      typeof data.vendorEmailEventId === "string"
        ? data.vendorEmailEventId.trim()
        : "";
    if (!eventId || eventId.length > 256) {
      throw new HttpsError("invalid-argument", "vendorEmailEventId is required.");
    }

    const ref = getDb().collection("vendorEmailEvents").doc(eventId);
    const now = new Date().toISOString();

    await getDb().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new HttpsError("not-found", "Vendor email event not found.");
      }

      const row = snap.data() as {
        reviewStatus?: string;
        direction?: string;
      };

      if (row.reviewStatus !== "rejected") {
        throw new HttpsError(
          "failed-precondition",
          "Only rejected events can be reopened.",
        );
      }

      const direction = row.direction ?? "inbound";
      if (direction !== "inbound") {
        throw new HttpsError(
          "failed-precondition",
          "Only inbound events can be reopened in Needs Review.",
        );
      }

      tx.update(ref, {
        reviewStatus: "pending_review",
        rejectedAt: FieldValue.delete(),
        rejectedBy: FieldValue.delete(),
        updatedAt: now,
      });
    });

    return {
      ok: true,
      vendorEmailEventId: eventId,
      reviewStatus: "pending_review" as const,
    };
  },
);
