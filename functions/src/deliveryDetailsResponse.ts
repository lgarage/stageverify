import * as admin from "firebase-admin";

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

export interface PublicDeliveryDetails {
  delivery: Record<string, unknown>;
  vendor: { id: string; name: string; createdAt: string };
  items: Record<string, unknown>[];
  job?: Record<string, unknown>;
  purchaseOrder?: Record<string, unknown>;
  stagingLocation?: Record<string, unknown>;
  statusHistory: [];
  pickupEvents: [];
  materialIssues: [];
}

function publicVendorFromDelivery(
  delivery: admin.firestore.DocumentData,
): { id: string; name: string; createdAt: string } {
  return {
    id: String(delivery.vendorId ?? ""),
    name:
      typeof delivery.vendorName === "string" && delivery.vendorName.trim()
        ? delivery.vendorName.trim()
        : "Vendor",
    createdAt: String(delivery.createdAt ?? ""),
  };
}

/** Strip notes and vendorPinVerifier from public vendor receive payloads. */
export function sanitizeDeliveryForPublic(
  deliveryId: string,
  data: admin.firestore.DocumentData,
): Record<string, unknown> {
  const rest = { ...data };
  delete rest.notes;
  delete rest.vendorPinVerifier;
  return { ...rest, id: String(data.id ?? deliveryId) };
}

export async function hydratePublicDeliveryDetails(
  db: admin.firestore.Firestore,
  deliveryId: string,
): Promise<PublicDeliveryDetails | null> {
  const deliverySnap = await db.collection("deliveries").doc(deliveryId).get();
  if (!deliverySnap.exists) return null;
  const deliveryData = deliverySnap.data() as admin.firestore.DocumentData;

  const [jobSnap, poSnap, locSnap, itemsSnap] = await Promise.all([
    db.collection("jobs").doc(String(deliveryData.jobId ?? "")).get(),
    deliveryData.purchaseOrderId
      ? db
          .collection("purchaseOrders")
          .doc(String(deliveryData.purchaseOrderId))
          .get()
      : Promise.resolve(null),
    deliveryData.stagingLocationId
      ? db
          .collection("stagingLocations")
          .doc(String(deliveryData.stagingLocationId))
          .get()
      : Promise.resolve(null),
    db
      .collection("items")
      .where("deliveryOrderId", "==", deliveryId)
      .get(),
  ]);

  const items = itemsSnap.docs.map((docSnap) => ({
    ...(docSnap.data() as admin.firestore.DocumentData),
    id: docSnap.id,
  }));

  return {
    delivery: sanitizeDeliveryForPublic(deliveryId, deliveryData),
    vendor: publicVendorFromDelivery(deliveryData),
    items,
    job: jobSnap?.exists ? { ...(jobSnap.data() as object), id: jobSnap.id } : undefined,
    purchaseOrder: poSnap?.exists
      ? { ...(poSnap.data() as object), id: poSnap.id }
      : undefined,
    stagingLocation: locSnap?.exists
      ? { ...(locSnap.data() as object), id: locSnap.id }
      : undefined,
    statusHistory: [],
    pickupEvents: [],
    materialIssues: [],
  };
}

export const PICKUP_PORTAL_DELIVERY_STATUSES: DeliveryStatus[] = [
  "ready_for_pickup",
  "picked_up",
  "installed",
];

export const PICKUP_PORTAL_NOT_READY_DETAIL_STATUSES: DeliveryStatus[] = [
  "partial",
  "arrived",
];

export const RECEIVE_BLOCKED_DELIVERY_STATUSES = new Set<DeliveryStatus>([
  "ready_for_pickup",
  "complete",
  "picked_up",
  "installed",
]);

export const ZONE_CLEARED_DELIVERY_STATUSES = new Set<DeliveryStatus>([
  "picked_up",
  "installed",
]);

export function getAllStagingLocationIds(
  delivery: admin.firestore.DocumentData,
): string[] {
  const ids: string[] = [];
  if (typeof delivery.stagingLocationId === "string" && delivery.stagingLocationId) {
    ids.push(delivery.stagingLocationId);
  }
  const extra = delivery.additionalStagingLocationIds;
  if (Array.isArray(extra)) {
    for (const id of extra) {
      if (typeof id === "string" && id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}
