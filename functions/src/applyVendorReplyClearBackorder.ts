/**
 * Dispatcher confirm: clear backorder lines after vendor reply (Needs Review → Handle arrival).
 * Branch A: assign shop staging. Branch B: will-call pickup at vendor.
 */
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { applyDeliveryReadinessTransaction } from "./applyDeliveryReadiness";
import { requireDispatcherAuth } from "./inboundEmail/dispatcherAuth";
import {
  resolvePickupMaterialIssueReadback,
  type PickupMaterialIssueReadback,
} from "./pickupMaterialIssueReadback";
import { buildWillCallActiveStagingClearPatch } from "./invoice/clearActiveStagingOnWillCall";

function getDb() {
  return admin.firestore();
}

const OPEN_ISSUE_STATUSES = ["open", "assigned"] as const;
const MAX_NOTE_LEN = 500;
const MAX_EVENT_ID_LEN = 256;
const MAX_STAGING_ID_LEN = 128;

type ApplyAction = "shop_location" | "pickup_at_vendor";

interface ApplyVendorReplyClearBackorderRequest {
  eventId?: string;
  action?: string;
  stagingLocationId?: string;
  dispatcherApplyNote?: string;
}

type ItemStatus =
  | "pending"
  | "partial"
  | "received"
  | "missing"
  | "damaged"
  | "backordered";

interface ItemDocRow {
  deliveryOrderId?: string;
  qtyOrdered?: number;
  qtyReceived?: number;
  qtyDamaged?: number;
  qtyBackordered?: number;
  status?: string;
}

function asNonEmptyString(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLen) return null;
  return trimmed;
}

function asApplyAction(value: unknown): ApplyAction | null {
  if (value === "shop_location" || value === "pickup_at_vendor") {
    return value;
  }
  return null;
}

function isBlockingType(type: string): boolean {
  return type !== "other" && type !== "running_low";
}

function deriveItemStatusAfterClearBo(item: ItemDocRow): ItemStatus {
  const qtyOrdered = item.qtyOrdered ?? 0;
  const qtyReceived = item.qtyReceived ?? 0;
  const qtyDamaged = item.qtyDamaged ?? 0;
  if (qtyDamaged > 0) return "damaged";
  if (qtyReceived >= qtyOrdered) return "received";
  if (qtyReceived > 0) return "partial";
  return "pending";
}

function deliveryUsesStagingLocation(
  delivery: admin.firestore.DocumentData,
  locationId: string,
): boolean {
  if (delivery.stagingLocationId === locationId) return true;
  const extra = delivery.additionalStagingLocationIds;
  return Array.isArray(extra) && extra.includes(locationId);
}

async function assertStagingLocationAvailableInTransaction(
  tx: admin.firestore.Transaction,
  db: admin.firestore.Firestore,
  locationId: string,
  deliveryId: string,
): Promise<string> {
  const locRef = db.collection("stagingLocations").doc(locationId);
  const locSnap = await tx.get(locRef);
  if (!locSnap.exists) {
    throw new HttpsError("not-found", "Staging location not found.");
  }
  const code = String(locSnap.data()?.code ?? "").trim();
  const occupiedSnap = await tx.get(
    db
      .collection("deliveries")
      .where("stagingLocationId", "==", locationId)
      .limit(5),
  );
  for (const doc of occupiedSnap.docs) {
    if (doc.id !== deliveryId) {
      throw new HttpsError(
        "failed-precondition",
        "Staging location is occupied by another delivery.",
      );
    }
  }
  return code || locationId;
}

export const applyVendorReplyClearBackorder = onCall(
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
    const data = (request.data ?? {}) as ApplyVendorReplyClearBackorderRequest;
    const eventId = asNonEmptyString(data.eventId, MAX_EVENT_ID_LEN);
    const action = asApplyAction(data.action);
    const stagingLocationId = asNonEmptyString(
      data.stagingLocationId,
      MAX_STAGING_ID_LEN,
    );
    const dispatcherApplyNote =
      typeof data.dispatcherApplyNote === "string"
        ? data.dispatcherApplyNote.trim().slice(0, MAX_NOTE_LEN)
        : "";

    if (!eventId || !action) {
      throw new HttpsError(
        "invalid-argument",
        "eventId and action (shop_location | pickup_at_vendor) are required.",
      );
    }
    if (action === "shop_location" && !stagingLocationId) {
      throw new HttpsError(
        "invalid-argument",
        "stagingLocationId is required for shop_location.",
      );
    }

    const db = getDb();
    const eventRef = db.collection("vendorEmailEvents").doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) {
      throw new HttpsError("not-found", "Vendor email event not found.");
    }

    const eventRow = eventSnap.data() as {
      reviewStatus?: string;
      direction?: string;
      deliveryOrderId?: string;
    };

    if (eventRow.reviewStatus === "approved") {
      throw new HttpsError(
        "failed-precondition",
        "This vendor reply was already handled.",
      );
    }
    if (eventRow.reviewStatus !== "pending_review") {
      throw new HttpsError(
        "failed-precondition",
        "Only pending_review events can be handled.",
      );
    }
    if ((eventRow.direction ?? "inbound") !== "inbound") {
      throw new HttpsError(
        "failed-precondition",
        "Only inbound events can be handled from Needs Review.",
      );
    }

    const deliveryOrderId = eventRow.deliveryOrderId?.trim();
    if (!deliveryOrderId) {
      throw new HttpsError(
        "failed-precondition",
        "Event is not linked to a delivery.",
      );
    }

    const deliveryRef = db.collection("deliveries").doc(deliveryOrderId);
    const itemsSnap = await db
      .collection("items")
      .where("deliveryOrderId", "==", deliveryOrderId)
      .limit(501)
      .get();

    const backorderItemDocs = itemsSnap.docs.filter(
      (docSnap) => (docSnap.data().qtyBackordered ?? 0) > 0,
    );
    if (backorderItemDocs.length === 0) {
      throw new HttpsError(
        "failed-precondition",
        "Delivery has no backordered line items to clear.",
      );
    }

    const issuesSnap = await db
      .collection("materialIssues")
      .where("deliveryOrderId", "==", deliveryOrderId)
      .where("status", "in", [...OPEN_ISSUE_STATUSES])
      .get();
    const backorderIssues = issuesSnap.docs.filter(
      (docSnap) => String(docSnap.data().type ?? "") === "backordered",
    );

    let stagingCode: string | undefined;

    const appliedBy =
      request.auth?.token.email?.trim() ||
      request.auth?.token.name?.trim() ||
      uid;
    const now = new Date().toISOString();
    const resolutionType =
      action === "shop_location" ? "vendor_redeliver" : "pick_up_supply_house";
    const resolutionNote =
      dispatcherApplyNote ||
      (action === "shop_location"
        ? "Backorder cleared — assign shop staging for vendor redelivery"
        : "Backorder cleared — pickup at vendor (will-call)");

    await db.runTransaction(async (tx) => {
      const liveEvent = await tx.get(eventRef);
      if (!liveEvent.exists) {
        throw new HttpsError("not-found", "Vendor email event not found.");
      }
      const liveEventData = liveEvent.data() as { reviewStatus?: string };
      if (liveEventData.reviewStatus === "approved") {
        throw new HttpsError(
          "failed-precondition",
          "This vendor reply was already handled.",
        );
      }
      if (liveEventData.reviewStatus !== "pending_review") {
        throw new HttpsError(
          "failed-precondition",
          "Only pending_review events can be handled.",
        );
      }

      const liveDelivery = await tx.get(deliveryRef);
      if (!liveDelivery.exists) {
        throw new HttpsError("not-found", "Delivery not found.");
      }
      const delivery = liveDelivery.data() as admin.firestore.DocumentData;

      if (action === "shop_location" && stagingLocationId) {
        if (!deliveryUsesStagingLocation(delivery, stagingLocationId)) {
          stagingCode = await assertStagingLocationAvailableInTransaction(
            tx,
            db,
            stagingLocationId,
            deliveryOrderId,
          );
        } else {
          const locSnap = await tx.get(
            db.collection("stagingLocations").doc(stagingLocationId),
          );
          if (locSnap.exists) {
            stagingCode =
              String(locSnap.data()?.code ?? "").trim() || stagingLocationId;
          }
        }
      }

      const itemSnaps = await Promise.all(
        backorderItemDocs.map((itemDoc) => tx.get(itemDoc.ref)),
      );
      const issueSnaps = await Promise.all(
        backorderIssues.map((issueDoc) => tx.get(issueDoc.ref)),
      );

      let openIssueCount = delivery.openIssueCount ?? 0;
      let openBlockingIssueCount = delivery.openBlockingIssueCount ?? 0;
      let pickupMaterialIssues = (delivery.pickupMaterialIssues ??
        []) as PickupMaterialIssueReadback[];

      for (let i = 0; i < backorderItemDocs.length; i += 1) {
        const itemDoc = backorderItemDocs[i];
        const liveItem = itemSnaps[i];
        if (!liveItem?.exists) continue;
        const item = liveItem.data() as ItemDocRow;
        if ((item.qtyBackordered ?? 0) <= 0) continue;
        const nextItem: ItemDocRow = {
          ...item,
          qtyBackordered: 0,
        };
        tx.update(itemDoc.ref, {
          qtyBackordered: 0,
          status: deriveItemStatusAfterClearBo(nextItem),
          updatedAt: now,
        });
      }

      for (let i = 0; i < backorderIssues.length; i += 1) {
        const issueDoc = backorderIssues[i];
        const liveIssue = issueSnaps[i];
        if (!liveIssue?.exists) continue;
        const issue = liveIssue.data() as {
          status?: string;
          type?: string;
          blocking?: boolean;
        };
        if (
          !OPEN_ISSUE_STATUSES.includes(
            issue.status as (typeof OPEN_ISSUE_STATUSES)[number],
          )
        ) {
          continue;
        }
        if (String(issue.type ?? "") !== "backordered") continue;

        const blocking = issue.blocking === true || isBlockingType("backordered");
        tx.update(issueDoc.ref, {
          status: "resolved",
          resolutionType,
          resolutionNote,
          resolvedAt: now,
          resolvedBy: appliedBy,
          updatedAt: now,
        });
        openIssueCount = Math.max(0, openIssueCount - 1);
        if (blocking) {
          openBlockingIssueCount = Math.max(0, openBlockingIssueCount - 1);
        }
        pickupMaterialIssues = resolvePickupMaterialIssueReadback(
          pickupMaterialIssues,
          issueDoc.id,
          { resolutionType, resolutionNote, resolvedAt: now },
        );
      }

      const deliveryPatch: Record<string, unknown> = {
        openIssueCount,
        openBlockingIssueCount,
        pickupMaterialIssues,
        updatedAt: now,
      };

      if (action === "shop_location" && stagingLocationId) {
        deliveryPatch.stagingLocationId = stagingLocationId;
      } else if (action === "pickup_at_vendor") {
        deliveryPatch.invoiceFulfillmentMethod = "will_call_pickup";
        deliveryPatch.invoiceImportStatus = "pickup_at_vendor";
        // Full active staging release (planned + actual + combination) in same tx.
        const clear = buildWillCallActiveStagingClearPatch(delivery, {
          releasedBy: "dispatcher",
          releasedAt: now,
        });
        Object.assign(deliveryPatch, clear.fields);
        if (clear.releaseEntries.length > 0) {
          deliveryPatch.plannedLocationReleases =
            admin.firestore.FieldValue.arrayUnion(...clear.releaseEntries);
        }
      }

      tx.update(deliveryRef, deliveryPatch);

      tx.update(eventRef, {
        reviewStatus: "approved",
        appliedAt: now,
        appliedBy,
        applyAction: action,
        ...(stagingCode ? { stagingCode } : {}),
        ...(dispatcherApplyNote ? { dispatcherApplyNote } : {}),
        updatedAt: now,
      });
    });

    let readinessRecalculated = false;
    try {
      await applyDeliveryReadinessTransaction(db, deliveryOrderId, {
        historyReason: "Handle arrival — backorder cleared",
      });
      readinessRecalculated = true;
    } catch {
      readinessRecalculated = false;
    }

    return {
      ok: true,
      eventId,
      deliveryOrderId,
      action,
      stagingLocationId: stagingLocationId ?? null,
      stagingCode: stagingCode ?? null,
      clearedBackorderLineCount: backorderItemDocs.length,
      resolvedBackorderIssueCount: backorderIssues.length,
      readinessRecalculated,
    };
  },
);
