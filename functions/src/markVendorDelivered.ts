import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { applyDeliveryReadinessTransaction } from "./applyDeliveryReadiness";
import {
  asDeliveryId,
  asSessionToken,
  assertVendorSessionValid,
} from "./vendorSessionValidation";

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

interface MarkVendorDeliveredRequest {
  deliveryId?: string;
  sessionToken?: string;
  actorName?: string;
}

interface DeliveryDoc {
  status: DeliveryStatus;
  vendorPhysicalDropoffConfirmed?: boolean;
  vendorPhysicalDropoffConfirmedAt?: string;
  deliveredAt?: string;
}

function asActorName(value: unknown): string {
  if (typeof value !== "string") return "Vendor Driver";
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : "Vendor Driver";
}

/** Server-owned vendor DELIVERED — validates session, writes evidence, recalculates readiness. */
export const markVendorDelivered = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const data = (request.data ?? {}) as MarkVendorDeliveredRequest;
    const deliveryId = asDeliveryId(data.deliveryId);
    const sessionToken = asSessionToken(data.sessionToken);
    const actorName = asActorName(data.actorName);

    if (!deliveryId || !sessionToken) {
      throw new HttpsError("invalid-argument", "Invalid session.");
    }

    await assertVendorSessionValid(sessionToken, deliveryId);

    const deliveryRef = getDb().collection("deliveries").doc(deliveryId);
    const deliverySnap = await deliveryRef.get();
    if (!deliverySnap.exists) {
      throw new HttpsError("not-found", "Delivery not found.");
    }

    const delivery = deliverySnap.data() as DeliveryDoc;
    const alreadyConfirmed = delivery.vendorPhysicalDropoffConfirmed === true;
    const fromStatus = delivery.status;
    const toStatus: DeliveryStatus =
      fromStatus === "pending" || fromStatus === "shipped" ? "arrived" : fromStatus;

    const now = new Date().toISOString();
    const confirmedAt =
      alreadyConfirmed && delivery.vendorPhysicalDropoffConfirmedAt
        ? delivery.vendorPhysicalDropoffConfirmedAt
        : now;

    const batch = getDb().batch();
    batch.update(deliveryRef, {
      status: toStatus,
      submittedAt: now,
      vendorPhysicalDropoffConfirmed: true,
      vendorPhysicalDropoffConfirmedAt: confirmedAt,
      deliveredAt:
        alreadyConfirmed && delivery.deliveredAt ? delivery.deliveredAt : now,
      physicalDropoffSource: "physical_checkin",
      updatedAt: now,
    });

    if (fromStatus !== toStatus) {
      const eventId = `event-${crypto.randomUUID()}`;
      batch.set(getDb().collection("statusHistory").doc(eventId), {
        id: eventId,
        entityType: "delivery_order",
        entityId: deliveryId,
        fromStatus,
        toStatus,
        reason: "Vendor confirmed delivery",
        actorType: "vendor",
        actorName,
        createdAt: now,
      });
    }

    await batch.commit();

    const readiness = await applyDeliveryReadinessTransaction(
      getDb(),
      deliveryId,
      { historyReason: "Vendor DELIVERED readiness recalculation" },
    );

    return {
      deliveryId,
      status: toStatus,
      vendorPhysicalDropoffConfirmed: true,
      vendorPhysicalDropoffConfirmedAt: confirmedAt,
      idempotent: alreadyConfirmed && fromStatus === toStatus,
      readiness,
    };
  },
);
