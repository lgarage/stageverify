import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { applyDeliveryReadinessTransaction } from "./applyDeliveryReadiness";
import {
  asDeliveryId,
  asSessionToken,
  assertVendorSessionForDelivery,
} from "./vendorSessionValidation";
import { hasAssignableSpot } from "./vendorDeliverySpotUtils";

function getDb() {
  return admin.firestore();
}

const MAX_BULK_IDS = 50;

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

interface DeliveryDoc {
  status: DeliveryStatus;
  vendorId?: string;
  vendorPhysicalDropoffConfirmed?: boolean;
  vendorPhysicalDropoffConfirmedAt?: string;
  deliveredAt?: string;
}

interface MarkVendorDeliveriesBulkRequest {
  sessionToken?: string;
  deliveryIds?: string[];
  actorName?: string;
}

interface BulkMarkResult {
  deliveryId: string;
  success: boolean;
  error?: string;
  status?: DeliveryStatus;
  vendorPhysicalDropoffConfirmed?: boolean;
  idempotent?: boolean;
}

function asActorName(value: unknown): string {
  if (typeof value !== "string") return "Vendor Driver";
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : "Vendor Driver";
}

function asDeliveryIdList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  for (const entry of value) {
    const id = asDeliveryId(entry);
    if (!id) return null;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids.length > 0 ? ids : null;
}

async function markOneDeliveryDelivered(
  deliveryId: string,
  sessionToken: string,
  actorName: string,
): Promise<BulkMarkResult> {
  try {
    await assertVendorSessionForDelivery(sessionToken, deliveryId);

    const deliveryRef = getDb().collection("deliveries").doc(deliveryId);
    const deliverySnap = await deliveryRef.get();
    if (!deliverySnap.exists) {
      return { deliveryId, success: false, error: "Delivery not found." };
    }

    const delivery = deliverySnap.data() as DeliveryDoc;

    if (!hasAssignableSpot(deliverySnap.data() as admin.firestore.DocumentData)) {
      return {
        deliveryId,
        success: false,
        error: "No assigned spot — ask dispatch.",
      };
    }

    const alreadyConfirmed = delivery.vendorPhysicalDropoffConfirmed === true;
    const fromStatus = delivery.status;
    const toStatus: DeliveryStatus =
      fromStatus === "pending" || fromStatus === "shipped"
        ? "arrived"
        : fromStatus;

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

    await applyDeliveryReadinessTransaction(getDb(), deliveryId, {
      historyReason: "Vendor DELIVERED readiness recalculation",
    });

    return {
      deliveryId,
      success: true,
      status: toStatus,
      vendorPhysicalDropoffConfirmed: true,
      idempotent: alreadyConfirmed && fromStatus === toStatus,
    };
  } catch (err) {
    const message =
      err instanceof HttpsError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Mark delivered failed.";
    return { deliveryId, success: false, error: message };
  }
}

/** Bulk vendor DELIVERED — vendor-scoped sessions; per-id results on partial failure. */
export const markVendorDeliveriesBulk = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const data = (request.data ?? {}) as MarkVendorDeliveriesBulkRequest;
    const sessionToken = asSessionToken(data.sessionToken);
    const deliveryIds = asDeliveryIdList(data.deliveryIds);
    const actorName = asActorName(data.actorName);

    if (!sessionToken || !deliveryIds) {
      throw new HttpsError("invalid-argument", "Invalid session.");
    }

    if (deliveryIds.length > MAX_BULK_IDS) {
      throw new HttpsError(
        "invalid-argument",
        `Too many deliveries (max ${MAX_BULK_IDS}).`,
      );
    }

    const results: BulkMarkResult[] = [];
    for (const deliveryId of deliveryIds) {
      results.push(
        await markOneDeliveryDelivered(deliveryId, sessionToken, actorName),
      );
    }

    return { results };
  },
);
