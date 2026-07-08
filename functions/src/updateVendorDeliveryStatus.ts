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

const VALID_TRANSITIONS: Partial<Record<DeliveryStatus, DeliveryStatus[]>> = {
  pending: ["shipped", "arrived", "issue"],
  shipped: ["arrived", "issue"],
  arrived: ["partial", "issue"],
  partial: ["arrived", "issue"],
  ready_for_pickup: ["arrived", "issue"],
  complete: ["arrived", "issue"],
};

const VENDOR_REVERT_TARGETS: Partial<Record<DeliveryStatus, DeliveryStatus>> = {
  partial: "arrived",
  ready_for_pickup: "arrived",
  complete: "arrived",
};

interface UpdateVendorDeliveryStatusRequest {
  deliveryId?: string;
  sessionToken?: string;
  toStatus?: string;
  action?: string;
  vendorRevertWindowMinutes?: number;
  actorName?: string;
}

function asToStatus(value: unknown): DeliveryStatus | null {
  const allowed: DeliveryStatus[] = [
    "pending",
    "shipped",
    "arrived",
    "partial",
    "ready_for_pickup",
    "complete",
    "issue",
    "picked_up",
    "installed",
  ];
  if (typeof value !== "string") return null;
  return allowed.includes(value as DeliveryStatus)
    ? (value as DeliveryStatus)
    : null;
}

function asRevertWindow(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 60;
  return Math.min(Math.max(Math.floor(value), 1), 24 * 60);
}

/** Session-gated vendor status updates and revert — replaces unauth delivery writes. */
export const updateVendorDeliveryStatus = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const data = (request.data ?? {}) as UpdateVendorDeliveryStatusRequest;
    const deliveryId = asDeliveryId(data.deliveryId);
    const sessionToken = asSessionToken(data.sessionToken);
    const action = data.action === "revert" ? "revert" : "update";
    const toStatus = asToStatus(data.toStatus);
    const vendorRevertWindowMinutes = asRevertWindow(data.vendorRevertWindowMinutes);
    const actorName =
      typeof data.actorName === "string" && data.actorName.trim()
        ? data.actorName.trim().slice(0, 128)
        : "Vendor Driver";

    if (!deliveryId || !sessionToken) {
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

    if (action === "revert") {
      let target = VENDOR_REVERT_TARGETS[fromStatus];
      if (!target && fromStatus === "arrived" && delivery.submittedAt) {
        target = "arrived";
      }
      if (!target) {
        const details = await hydratePublicDeliveryDetails(db, deliveryId);
        return { details };
      }

      const submittedAt = delivery.submittedAt;
      if (!submittedAt) {
        const details = await hydratePublicDeliveryDetails(db, deliveryId);
        return { details };
      }
      const elapsedMs = Date.now() - new Date(String(submittedAt)).getTime();
      if (elapsedMs > vendorRevertWindowMinutes * 60 * 1000) {
        const details = await hydratePublicDeliveryDetails(db, deliveryId);
        return { details };
      }

      const now = new Date().toISOString();
      const eventId = `event-${crypto.randomUUID()}`;
      const batch = db.batch();
      const clearSubmitted =
        target === "arrived" ||
        (fromStatus === "arrived" && Boolean(delivery.submittedAt));
      const clearPhysicalEvidence =
        clearSubmitted || delivery.vendorPhysicalDropoffConfirmed === true;

      batch.update(deliveryRef, {
        status: target,
        submittedAt: clearSubmitted ? null : delivery.submittedAt ?? null,
        ...(clearPhysicalEvidence
          ? {
              vendorPhysicalDropoffConfirmed: false,
              vendorPhysicalDropoffConfirmedAt: null,
              deliveredAt: null,
              physicalDropoffSource: null,
            }
          : {}),
        updatedAt: now,
      });
      batch.set(db.collection("statusHistory").doc(eventId), {
        id: eventId,
        entityType: "delivery_order",
        entityId: deliveryId,
        fromStatus,
        toStatus: target,
        reason: "Reverted",
        actorType: "vendor",
        actorName,
        createdAt: now,
      });
      await batch.commit();
      await applyDeliveryReadinessTransaction(db, deliveryId, {
        historyReason: "Vendor revert readiness recalculation",
      });
      const details = await hydratePublicDeliveryDetails(db, deliveryId);
      return { details };
    }

    if (!toStatus) {
      throw new HttpsError("invalid-argument", "Invalid status.");
    }
    if (toStatus === "picked_up" || toStatus === "ready_for_pickup") {
      throw new HttpsError("permission-denied", "Status change not allowed.");
    }
    const allowed = VALID_TRANSITIONS[fromStatus];
    if (!allowed?.includes(toStatus)) {
      const details = await hydratePublicDeliveryDetails(db, deliveryId);
      return { details };
    }

    const now = new Date().toISOString();
    const eventId = `event-${crypto.randomUUID()}`;
    const batch = db.batch();
    batch.update(deliveryRef, {
      status: toStatus,
      updatedAt: now,
    });
    batch.set(db.collection("statusHistory").doc(eventId), {
      id: eventId,
      entityType: "delivery_order",
      entityId: deliveryId,
      fromStatus,
      toStatus,
      actorType: "vendor",
      actorName,
      createdAt: now,
    });
    await batch.commit();
    const details = await hydratePublicDeliveryDetails(db, deliveryId);
    return { details };
  },
);
