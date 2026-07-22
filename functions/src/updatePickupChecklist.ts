import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { assertPickupAccessForJob } from "./pickupAccessValidation";

function getDb() {
  return admin.firestore();
}

const MAX_ITEMS_PER_DELIVERY = 500;
const MAX_ITEM_ID_LEN = 128;

interface UpdatePickupChecklistRequest {
  deliveryOrderId?: string;
  jobId?: string;
  pickupCheckedItemIds?: string[];
  pickupToken?: string;
  technicianSessionToken?: string;
}

interface DeliveryRecord {
  jobId: string;
  status: string;
}

function asNonEmptyString(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLen) return null;
  return trimmed;
}

function asItemIdArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > MAX_ITEMS_PER_DELIVERY) return null;
  const out: string[] = [];
  for (const entry of value) {
    const parsed = asNonEmptyString(entry, MAX_ITEM_ID_LEN);
    if (!parsed) return null;
    out.push(parsed);
  }
  return out;
}

function checklistEligibleStatus(status: string): boolean {
  return status === "ready_for_pickup" || status === "complete";
}

export const updatePickupChecklist = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const data = (request.data ?? {}) as UpdatePickupChecklistRequest;

    const deliveryOrderId = asNonEmptyString(data.deliveryOrderId, 128);
    const jobId = asNonEmptyString(data.jobId, 128);
    const pickupCheckedItemIds = asItemIdArray(data.pickupCheckedItemIds);

    if (
      !deliveryOrderId ||
      !jobId ||
      pickupCheckedItemIds === null ||
      (!data.pickupToken && !data.technicianSessionToken)
    ) {
      throw new HttpsError(
        "invalid-argument",
        "deliveryOrderId, jobId, pickupCheckedItemIds, and pickup credentials are required.",
      );
    }

    const db = getDb();
    await assertPickupAccessForJob(db, jobId, {
      pickupToken: data.pickupToken,
      technicianSessionToken: data.technicianSessionToken,
    });

    return db.runTransaction(async (tx) => {
      const deliveryRef = db.collection("deliveries").doc(deliveryOrderId);
      const deliverySnap = await tx.get(deliveryRef);
      if (!deliverySnap.exists) {
        throw new HttpsError("not-found", "Delivery not found.");
      }

      const delivery = deliverySnap.data() as DeliveryRecord;
      if (delivery.jobId !== jobId) {
        throw new HttpsError(
          "permission-denied",
          "Delivery does not belong to this job.",
        );
      }

      if (!checklistEligibleStatus(delivery.status)) {
        throw new HttpsError(
          "failed-precondition",
          "Delivery is not open for pickup checklist updates.",
        );
      }

      const itemsSnap = await tx.get(
        db
          .collection("items")
          .where("deliveryOrderId", "==", deliveryOrderId)
          .limit(MAX_ITEMS_PER_DELIVERY + 1),
      );
      if (itemsSnap.size > MAX_ITEMS_PER_DELIVERY) {
        throw new HttpsError(
          "failed-precondition",
          "Delivery has too many line items for pickup checklist.",
        );
      }

      const validItemIds = new Set(itemsSnap.docs.map((doc) => doc.id));
      for (const itemId of pickupCheckedItemIds) {
        if (!validItemIds.has(itemId)) {
          throw new HttpsError(
            "invalid-argument",
            "pickupCheckedItemIds contains an item not on this delivery.",
          );
        }
      }

      const now = new Date().toISOString();
      tx.update(deliveryRef, {
        pickupCheckedItemIds,
        updatedAt: now,
      });

      return {
        pickupCheckedItemIds,
      };
    });
  },
);
