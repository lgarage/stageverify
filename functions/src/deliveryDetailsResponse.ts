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

/**
 * Allowlisted Vendor Drop-Off hub paint fields after successful PIN auth.
 * Intentionally omits items (progressive hydrate via getVendorReceiveDetails)
 * and all secrets / notes / pin fields.
 */
export interface VendorPinBootstrapPayload {
  deliveryId: string;
  orderNumber?: string;
  vendorInvoiceNumber?: string;
  status?: string;
  invoiceFulfillmentMethod?: string;
  vendorId: string;
  vendorName: string;
  jobId?: string;
  jobName?: string;
  purchaseOrderId?: string;
  poNumber?: string;
  stagingLocationId?: string;
  stagingLocationCode?: string;
  plannedStagingLocationIds?: string[];
  vendorPhysicalDropoffConfirmed?: boolean;
  vendorPhysicalDropoffConfirmedAt?: string;
  itemCount?: number;
  deliveryDate?: string;
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());
  return out.length > 0 ? out : undefined;
}

/**
 * Build hub bootstrap from a delivery already loaded during PIN verify.
 * Parallel job + staging + item count — no notes/secrets.
 */
export async function buildVendorPinBootstrap(
  db: admin.firestore.Firestore,
  deliveryId: string,
  delivery: admin.firestore.DocumentData,
  vendorId: string,
  vendorName: string,
): Promise<VendorPinBootstrapPayload> {
  const jobId = asOptionalString(delivery.jobId);
  const stagingLocationId = asOptionalString(delivery.stagingLocationId);
  const purchaseOrderId = asOptionalString(delivery.purchaseOrderId);

  const [jobSnap, locSnap, poSnap, countSnap] = await Promise.all([
    jobId ? db.collection("jobs").doc(jobId).get() : Promise.resolve(null),
    stagingLocationId
      ? db.collection("stagingLocations").doc(stagingLocationId).get()
      : Promise.resolve(null),
    purchaseOrderId
      ? db.collection("purchaseOrders").doc(purchaseOrderId).get()
      : Promise.resolve(null),
    db
      .collection("items")
      .where("deliveryOrderId", "==", deliveryId)
      .count()
      .get()
      .catch(() => null),
  ]);

  const jobName = jobSnap?.exists
    ? asOptionalString((jobSnap.data() as { jobName?: unknown }).jobName)
    : undefined;
  const stagingLocationCode = locSnap?.exists
    ? asOptionalString((locSnap.data() as { code?: unknown }).code)
    : undefined;
  const poNumber = poSnap?.exists
    ? asOptionalString((poSnap.data() as { poNumber?: unknown }).poNumber)
    : undefined;

  let itemCount: number | undefined;
  if (countSnap) {
    const n = countSnap.data().count;
    if (typeof n === "number" && Number.isFinite(n)) itemCount = n;
  }

  return {
    deliveryId,
    orderNumber: asOptionalString(delivery.orderNumber),
    vendorInvoiceNumber: asOptionalString(delivery.vendorInvoiceNumber),
    status: asOptionalString(delivery.status),
    invoiceFulfillmentMethod: asOptionalString(
      delivery.invoiceFulfillmentMethod,
    ),
    vendorId,
    vendorName,
    jobId,
    jobName,
    purchaseOrderId,
    poNumber,
    stagingLocationId,
    stagingLocationCode,
    plannedStagingLocationIds: asOptionalStringArray(
      delivery.plannedStagingLocationIds,
    ),
    vendorPhysicalDropoffConfirmed:
      delivery.vendorPhysicalDropoffConfirmed === true ? true : undefined,
    vendorPhysicalDropoffConfirmedAt: asOptionalString(
      delivery.vendorPhysicalDropoffConfirmedAt,
    ),
    itemCount,
    deliveryDate: asOptionalString(delivery.deliveryDate),
  };
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
  "complete",
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
