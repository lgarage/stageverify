import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  computePhysicalDropoffComplete,
  isPickupEligible,
  type DeliveryDoc,
  type ItemDoc,
} from "./deliveryReadiness";
import { asPickupToken, verifyPickupTokenForJob } from "./pickupTokenValidation";

function getDb() {
  return admin.firestore();
}

const MAX_TECHNICIAN_LEN = 128;
const MAX_SUMMARY_LEN = 500;
const MAX_NOTES_LEN = 500;
const MAX_CLIENT_OP_ID_LEN = 64;
const MAX_LOCATION_IDS = 8;
const MAX_ITEMS_PER_DELIVERY = 500;
const CLIENT_OP_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

function asClientOperationId(value: unknown): string | null {
  const parsed = asNonEmptyString(value, MAX_CLIENT_OP_ID_LEN);
  if (!parsed || !CLIENT_OP_ID_PATTERN.test(parsed)) return null;
  return parsed;
}

interface RecordPickupRequest {
  deliveryOrderId?: string;
  jobId?: string;
  technicianName?: string;
  itemsPickedSummary?: string;
  notes?: string;
  clientOperationId?: string;
  stagingLocationIds?: string[];
  pickupToken?: string;
}

interface ShopStockLineRecord {
  id?: string;
  description?: string;
  qty?: number;
  shopStockLocationCode?: string;
  shopStockMappingId?: string;
}

interface DeliveryRecord extends DeliveryDoc {
  id: string;
  jobId: string;
  vendorId: string;
  purchaseOrderId?: string;
  stagingLocationId?: string;
  additionalStagingLocationIds?: string[];
  combinationStagingGroupId?: string;
  combinationMemberLocationIds?: string[];
  pickedUpStagingLocationIds?: string[];
  readinessStatus?: string;
  shopStockLines?: ShopStockLineRecord[];
}

function asNonEmptyString(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLen) return null;
  return trimmed;
}

function asStringArray(value: unknown, maxItems: number): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length === 0 || value.length > maxItems) return null;
  const out: string[] = [];
  for (const entry of value) {
    const parsed = asNonEmptyString(entry, 128);
    if (!parsed) return null;
    out.push(parsed);
  }
  return out;
}

function allStagingIds(delivery: DeliveryRecord): string[] {
  const ids: string[] = [];
  if (delivery.stagingLocationId?.trim()) ids.push(delivery.stagingLocationId.trim());
  if (delivery.additionalStagingLocationIds?.length) {
    ids.push(...delivery.additionalStagingLocationIds);
  }
  if (delivery.combinationMemberLocationIds?.length) {
    for (const memberId of delivery.combinationMemberLocationIds) {
      const trimmed = memberId?.trim();
      if (trimmed && !ids.includes(trimmed)) ids.push(trimmed);
    }
  }
  return ids;
}

function remainingLocationIds(delivery: DeliveryRecord): string[] {
  const picked = new Set(delivery.pickedUpStagingLocationIds ?? []);
  return allStagingIds(delivery).filter((id) => !picked.has(id));
}

export const recordPickupEvent = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const data = (request.data ?? {}) as RecordPickupRequest;

    const deliveryOrderId = asNonEmptyString(data.deliveryOrderId, 128);
    const jobId = asNonEmptyString(data.jobId, 128);
    const technicianName = asNonEmptyString(
      data.technicianName,
      MAX_TECHNICIAN_LEN,
    );
    const itemsPickedSummary = asNonEmptyString(
      data.itemsPickedSummary,
      MAX_SUMMARY_LEN,
    );
    const clientOperationId = asClientOperationId(
      data.clientOperationId,
    );

    if (
      !deliveryOrderId ||
      !jobId ||
      !technicianName ||
      !itemsPickedSummary ||
      !clientOperationId
    ) {
      throw new HttpsError(
        "invalid-argument",
        "deliveryOrderId, jobId, technicianName, itemsPickedSummary, and clientOperationId are required.",
      );
    }

    const notes =
      data.notes === undefined || data.notes === ""
        ? undefined
        : asNonEmptyString(data.notes, MAX_NOTES_LEN);
    if (data.notes && !notes) {
      throw new HttpsError("invalid-argument", "Notes are too long.");
    }

    const db = getDb();
    if (!request.auth) {
      const pickupToken = asPickupToken(data.pickupToken);
      if (!pickupToken) {
        throw new HttpsError(
          "permission-denied",
          "Pickup token is required for technician pickup.",
        );
      }
      await verifyPickupTokenForJob(db, pickupToken, jobId);
    }

    const stagingLocationIds =
      data.stagingLocationIds === undefined
        ? null
        : asStringArray(data.stagingLocationIds, MAX_LOCATION_IDS);
    if (data.stagingLocationIds && !stagingLocationIds) {
      throw new HttpsError("invalid-argument", "Invalid stagingLocationIds.");
    }

    const idempotencyRef = db.collection("pickupOperations").doc(clientOperationId);

    return db.runTransaction(async (tx) => {
      const existingOp = await tx.get(idempotencyRef);
      if (existingOp.exists) {
        const cached = existingOp.data();
        return {
          duplicate: true,
          pickupEventId: cached?.pickupEventId ?? null,
          deliveryStatus: cached?.deliveryStatus ?? null,
          pickedUpStagingLocationIds:
            cached?.pickedUpStagingLocationIds ?? [],
        };
      }

      const deliveryRef = db.collection("deliveries").doc(deliveryOrderId);
      const deliverySnap = await tx.get(deliveryRef);
      if (!deliverySnap.exists) {
        throw new HttpsError("not-found", "Delivery not found.");
      }

      const delivery = deliverySnap.data() as DeliveryRecord;
      if (delivery.jobId !== jobId) {
        throw new HttpsError(
          "permission-denied",
          "Delivery does not belong to this job.",
        );
      }

      if (delivery.status === "picked_up" || delivery.status === "installed") {
        tx.set(idempotencyRef, {
          deliveryOrderId,
          jobId,
          pickupEventId: null,
          deliveryStatus: delivery.status,
          pickedUpStagingLocationIds: delivery.pickedUpStagingLocationIds ?? [],
          createdAt: new Date().toISOString(),
        });
        return {
          duplicate: true,
          pickupEventId: null,
          deliveryStatus: delivery.status,
          pickedUpStagingLocationIds: delivery.pickedUpStagingLocationIds ?? [],
        };
      }

      const assignedLocations = allStagingIds(delivery);
      if (assignedLocations.length === 0) {
        throw new HttpsError(
          "failed-precondition",
          "Delivery has no assigned staging locations.",
        );
      }

      const itemsSnap = await tx.get(
        db
          .collection("items")
          .where("deliveryOrderId", "==", deliveryOrderId)
          .limit(MAX_ITEMS_PER_DELIVERY + 1),
      );
      if (itemsSnap.empty) {
        throw new HttpsError("failed-precondition", "Delivery has no items.");
      }
      if (itemsSnap.size > MAX_ITEMS_PER_DELIVERY) {
        throw new HttpsError(
          "failed-precondition",
          "Delivery has too many line items for pickup.",
        );
      }

      const items = itemsSnap.docs.map((doc) => doc.data() as ItemDoc);

      const settingsSnap = await tx.get(
        db.collection("appSettings").doc("config"),
      );
      const vendorDeliveryMode =
        (settingsSnap.data()?.vendorDeliveryMode as
          | "full_checkin"
          | "exception_only"
          | undefined) ?? "full_checkin";

      if (delivery.purchaseOrderId) {
        const poSnap = await tx.get(
          db.collection("purchaseOrders").doc(delivery.purchaseOrderId),
        );
        if (!poSnap.exists) {
          throw new HttpsError("not-found", "Purchase order not found.");
        }
        const po = poSnap.data();
        if (po?.jobId !== jobId || po?.vendorId !== delivery.vendorId) {
          throw new HttpsError(
            "permission-denied",
            "Purchase order relationship mismatch.",
          );
        }
      }

      const eligibility = isPickupEligible(delivery, items, vendorDeliveryMode);
      if (!eligibility.eligible) {
        throw new HttpsError(
          "failed-precondition",
          `Pickup not allowed: ${eligibility.reason ?? "ineligible"}.`,
        );
      }

      if (!computePhysicalDropoffComplete(delivery, items, vendorDeliveryMode)) {
        throw new HttpsError(
          "failed-precondition",
          "Physical drop-off is incomplete for this delivery.",
        );
      }

      const targetLocations =
        stagingLocationIds && stagingLocationIds.length > 0
          ? stagingLocationIds
          : remainingLocationIds(delivery);

      if (targetLocations.length === 0) {
        throw new HttpsError(
          "failed-precondition",
          "All staging locations are already picked up.",
        );
      }

      for (const locId of targetLocations) {
        if (!assignedLocations.includes(locId)) {
          throw new HttpsError(
            "permission-denied",
            "Staging location does not belong to this delivery.",
          );
        }
      }

      const alreadyPicked = new Set(delivery.pickedUpStagingLocationIds ?? []);
      for (const locId of targetLocations) {
        if (alreadyPicked.has(locId)) {
          throw new HttpsError(
            "failed-precondition",
            "Staging location already picked up.",
          );
        }
      }

      const now = new Date().toISOString();
      const pickupEventId = crypto.randomUUID();
      const historyId = `event-${pickupEventId}`;

      const mergedPicked = [
        ...(delivery.pickedUpStagingLocationIds ?? []),
        ...targetLocations,
      ];
      const stillRemaining = assignedLocations.filter(
        (id) => !mergedPicked.includes(id),
      );
      const fullyPicked = stillRemaining.length === 0;

      const qtyByMapping = new Map<string, number>();
      if (fullyPicked) {
        for (const line of delivery.shopStockLines ?? []) {
          const mappingId = line.shopStockMappingId?.trim();
          if (!mappingId) continue;
          const qty =
            typeof line.qty === "number" && line.qty > 0 ? line.qty : 1;
          qtyByMapping.set(mappingId, (qtyByMapping.get(mappingId) ?? 0) + qty);
        }
      }
      const mappingSnaps = await Promise.all(
        [...qtyByMapping.keys()].map((mappingId) =>
          tx.get(db.collection("shopStockLocationMappings").doc(mappingId)),
        ),
      );

      const nextStatus = fullyPicked ? "picked_up" : delivery.status;
      const deliveryPatch: Record<string, unknown> = {
        updatedAt: now,
        pickedUpStagingLocationIds: mergedPicked,
      };
      if (fullyPicked) {
        deliveryPatch.status = "picked_up";
        deliveryPatch.stagingLocationId = "";
        deliveryPatch.additionalStagingLocationIds = [];
        deliveryPatch.combinationStagingGroupId = "";
        deliveryPatch.combinationMemberLocationIds = [];
        deliveryPatch.readinessStatus = "picked_up";
        deliveryPatch.pickupCheckedItemIds = [];
      }

      tx.set(db.collection("pickupEvents").doc(pickupEventId), {
        id: pickupEventId,
        deliveryOrderId,
        jobId,
        technicianName,
        pickedUpAt: now,
        itemsPickedSummary,
        ...(notes ? { notes } : {}),
        clientOperationId,
        stagingLocationIds: targetLocations,
      });

      tx.update(deliveryRef, deliveryPatch);

      if (fullyPicked) {
        tx.set(db.collection("statusHistory").doc(historyId), {
          id: historyId,
          entityType: "delivery_order",
          entityId: deliveryOrderId,
          fromStatus: delivery.status,
          toStatus: "picked_up",
          actorType: "technician",
          actorName: technicianName,
          createdAt: now,
        });

        for (const mappingSnap of mappingSnaps) {
          if (!mappingSnap.exists) continue;
          const mappingId = mappingSnap.id;
          const qty = qtyByMapping.get(mappingId);
          if (!qty) continue;
          const data = mappingSnap.data() as {
            qtyAssigned?: number;
            qtyPickedUp?: number;
          };
          const assigned = Math.max(0, data.qtyAssigned ?? 0);
          const pickedUp = Math.max(0, data.qtyPickedUp ?? 0);
          const applied = Math.min(qty, assigned > 0 ? assigned : qty);
          tx.update(mappingSnap.ref, {
            qtyAssigned: Math.max(0, assigned - applied),
            qtyPickedUp: pickedUp + applied,
            updatedAt: now,
          });
        }
      }

      tx.set(idempotencyRef, {
        deliveryOrderId,
        jobId,
        pickupEventId,
        deliveryStatus: nextStatus,
        pickedUpStagingLocationIds: mergedPicked,
        createdAt: now,
      });

      return {
        duplicate: false,
        pickupEventId,
        deliveryStatus: nextStatus,
        pickedUpStagingLocationIds: mergedPicked,
        fullyPicked,
      };
    });
  },
);
