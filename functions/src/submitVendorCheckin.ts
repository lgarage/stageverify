import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { applyDeliveryReadinessTransaction } from "./applyDeliveryReadiness";
import {
  asDeliveryId,
  asSessionToken,
  assertVendorSessionValid,
} from "./vendorSessionValidation";
import { hydratePublicDeliveryDetails } from "./deliveryDetailsResponse";

function getDb() {
  return admin.firestore();
}

type DeliveryStatus =
  | "pending"
  | "shipped"
  | "arrived"
  | "partial"
  | "ready_for_pickup"
  | "complete"
  | "issue"
  | "picked_up"
  | "installed";

type ItemStatus =
  | "pending"
  | "partial"
  | "received"
  | "missing"
  | "damaged"
  | "backordered"
  | "installed";

interface ItemUpdateInput {
  id?: string;
  qtyReceived?: number;
  qtyMissing?: number;
  qtyDamaged?: number;
}

interface SubmitVendorCheckinRequest {
  deliveryId?: string;
  sessionToken?: string;
  driverName?: string;
  itemUpdates?: ItemUpdateInput[];
}

function asDriverName(value: unknown): string {
  if (typeof value !== "string") return "Vendor Driver";
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : "Vendor Driver";
}

function asItemUpdates(value: unknown): ItemUpdateInput[] | null {
  if (!Array.isArray(value) || value.length > 500) return null;
  return value as ItemUpdateInput[];
}

function computeItemStatus(update: {
  qtyReceived: number;
  qtyMissing: number;
  qtyDamaged: number;
  qtyOrdered: number;
}): ItemStatus {
  if (update.qtyReceived === update.qtyOrdered) return "received";
  if (update.qtyReceived > 0) return "partial";
  if (update.qtyDamaged > 0) return "damaged";
  return "missing";
}

/** Session-gated vendor check-in — replaces unauth Firestore batch writes. */
export const submitVendorCheckin = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const data = (request.data ?? {}) as SubmitVendorCheckinRequest;
    const deliveryId = asDeliveryId(data.deliveryId);
    const sessionToken = asSessionToken(data.sessionToken);
    const driverName = asDriverName(data.driverName);
    const itemUpdates = asItemUpdates(data.itemUpdates);

    if (!deliveryId || !sessionToken || !itemUpdates) {
      throw new HttpsError("invalid-argument", "Invalid session.");
    }

    await assertVendorSessionValid(sessionToken, deliveryId);

    const db = getDb();
    const deliveryRef = db.collection("deliveries").doc(deliveryId);
    const deliverySnap = await deliveryRef.get();
    if (!deliverySnap.exists) {
      throw new HttpsError("not-found", "Delivery not found.");
    }
    const delivery = deliverySnap.data() as admin.firestore.DocumentData;
    const fromStatus = delivery.status as DeliveryStatus;

    const itemsSnap = await db
      .collection("items")
      .where("deliveryOrderId", "==", deliveryId)
      .get();
    const existingItems = new Map(
      itemsSnap.docs.map((docSnap) => [docSnap.id, docSnap.data()]),
    );

    const batch = db.batch();
    for (const update of itemUpdates) {
      const itemId = typeof update.id === "string" ? update.id.trim() : "";
      if (!itemId) continue;
      const existingItem = existingItems.get(itemId);
      if (!existingItem) {
        throw new HttpsError(
          "permission-denied",
          "Item does not belong to this delivery.",
        );
      }
      const qtyOrdered =
        typeof existingItem.qtyOrdered === "number"
          ? existingItem.qtyOrdered
          : 0;
      const qtyReceivedRaw = update.qtyReceived;
      const qtyMissingRaw = update.qtyMissing;
      const qtyDamagedRaw = update.qtyDamaged;
      if (
        typeof qtyReceivedRaw !== "number" ||
        !Number.isInteger(qtyReceivedRaw) ||
        qtyReceivedRaw < 0 ||
        qtyReceivedRaw > 9999 ||
        typeof qtyMissingRaw !== "number" ||
        !Number.isInteger(qtyMissingRaw) ||
        qtyMissingRaw < 0 ||
        qtyMissingRaw > 9999 ||
        typeof qtyDamagedRaw !== "number" ||
        !Number.isInteger(qtyDamagedRaw) ||
        qtyDamagedRaw < 0 ||
        qtyDamagedRaw > 9999
      ) {
        throw new HttpsError("invalid-argument", "Invalid item quantities.");
      }
      const qtyReceived = qtyReceivedRaw;
      const qtyMissing = qtyMissingRaw;
      const qtyDamaged = qtyDamagedRaw;
      const status = computeItemStatus({
        qtyReceived,
        qtyMissing,
        qtyDamaged,
        qtyOrdered,
      });
      batch.update(db.collection("items").doc(itemId), {
        qtyReceived,
        qtyMissing,
        qtyDamaged,
        status,
      });
    }

    const now = new Date().toISOString();
    const anyReceivedAfterCheckIn = itemUpdates.some(
      (update) => (update.qtyReceived ?? 0) > 0,
    );
    const vendorStatus: DeliveryStatus =
      fromStatus === "arrived" && anyReceivedAfterCheckIn
        ? "partial"
        : fromStatus;

    batch.update(deliveryRef, {
      submittedAt: now,
      status: vendorStatus,
      updatedAt: now,
    });

    if (fromStatus !== vendorStatus) {
      const eventId = `event-${crypto.randomUUID()}`;
      batch.set(db.collection("statusHistory").doc(eventId), {
        id: eventId,
        entityType: "delivery_order",
        entityId: deliveryId,
        fromStatus,
        toStatus: vendorStatus,
        actorType: "vendor",
        actorName: driverName,
        createdAt: now,
      });
    }

    await batch.commit();
    await applyDeliveryReadinessTransaction(db, deliveryId, {
      historyReason: "Vendor check-in readiness recalculation",
    });

    const details = await hydratePublicDeliveryDetails(db, deliveryId);
    return { details };
  },
);
