/**
 * Dispatcher-only cancel/clear for a jobless unplanned delivery.
 * Releases staging without recording a pickup.
 */
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  requireDispatcherAuth,
  readDispatcherRoleDoc,
} from "./inboundEmail/dispatcherAuth";
import { buildPickupLiveStagingPatch } from "./pickupStagingRelease";
import {
  isCancelledStatus,
  isJoblessUnplannedDelivery,
  isPickupLockedStatus,
} from "./unplannedWillCallEligibility";

function getDb() {
  return admin.firestore();
}

const MAX_REASON_LEN = 500;
const MAX_CLIENT_OP_ID_LEN = 64;
const CLIENT_OP_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

function asNonEmptyString(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLen) return null;
  return trimmed;
}

function asClientOperationId(value: unknown): string | null {
  const parsed = asNonEmptyString(value, MAX_CLIENT_OP_ID_LEN);
  if (!parsed || !CLIENT_OP_ID_PATTERN.test(parsed)) return null;
  return parsed;
}

async function dispatcherDisplayName(uid: string): Promise<string> {
  const role = await readDispatcherRoleDoc(uid);
  const fullName =
    typeof role?.fullName === "string" ? role.fullName.trim() : "";
  if (fullName) return fullName;
  const email = typeof role?.email === "string" ? role.email.trim() : "";
  if (email) return email;
  try {
    const user = await admin.auth().getUser(uid);
    const authName = user.displayName?.trim();
    if (authName) return authName;
    const authEmail = user.email?.trim();
    if (authEmail) return authEmail;
  } catch {
    // fall through to uid
  }
  return uid;
}

interface ClearStagedDeliveryRequest {
  deliveryOrderId?: string;
  reason?: string;
  clientOperationId?: string;
}

export const clearStagedDelivery = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const uid = await requireDispatcherAuth(request);
    const actorName = await dispatcherDisplayName(uid);

    const data = (request.data ?? {}) as ClearStagedDeliveryRequest;
    const deliveryOrderId = asNonEmptyString(data.deliveryOrderId, 128);
    const reason = asNonEmptyString(data.reason, MAX_REASON_LEN);
    const clientOperationId = asClientOperationId(data.clientOperationId);

    if (!deliveryOrderId || !reason || !clientOperationId) {
      throw new HttpsError(
        "invalid-argument",
        "deliveryOrderId, reason, and clientOperationId are required.",
      );
    }

    const db = getDb();
    const idempotencyRef = db
      .collection("clearDeliveryOperations")
      .doc(clientOperationId);

    return db.runTransaction(async (tx) => {
      const existingOp = await tx.get(idempotencyRef);
      if (existingOp.exists) {
        const cached = existingOp.data();
        return {
          duplicate: true,
          clearEventId: cached?.clearEventId ?? null,
          deliveryStatus: cached?.deliveryStatus ?? "cancelled",
        };
      }

      const deliveryRef = db.collection("deliveries").doc(deliveryOrderId);
      const deliverySnap = await tx.get(deliveryRef);
      if (!deliverySnap.exists) {
        throw new HttpsError("not-found", "Delivery not found.");
      }

      const delivery = deliverySnap.data() as Record<string, unknown> & {
        status?: string;
        jobId?: string;
        unplanned?: boolean;
        stagingLocationId?: string;
        additionalStagingLocationIds?: string[];
        plannedStagingLocationIds?: string[];
        combinationStagingGroupId?: string;
        combinationMemberLocationIds?: string[];
        pickedUpStagingLocationIds?: string[];
      };

      if (isPickupLockedStatus(delivery.status)) {
        throw new HttpsError(
          "failed-precondition",
          "Cannot cancel a delivery that was already picked up or installed.",
        );
      }

      if (isCancelledStatus(delivery.status)) {
        tx.set(idempotencyRef, {
          deliveryOrderId,
          clearEventId: null,
          deliveryStatus: "cancelled",
          createdAt: new Date().toISOString(),
        });
        return {
          duplicate: true,
          clearEventId: null,
          deliveryStatus: "cancelled",
        };
      }

      if (!isJoblessUnplannedDelivery(delivery)) {
        throw new HttpsError(
          "failed-precondition",
          "Only unplanned deliveries without a job can be cleared from staging this way.",
        );
      }

      const now = new Date().toISOString();
      const clearEventId = crypto.randomUUID();
      const historyId = `event-${clearEventId}`;
      const stagingPatch = buildPickupLiveStagingPatch(
        delivery,
        delivery.pickedUpStagingLocationIds ?? [],
        true,
      );
      const releasedIds = [
        ...new Set(
          [
            typeof delivery.stagingLocationId === "string"
              ? delivery.stagingLocationId.trim()
              : "",
            ...(Array.isArray(delivery.additionalStagingLocationIds)
              ? delivery.additionalStagingLocationIds
              : []),
            ...(Array.isArray(delivery.plannedStagingLocationIds)
              ? delivery.plannedStagingLocationIds
              : []),
            ...(Array.isArray(delivery.combinationMemberLocationIds)
              ? delivery.combinationMemberLocationIds
              : []),
          ]
            .map((id) => (typeof id === "string" ? id.trim() : ""))
            .filter(Boolean),
        ),
      ];

      tx.update(deliveryRef, {
        ...stagingPatch,
        status: "cancelled",
        readinessStatus: "not_ready",
        clearedAt: now,
        clearedByUid: uid,
        clearedByName: actorName,
        clearReason: reason,
        updatedAt: now,
      });

      tx.set(db.collection("deliveryClearEvents").doc(clearEventId), {
        id: clearEventId,
        deliveryOrderId,
        reason,
        clearedByUid: uid,
        clearedByName: actorName,
        clearedAt: now,
        clientOperationId,
        stagingLocationIdsReleased: releasedIds,
        fromStatus: delivery.status ?? "pending",
        toStatus: "cancelled",
      });

      tx.set(db.collection("statusHistory").doc(historyId), {
        id: historyId,
        entityType: "delivery_order",
        entityId: deliveryOrderId,
        fromStatus: delivery.status ?? "pending",
        toStatus: "cancelled",
        reason,
        actorType: "dispatcher",
        actorName,
        actorUid: uid,
        createdAt: now,
      });

      tx.set(idempotencyRef, {
        deliveryOrderId,
        clearEventId,
        deliveryStatus: "cancelled",
        createdAt: now,
      });

      return {
        duplicate: false,
        clearEventId,
        deliveryStatus: "cancelled",
      };
    });
  },
);
