import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { applyDeliveryReadinessTransaction } from "./applyDeliveryReadiness";
import { createMaterialIssue } from "./createMaterialIssue";
import { verifyVendorPin } from "./verifyVendorPin";
import { recordPickupEvent } from "./recordPickupEvent";
import { recalculateDeliveryReadiness } from "./recalculateDeliveryReadiness";
import { markVendorDelivered } from "./markVendorDelivered";
import { processInboundVendorEmail } from "./processInboundVendorEmail";
import { validateVendorSession } from "./validateVendorSession";
import { generatePickupToken } from "./generatePickupToken";
import { revokePickupToken } from "./revokePickupToken";
import { getPickupTokenStatus } from "./getPickupTokenStatus";
import { validatePickupToken } from "./validatePickupToken";
import { updatePickupChecklist } from "./updatePickupChecklist";
import { resolveMaterialIssue } from "./resolveMaterialIssue";
import {
  initiateGmailOAuth,
  completeGmailOAuth,
  disconnectGmailOAuth,
} from "./gmailOAuth";
import { sendVendorEmail } from "./sendVendorEmail";

admin.initializeApp();
const db = admin.firestore();

interface DeliveryOrder {
  id: string;
  status: string;
  lastCheckmarkAt?: string;
  submittedAt?: string;
}

interface Item {
  qtyOrdered: number;
  qtyReceived: number;
  qtyMissing: number;
  qtyDamaged: number;
  qtyBackordered: number;
}

interface AppSettings {
  autoSubmitMinutes?: number;
}

const DEFAULT_AUTO_SUBMIT_MINUTES = 30;

export const autoSubmitDeliveries = onSchedule(
  {
    schedule: "every 5 minutes",
    region: "us-central1",
    timeoutSeconds: 120,
  },
  async () => {
    const settingsSnap = await db
      .collection("appSettings")
      .doc("config")
      .get();
    const settings: AppSettings = settingsSnap.exists
      ? (settingsSnap.data() as AppSettings)
      : {};
    const autoSubmitMs =
      (settings.autoSubmitMinutes ?? DEFAULT_AUTO_SUBMIT_MINUTES) * 60 * 1000;

    const now = Date.now();
    const cutoffIso = new Date(now - autoSubmitMs).toISOString();

    const snap = await db
      .collection("deliveries")
      .where("status", "==", "arrived")
      .get();

    if (snap.empty) return;

    const eligible = snap.docs.filter((d) => {
      const data = d.data() as DeliveryOrder;
      if (!data.lastCheckmarkAt) return false;
      if (data.submittedAt) return false;
      return data.lastCheckmarkAt <= cutoffIso;
    });

    if (eligible.length === 0) return;

    for (const deliveryDoc of eligible) {
      const delivery = deliveryDoc.data() as DeliveryOrder;
      const deliveryId = deliveryDoc.id;
      const nowIso = new Date(now).toISOString();

      try {
        const itemsSnap = await db
          .collection("items")
          .where("deliveryOrderId", "==", deliveryId)
          .limit(501)
          .get();

        if (itemsSnap.empty || itemsSnap.size > 500) continue;

        const items = itemsSnap.docs.map((d) => d.data() as Item);
        const anyReceived = items.some((i) => i.qtyReceived > 0);
        if (!anyReceived) continue;

        // Query selects status == "arrived"; auto-submit always promotes to partial.
        const submitHistoryId = `event-auto-submit-${crypto.randomUUID()}`;
        const batch = db.batch();
        batch.update(deliveryDoc.ref, {
          status: "partial",
          submittedAt: nowIso,
          updatedAt: nowIso,
        });
        batch.set(db.collection("statusHistory").doc(submitHistoryId), {
          id: submitHistoryId,
          entityType: "delivery_order",
          entityId: deliveryId,
          fromStatus: delivery.status,
          toStatus: "partial",
          reason: "Auto-submitted after inactivity timeout",
          actorType: "system",
          actorName: "Auto-Submit",
          createdAt: nowIso,
        });
        await batch.commit();

        await applyDeliveryReadinessTransaction(db, deliveryId, {
          historyReason: "Auto-submit readiness recalculation",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `autoSubmitDeliveries: delivery ${deliveryId} failed — ${message}`,
        );
      }
    }
  },
);

export {
  createMaterialIssue,
  verifyVendorPin,
  validateVendorSession,
  generatePickupToken,
  revokePickupToken,
  getPickupTokenStatus,
  validatePickupToken,
  recordPickupEvent,
  updatePickupChecklist,
  resolveMaterialIssue,
  recalculateDeliveryReadiness,
  markVendorDelivered,
  processInboundVendorEmail,
  initiateGmailOAuth,
  completeGmailOAuth,
  disconnectGmailOAuth,
  sendVendorEmail,
};
