import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { applyDeliveryReadinessTransaction } from "./applyDeliveryReadiness";
import { decrementCatchAllPendingCount } from "./catchAllPendingCount";
import {
  asManagementSessionToken,
  assertManagementCatchAllSession,
} from "./managementSessionValidation";

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

interface MarkCatchAllDeliveryReceivedRequest {
  sessionToken?: string;
  deliveryId?: string;
}

interface DeliveryDoc {
  status: DeliveryStatus;
  vendorPhysicalDropoffConfirmed?: boolean;
  vendorPhysicalDropoffConfirmedAt?: string;
  deliveredAt?: string;
  stagingLocationId?: string;
  reviewFlag?: { flagged?: boolean };
}

function asDeliveryId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : null;
}

/** D-41 narrow exception — packing-slip checkmark marks expected delivery received at catch-all. */
export const markCatchAllDeliveryReceived = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const data = (request.data ?? {}) as MarkCatchAllDeliveryReceivedRequest;
    const sessionToken = asManagementSessionToken(data.sessionToken);
    const deliveryId = asDeliveryId(data.deliveryId);

    if (!sessionToken || !deliveryId) {
      throw new HttpsError("invalid-argument", "Invalid session.");
    }

    const session = await assertManagementCatchAllSession(sessionToken);

    const deliveryRef = getDb().collection("deliveries").doc(deliveryId);
    const deliverySnap = await deliveryRef.get();
    if (!deliverySnap.exists) {
      throw new HttpsError("not-found", "Delivery not found.");
    }

    const delivery = deliverySnap.data() as DeliveryDoc;
    const fromStatus = delivery.status;

    if (delivery.reviewFlag?.flagged === true || deliveryId.startsWith("delivery-unid-")) {
      throw new HttpsError(
        "failed-precondition",
        "Flagged shells cannot be marked received from catch-all intake.",
      );
    }

    if (fromStatus !== "pending" && fromStatus !== "shipped") {
      if (
        delivery.vendorPhysicalDropoffConfirmed === true &&
        fromStatus === "arrived"
      ) {
        return {
          deliveryId,
          status: fromStatus,
          idempotent: true,
        };
      }
      throw new HttpsError(
        "failed-precondition",
        "Delivery is not waiting for parts.",
      );
    }

    const now = new Date().toISOString();
    const toStatus: DeliveryStatus = "arrived";

    if (delivery.vendorPhysicalDropoffConfirmed === true) {
      await deliveryRef.update({
        status: toStatus,
        updatedAt: now,
      });
      const readiness = await applyDeliveryReadinessTransaction(
        getDb(),
        deliveryId,
        { historyReason: "Catch-all mark-received status repair" },
      );
      return {
        deliveryId,
        status: toStatus,
        idempotent: true,
        readiness,
      };
    }

    const batch = getDb().batch();
    batch.update(deliveryRef, {
      status: toStatus,
      submittedAt: now,
      vendorPhysicalDropoffConfirmed: true,
      vendorPhysicalDropoffConfirmedAt: now,
      deliveredAt: now,
      physicalDropoffSource: "catch_all_intake",
      scannedStagingLocationId: session.scannedStagingLocationId,
      scannedAt: now,
      stagingLocationId:
        delivery.stagingLocationId ?? session.scannedStagingLocationId,
      updatedAt: now,
    });

    const eventId = `event-${crypto.randomUUID()}`;
    batch.set(getDb().collection("statusHistory").doc(eventId), {
      id: eventId,
      entityType: "delivery_order",
      entityId: deliveryId,
      fromStatus,
      toStatus,
      reason: "Catch-all packing-slip checkmark (D-41)",
      actorType: "management",
      actorName: "Office intake",
      createdAt: now,
    });

    const logId = `catch-all-${crypto.randomUUID().slice(0, 12)}`;
    batch.set(getDb().collection("pinVerificationEvents").doc(logId), {
      id: logId,
      action: "CATCH_ALL_MARK_RECEIVED",
      deliveryId,
      timestamp: now,
      createdAt: now,
      stagingLocationCode: session.scannedStagingLocationCode,
    });

    await batch.commit();

    await decrementCatchAllPendingCount(getDb());

    const readiness = await applyDeliveryReadinessTransaction(
      getDb(),
      deliveryId,
      { historyReason: "Catch-all mark-received readiness recalculation" },
    );

    return {
      deliveryId,
      status: toStatus,
      vendorPhysicalDropoffConfirmed: true,
      vendorPhysicalDropoffConfirmedAt: now,
      idempotent: false,
      readiness,
    };
  },
);
