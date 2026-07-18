/**
 * Callable: dismiss (reject) one pending inbound vendorEmailEvent from Needs Review.
 */
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { requireDispatcherAuth } from "./inboundEmail/dispatcherAuth";

function getDb() {
  return admin.firestore();
}

export const dismissVendorEmailEventCallable = onCall(
  { region: "us-central1" },
  async (request) => {
    const uid = await requireDispatcherAuth(request);
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

      if (row.reviewStatus !== "pending_review") {
        throw new HttpsError(
          "failed-precondition",
          "Only pending_review events can be dismissed.",
        );
      }

      const direction = row.direction ?? "inbound";
      if (direction !== "inbound") {
        throw new HttpsError(
          "failed-precondition",
          "Only inbound events can be dismissed from Needs Review.",
        );
      }

      tx.update(ref, {
        reviewStatus: "rejected",
        rejectedAt: now,
        rejectedBy: uid,
        updatedAt: now,
      });
    });

    return {
      ok: true,
      vendorEmailEventId: eventId,
      reviewStatus: "rejected" as const,
    };
  },
);
