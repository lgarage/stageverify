import * as admin from "firebase-admin";
import {
  computeDeliveryReadiness,
  type DeliveryDoc,
  type DeliveryStatus,
  type ItemDoc,
} from "./deliveryReadiness";

export const MAX_ITEMS_PER_DELIVERY = 500;

export interface ApplyDeliveryReadinessResult {
  deliveryOrderId: string;
  readyForPickup: boolean;
  readinessStatus: string;
  deliveryStatus: DeliveryStatus;
  readinessBlockReasons: string[];
  statusChanged: boolean;
  fromStatus: DeliveryStatus;
}

/** Shared authoritative readiness write — used by callable CF and scheduled auto-submit. */
export async function applyDeliveryReadinessTransaction(
  db: admin.firestore.Firestore,
  deliveryOrderId: string,
  options?: { historyReason?: string },
): Promise<ApplyDeliveryReadinessResult> {
  const deliveryRef = db.collection("deliveries").doc(deliveryOrderId);
  const settingsRef = db.collection("appSettings").doc("config");
  const historyReason =
    options?.historyReason ?? "Server readiness recalculation";

  return db.runTransaction(async (tx) => {
    const deliverySnap = await tx.get(deliveryRef);
    if (!deliverySnap.exists) {
      throw new Error(`Delivery not found: ${deliveryOrderId}`);
    }

    const settingsSnap = await tx.get(settingsRef);
    const vendorDeliveryMode =
      (settingsSnap.data()?.vendorDeliveryMode as
        | "full_checkin"
        | "exception_only"
        | undefined) ?? "full_checkin";

    const delivery = deliverySnap.data() as DeliveryDoc & { id?: string };
    const itemsSnap = await tx.get(
      db
        .collection("items")
        .where("deliveryOrderId", "==", deliveryOrderId)
        .limit(MAX_ITEMS_PER_DELIVERY + 1),
    );

    if (itemsSnap.empty) {
      throw new Error(`Delivery has no items: ${deliveryOrderId}`);
    }
    if (itemsSnap.size > MAX_ITEMS_PER_DELIVERY) {
      throw new Error(
        `Delivery has too many line items for readiness calculation: ${deliveryOrderId}`,
      );
    }

    const items = itemsSnap.docs.map((doc) => doc.data() as ItemDoc);
    const now = new Date().toISOString();
    const result = computeDeliveryReadiness(
      delivery,
      items,
      now,
      vendorDeliveryMode,
    );
    const fromStatus = delivery.status as DeliveryStatus;
    const lockedTerminal =
      fromStatus === "picked_up" || fromStatus === "installed";
    const closedPickedUp = delivery.invoiceImportStatus === "closed_picked_up";

    const deliveryPatch: Record<string, unknown> = {
      physicalDropoffComplete: result.physicalDropoffComplete,
      physicalDropoffCompleteAt: result.physicalDropoffCompleteAt ?? null,
      stagingAssignmentComplete: result.stagingAssignmentComplete,
      readinessBlockReasons: result.evidence.readinessBlockReasons,
      updatedAt: now,
    };
    if (closedPickedUp) {
      deliveryPatch.status = "picked_up";
      deliveryPatch.readinessStatus = "picked_up";
    } else if (!lockedTerminal) {
      deliveryPatch.readinessStatus = result.readinessStatus;
      deliveryPatch.status = result.deliveryStatus;
    }

    tx.update(deliveryRef, deliveryPatch);

    const effectiveStatus = lockedTerminal
      ? fromStatus
      : closedPickedUp
        ? "picked_up"
        : result.deliveryStatus;

    const statusChanged =
      !lockedTerminal &&
      fromStatus !== effectiveStatus &&
      (closedPickedUp || fromStatus !== result.deliveryStatus);

    if (statusChanged) {
      const historyId = `event-readiness-${crypto.randomUUID()}`;
      tx.set(db.collection("statusHistory").doc(historyId), {
        id: historyId,
        entityType: "delivery_order",
        entityId: deliveryOrderId,
        fromStatus,
        toStatus: effectiveStatus,
        reason: historyReason,
        actorType: "system",
        actorName: "StageVerify",
        createdAt: now,
      });
    }

    return {
      deliveryOrderId,
      readyForPickup: lockedTerminal || closedPickedUp ? false : result.readyForPickup,
      readinessStatus:
        lockedTerminal || closedPickedUp ? "picked_up" : result.readinessStatus,
      deliveryStatus: effectiveStatus,
      readinessBlockReasons: result.evidence.readinessBlockReasons,
      statusChanged,
      fromStatus,
    };
  });
}
