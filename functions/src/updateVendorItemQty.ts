import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  asDeliveryId,
  asSessionToken,
  assertVendorSessionValid,
} from "./vendorSessionValidation";

function getDb() {
  return admin.firestore();
}

type ItemStatus = "missing" | "partial" | "received";

interface UpdateVendorItemQtyRequest {
  deliveryId?: string;
  sessionToken?: string;
  itemId?: string;
  qtyOrdered?: number;
  qtyReceived?: number;
  qtyMissing?: number;
}

function asItemId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : null;
}

function asNonNegativeInt(value: unknown, max = 9999): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 0 || value > max) return null;
  return value;
}

/** Session-gated debounced item qty updates on vendor receive. */
export const updateVendorItemQty = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const data = (request.data ?? {}) as UpdateVendorItemQtyRequest;
    const deliveryId = asDeliveryId(data.deliveryId);
    const sessionToken = asSessionToken(data.sessionToken);
    const itemId = asItemId(data.itemId);
    const qtyOrdered = asNonNegativeInt(data.qtyOrdered);
    const qtyReceived = asNonNegativeInt(data.qtyReceived);
    const qtyMissing = asNonNegativeInt(data.qtyMissing);

    if (
      !deliveryId ||
      !sessionToken ||
      !itemId ||
      qtyOrdered === null ||
      qtyReceived === null ||
      qtyMissing === null
    ) {
      throw new HttpsError("invalid-argument", "Invalid session.");
    }

    await assertVendorSessionValid(sessionToken, deliveryId);

    const db = getDb();
    const itemSnap = await db.collection("items").doc(itemId).get();
    if (!itemSnap.exists) {
      throw new HttpsError("not-found", "Item not found.");
    }
    const itemData = itemSnap.data() as admin.firestore.DocumentData;
    if (String(itemData.deliveryOrderId ?? "") !== deliveryId) {
      throw new HttpsError(
        "permission-denied",
        "Item does not belong to this delivery.",
      );
    }

    let itemStatus: ItemStatus = "missing";
    if (qtyReceived >= qtyOrdered) itemStatus = "received";
    else if (qtyReceived > 0) itemStatus = "partial";

    const now = new Date().toISOString();
    const batch = db.batch();
    batch.update(db.collection("items").doc(itemId), {
      qtyReceived,
      qtyMissing,
      status: itemStatus,
    });
    batch.update(db.collection("deliveries").doc(deliveryId), {
      lastCheckmarkAt: now,
      updatedAt: now,
    });
    await batch.commit();
    return { ok: true };
  },
);
