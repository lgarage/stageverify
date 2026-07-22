import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { assertPickupAccessForJob } from "./pickupAccessValidation";
import { hydratePublicDeliveryDetails } from "./deliveryDetailsResponse";

function getDb() {
  return admin.firestore();
}

interface MarkPickupDeliveryInstalledRequest {
  deliveryId?: string;
  jobId?: string;
  pickupToken?: string;
  technicianSessionToken?: string;
}

function asJobId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : null;
}

function asDeliveryId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : null;
}

/** Token-gated installed transition from pickup portal. */
export const markPickupDeliveryInstalled = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const data = (request.data ?? {}) as MarkPickupDeliveryInstalledRequest;
    const deliveryId = asDeliveryId(data.deliveryId);
    const jobId = asJobId(data.jobId);

    if (
      !deliveryId ||
      !jobId ||
      (!data.pickupToken && !data.technicianSessionToken)
    ) {
      throw new HttpsError("invalid-argument", "Invalid pickup link.");
    }

    const db = getDb();
    await assertPickupAccessForJob(db, jobId, {
      pickupToken: data.pickupToken,
      technicianSessionToken: data.technicianSessionToken,
    });

    const deliveryRef = db.collection("deliveries").doc(deliveryId);
    const deliverySnap = await deliveryRef.get();
    if (!deliverySnap.exists) {
      throw new HttpsError("not-found", "Delivery not found.");
    }
    const delivery = deliverySnap.data() as admin.firestore.DocumentData;
    if (String(delivery.jobId ?? "") !== jobId) {
      throw new HttpsError(
        "permission-denied",
        "Pickup link does not match this delivery.",
      );
    }
    if (delivery.status !== "picked_up") {
      throw new HttpsError(
        "failed-precondition",
        "Delivery must be picked up before marking installed.",
      );
    }

    const itemsSnap = await db
      .collection("items")
      .where("deliveryOrderId", "==", deliveryId)
      .get();
    const now = new Date().toISOString();
    const eventId = `event-${crypto.randomUUID()}`;
    const batch = db.batch();

    batch.update(deliveryRef, {
      status: "installed",
      updatedAt: now,
    });

    for (const itemDoc of itemsSnap.docs) {
      const item = itemDoc.data();
      if (item.status === "received") {
        batch.update(itemDoc.ref, { status: "installed" });
      }
    }

    batch.set(db.collection("statusHistory").doc(eventId), {
      id: eventId,
      entityType: "delivery_order",
      entityId: deliveryId,
      fromStatus: delivery.status,
      toStatus: "installed",
      actorType: "technician",
      actorName: "Technician",
      createdAt: now,
    });

    await batch.commit();
    const details = await hydratePublicDeliveryDetails(db, deliveryId);
    return { details };
  },
);
