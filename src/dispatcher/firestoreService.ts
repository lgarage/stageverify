import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
  query,
  where,
  limit,
} from "firebase/firestore";
import { db } from "../firebase";
import type {
  DeliveryDetails,
  DeliveryListRow,
  DeliveryOrder,
  DeliveryStatus,
  Item,
  ItemStatus,
  Job,
  PickupEvent,
  PurchaseOrder,
  StagingLocation,
  StatusHistoryEvent,
  Vendor,
  AppSettings,
} from "./models";
import {
  getAllStagingLocationIds,
  isLocationActive,
  parseStagingLocation,
  RECEIVE_BLOCKED_DELIVERY_STATUSES,
  ZONE_CLEARED_DELIVERY_STATUSES,
} from "./models";
import { findStagingLocationByCode, normalizeStagingCodeKey } from "./stagingCode";
import type {
  DeliveryQuery,
  DeliverySortField,
  DispatcherDataService,
  PagedResult,
  SortDirection,
} from "./service";
import { VALID_TRANSITIONS, VENDOR_REVERT_TARGETS, DISPATCHER_REVERT_TARGETS } from "./service";
import {
  StagingLocationOccupiedError,
  deliveryUsesStagingLocation,
} from "./stagingOccupancy";

export {
  StagingLocationOccupiedError,
  deliveryUsesStagingLocation,
  isStagingLocationOccupiedError,
} from "./stagingOccupancy";

const COLLECTION_SAFETY_LIMIT = 500;

/** Short TTL cache so back-to-back zone QR scans do not re-download full collections. */
const SCAN_LOOKUP_CACHE_MS = 60_000;
let scanLookupCache: {
  at: number;
  locations: StagingLocation[];
  deliveries: DeliveryOrder[];
} | null = null;

async function fetchScanLookupData(): Promise<{
  locations: StagingLocation[];
  deliveries: DeliveryOrder[];
}> {
  const now = Date.now();
  if (
    scanLookupCache &&
    now - scanLookupCache.at < SCAN_LOOKUP_CACHE_MS
  ) {
    return {
      locations: scanLookupCache.locations,
      deliveries: scanLookupCache.deliveries,
    };
  }
  const [locations, deliveries] = await Promise.all([
    fetchAllStagingLocations(),
    fetchAll<DeliveryOrder>("deliveries"),
  ]);
  scanLookupCache = { at: now, locations, deliveries };
  return { locations, deliveries };
}

async function fetchAllStagingLocations(): Promise<StagingLocation[]> {
  const snap = await getDocs(
    query(collection(db, "stagingLocations"), limit(COLLECTION_SAFETY_LIMIT)),
  );
  return snap.docs.map((d) =>
    parseStagingLocation(d.id, d.data() as Record<string, unknown>),
  );
}

function stagingLocationFromSnap(
  snap: Awaited<ReturnType<typeof getDoc>>,
): StagingLocation | undefined {
  if (!snap.exists()) return undefined;
  return parseStagingLocation(snap.id, snap.data() as Record<string, unknown>);
}

async function fetchAll<T>(colName: string): Promise<T[]> {
  const snap = await getDocs(query(collection(db, colName), limit(COLLECTION_SAFETY_LIMIT)));
  return snap.docs.map((d) => d.data() as T);
}

async function fetchWhere<T>(
  colName: string,
  field: string,
  value: string,
): Promise<T[]> {
  const snap = await getDocs(
    query(collection(db, colName), where(field, "==", value)),
  );
  return snap.docs.map((d) => d.data() as T);
}

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 25;

const compareText = (
  a: string,
  b: string,
  direction: SortDirection,
): number => {
  const result = a.localeCompare(b, undefined, {
    sensitivity: "base",
    numeric: true,
  });
  return direction === "asc" ? result : result * -1;
};

const safe = (value?: string): string => value ?? "";

const sortRows = (
  rows: DeliveryListRow[],
  sortBy: DeliverySortField,
  sortDirection: SortDirection,
): DeliveryListRow[] => {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    switch (sortBy) {
      case "deliveryDate":
        return compareText(a.deliveryDate, b.deliveryDate, sortDirection);
      case "status":
        return compareText(a.status, b.status, sortDirection);
      case "jobNumber":
        return compareText(a.jobNumber, b.jobNumber, sortDirection);
      case "jobName":
        return compareText(a.jobName, b.jobName, sortDirection);
      case "poNumber":
        return compareText(safe(a.poNumber), safe(b.poNumber), sortDirection);
      case "orderNumber":
        return compareText(a.orderNumber, b.orderNumber, sortDirection);
      case "vendorName":
        return compareText(a.vendorName, b.vendorName, sortDirection);
      case "stagingLocationCode":
        return compareText(
          safe(a.stagingLocationCode),
          safe(b.stagingLocationCode),
          sortDirection,
        );
      case "itemsReceivedLabel":
        return compareText(
          a.itemsReceivedLabel,
          b.itemsReceivedLabel,
          sortDirection,
        );
      case "issueSummary":
        return compareText(a.issueSummary, b.issueSummary, sortDirection);
      default:
        return 0;
    }
  });
  return sorted;
};

const asPagedResult = <T>(
  allItems: T[],
  page: number,
  pageSize: number,
): PagedResult<T> => {
  const safePage = Math.max(DEFAULT_PAGE, page);
  const safePageSize = Math.max(1, pageSize);
  const totalItems = allItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const boundedPage = Math.min(safePage, totalPages);
  const start = (boundedPage - 1) * safePageSize;
  const end = start + safePageSize;

  return {
    items: allItems.slice(start, end),
    page: boundedPage,
    pageSize: safePageSize,
    totalItems,
    totalPages,
  };
};

const includesSearch = (row: DeliveryListRow, search: string): boolean => {
  const normalized = search.trim().toLowerCase();
  if (!normalized) return true;
  return [
    row.jobNumber,
    row.jobName,
    row.poNumber,
    row.orderNumber,
    row.vendorName,
    row.stagingLocationCode,
  ].some((value) => safe(value).toLowerCase().includes(normalized));
};

function computeItemStatus(update: {
  qtyReceived: number;
  qtyMissing: number;
  qtyDamaged: number;
  qtyOrdered: number;
}): ItemStatus {
  if (update.qtyReceived === update.qtyOrdered) return "received";
  if (update.qtyReceived > 0) return "partial";
  if (update.qtyDamaged > 0) return "damaged";
  return "missing";
}

export class FirestoreDataService implements DispatcherDataService {
  async listDeliveries(
    q: DeliveryQuery = {},
  ): Promise<PagedResult<DeliveryListRow>> {
    const sortBy = q.sortBy ?? "deliveryDate";
    const sortDirection = q.sortDirection ?? "desc";
    const page = q.page ?? DEFAULT_PAGE;
    const pageSize = q.pageSize ?? DEFAULT_PAGE_SIZE;

    const deliveriesPromise = q.jobId
      ? fetchWhere<DeliveryOrder>("deliveries", "jobId", q.jobId)
      : fetchAll<DeliveryOrder>("deliveries");

    const [deliveries, allJobs, allVendors, allLocations, allPOs, allItems] =
      await Promise.all([
        deliveriesPromise,
        fetchAll<Job>("jobs"),
        fetchAll<Vendor>("vendors"),
        fetchAllStagingLocations(),
        fetchAll<PurchaseOrder>("purchaseOrders"),
        fetchAll<Item>("items"),
      ]);

    const rows: DeliveryListRow[] = [];
    for (const delivery of deliveries) {
      const job = allJobs.find((j) => j.id === delivery.jobId);
      const vendor = allVendors.find((v) => v.id === delivery.vendorId);
      if (!job || !vendor) continue;

      const po = delivery.purchaseOrderId
        ? allPOs.find((p) => p.id === delivery.purchaseOrderId)
        : undefined;
      const loc = delivery.stagingLocationId
        ? allLocations.find((l) => l.id === delivery.stagingLocationId)
        : undefined;

      const lineItems = allItems.filter(
        (i) => i.deliveryOrderId === delivery.id,
      );
      const ordered = lineItems.reduce((sum, i) => sum + i.qtyOrdered, 0);
      const received = lineItems.reduce((sum, i) => sum + i.qtyReceived, 0);

      rows.push({
        deliveryId: delivery.id,
        status: delivery.status,
        jobNumber: job.jobNumber,
        jobName: job.jobName,
        poNumber: po?.poNumber,
        orderNumber: delivery.orderNumber,
        vendorName: vendor.name,
        deliveryDate: delivery.deliveryDate,
        stagingLocationCode: loc?.code,
        itemsReceivedLabel: `${received}/${ordered}`,
        issueSummary: delivery.issueSummary ?? "",
      });
    }

    const filtered = rows.filter((row) => {
      if (q.statuses?.length && !q.statuses.includes(row.status)) return false;
      if (q.search && !includesSearch(row, q.search)) return false;
      return true;
    });

    const sorted = sortRows(filtered, sortBy, sortDirection);
    return asPagedResult(sorted, page, pageSize);
  }

  async getDeliveryDetails(
    deliveryId: string,
  ): Promise<DeliveryDetails | null> {
    const deliverySnap = await getDoc(doc(db, "deliveries", deliveryId));
    if (!deliverySnap.exists()) return null;
    const delivery = deliverySnap.data() as DeliveryOrder;

    const jobSnap = await getDoc(doc(db, "jobs", delivery.jobId));
    const vendorSnap = await getDoc(doc(db, "vendors", delivery.vendorId));
    if (!jobSnap.exists() || !vendorSnap.exists()) return null;

    const job = jobSnap.data() as Job;
    const vendor = vendorSnap.data() as Vendor;

    let purchaseOrder: PurchaseOrder | undefined;
    if (delivery.purchaseOrderId) {
      const poSnap = await getDoc(
        doc(db, "purchaseOrders", delivery.purchaseOrderId),
      );
      if (poSnap.exists()) purchaseOrder = poSnap.data() as PurchaseOrder;
    }

    let stagingLocation: StagingLocation | undefined;
    if (delivery.stagingLocationId) {
      const locSnap = await getDoc(
        doc(db, "stagingLocations", delivery.stagingLocationId),
      );
      stagingLocation = stagingLocationFromSnap(locSnap);
    }

    const items = await fetchWhere<Item>("items", "deliveryOrderId", deliveryId);
    const statusHistoryEvents = await fetchWhere<StatusHistoryEvent>(
      "statusHistory",
      "entityId",
      deliveryId,
    );
    const pickupEvents = await fetchWhere<PickupEvent>(
      "pickupEvents",
      "deliveryOrderId",
      deliveryId,
    );

    return {
      delivery,
      job,
      vendor,
      purchaseOrder,
      stagingLocation,
      items,
      statusHistory: statusHistoryEvents,
      pickupEvents,
    };
  }

  async updateDeliveryStatus(
    deliveryId: string,
    toStatus: DeliveryStatus,
    reason?: string,
    actorType: "dispatcher" | "technician" | "vendor" = "dispatcher",
    actorName?: string,
  ): Promise<DeliveryDetails | null> {
    const deliverySnap = await getDoc(doc(db, "deliveries", deliveryId));
    if (!deliverySnap.exists()) return null;
    const delivery = deliverySnap.data() as DeliveryOrder;

    const fromStatus = delivery.status;
    if (!VALID_TRANSITIONS[fromStatus]?.includes(toStatus)) {
      if (actorType === "technician") return null;
      return this.getDeliveryDetails(deliveryId);
    }

    const now = new Date().toISOString();
    const eventId = `event-${crypto.randomUUID()}`;
    const batch = writeBatch(db);

    const updatedFields: Partial<DeliveryOrder> = {
      status: toStatus,
      updatedAt: now,
    };
    if (toStatus === "issue" && reason) {
      updatedFields.issueSummary = reason;
    } else if (fromStatus === "issue") {
      updatedFields.issueSummary = "";
    }
    if (toStatus === "picked_up") {
      updatedFields.stagingLocationId = "";
    }

    batch.update(doc(db, "deliveries", deliveryId), updatedFields);
    batch.set(doc(db, "statusHistory", eventId), {
      id: eventId,
      entityType: "delivery_order",
      entityId: deliveryId,
      fromStatus,
      toStatus,
      reason: reason ?? null,
      actorType,
      actorName:
        actorName ??
        (actorType === "technician"
          ? "Technician"
          : actorType === "vendor"
            ? "Vendor Driver"
            : "Dispatcher"),
      createdAt: now,
    });

    await batch.commit();
    if (actorType === "technician") return null;
    if (actorType === "vendor") {
      return getDeliveryDetailsPublic(deliveryId);
    }
    return this.getDeliveryDetails(deliveryId);
  }

  async updateIssueSummary(
    deliveryId: string,
    summary: string,
  ): Promise<DeliveryDetails | null> {
    const deliverySnap = await getDoc(doc(db, "deliveries", deliveryId));
    if (!deliverySnap.exists()) return null;

    const now = new Date().toISOString();
    const eventId = `event-${crypto.randomUUID()}`;
    const batch = writeBatch(db);

    batch.update(doc(db, "deliveries", deliveryId), {
      issueSummary: summary,
      updatedAt: now,
    });
    batch.set(doc(db, "statusHistory", eventId), {
      id: eventId,
      entityType: "delivery_order",
      entityId: deliveryId,
      fromStatus: "issue",
      toStatus: "issue",
      reason: summary,
      actorType: "dispatcher",
      actorName: "Dispatcher",
      createdAt: now,
    });

    await batch.commit();
    return this.getDeliveryDetails(deliveryId);
  }

  async listStagingLocations(): Promise<StagingLocation[]> {
    const all = await fetchAllStagingLocations();
    return all.filter((loc) => isLocationActive(loc));
  }

  async updateStagingLocation(
    deliveryId: string,
    stagingLocationId: string | null,
  ): Promise<DeliveryDetails | null> {
    const deliverySnap = await getDoc(doc(db, "deliveries", deliveryId));
    if (!deliverySnap.exists()) return null;
    const delivery = deliverySnap.data() as DeliveryOrder;

    const prevId = delivery.stagingLocationId;
    let prevCode = "unassigned";
    if (prevId) {
      const prevSnap = await getDoc(doc(db, "stagingLocations", prevId));
      const prevLoc = stagingLocationFromSnap(prevSnap);
      if (prevLoc) prevCode = prevLoc.code;
    }

    let newCode = "unassigned";
    if (stagingLocationId) {
      const newSnap = await getDoc(
        doc(db, "stagingLocations", stagingLocationId),
      );
      const newLoc = stagingLocationFromSnap(newSnap);
      if (newLoc) newCode = newLoc.code;
      if (!deliveryUsesStagingLocation(delivery, stagingLocationId)) {
        await assertStagingLocationAvailable(stagingLocationId, deliveryId);
      }
    }

    const now = new Date().toISOString();
    const eventId = `event-${crypto.randomUUID()}`;
    const batch = writeBatch(db);

    batch.update(doc(db, "deliveries", deliveryId), {
      stagingLocationId: stagingLocationId ?? "",
      updatedAt: now,
    });
    batch.set(doc(db, "statusHistory", eventId), {
      id: eventId,
      entityType: "delivery_order",
      entityId: deliveryId,
      fromStatus: prevCode,
      toStatus: newCode,
      reason: "Staging location updated",
      actorType: "dispatcher",
      actorName: "Dispatcher",
      createdAt: now,
    });

    await batch.commit();
    return this.getDeliveryDetails(deliveryId);
  }

  async updateShopStockPickList(
    deliveryId: string,
    items: string[],
    locationNote: string,
  ): Promise<DeliveryDetails | null> {
    const deliverySnap = await getDoc(doc(db, "deliveries", deliveryId));
    if (!deliverySnap.exists()) return null;
    const delivery = deliverySnap.data() as DeliveryOrder;
    if (delivery.status === "picked_up" || delivery.status === "installed") {
      return null;
    }

    const now = new Date().toISOString();
    const trimmedNote = locationNote.trim();

    await setDoc(
      doc(db, "deliveries", deliveryId),
      {
        shopStockPickListItems: items,
        shopStockLocationNote: trimmedNote,
        updatedAt: now,
      },
      { merge: true },
    );
    return this.getDeliveryDetails(deliveryId);
  }

  async updatePurchaseOrder(
    deliveryId: string,
    poNumber: string,
  ): Promise<DeliveryDetails | null> {
    const deliverySnap = await getDoc(doc(db, "deliveries", deliveryId));
    if (!deliverySnap.exists()) return null;
    const delivery = deliverySnap.data() as DeliveryOrder;

    const now = new Date().toISOString();

    if (poNumber.trim()) {
      if (delivery.purchaseOrderId) {
        await setDoc(
          doc(db, "purchaseOrders", delivery.purchaseOrderId),
          { poNumber: poNumber.trim() },
          { merge: true },
        );
      } else {
        const newPoId = `po-${crypto.randomUUID()}`;
        await setDoc(doc(db, "purchaseOrders", newPoId), {
          id: newPoId,
          poNumber: poNumber.trim(),
          jobId: delivery.jobId,
          vendorId: delivery.vendorId,
          orderDate: now.slice(0, 10),
          status: "open",
        });
        await setDoc(
          doc(db, "deliveries", deliveryId),
          { purchaseOrderId: newPoId, updatedAt: now },
          { merge: true },
        );
        return this.getDeliveryDetails(deliveryId);
      }
    } else {
      await setDoc(
        doc(db, "deliveries", deliveryId),
        { purchaseOrderId: "", updatedAt: now },
        { merge: true },
      );
      return this.getDeliveryDetails(deliveryId);
    }

    await setDoc(
      doc(db, "deliveries", deliveryId),
      { updatedAt: now },
      { merge: true },
    );
    return this.getDeliveryDetails(deliveryId);
  }

  async submitCheckin(
    deliveryId: string,
    driverName: string,
    itemUpdates: Array<{
      id: string;
      qtyReceived: number;
      qtyMissing: number;
      qtyDamaged: number;
    }>,
  ): Promise<DeliveryDetails | null> {
    const deliverySnap = await getDoc(doc(db, "deliveries", deliveryId));
    if (!deliverySnap.exists()) return null;
    const delivery = deliverySnap.data() as DeliveryOrder;

    await assertDeliveryStagingLocationsAvailable(delivery);

    const existingItems = await fetchWhere<Item>(
      "items",
      "deliveryOrderId",
      deliveryId,
    );

    const batch = writeBatch(db);

    let allReceived = true;
    for (const update of itemUpdates) {
      const existingItem = existingItems.find((i) => i.id === update.id);
      const qtyOrdered = existingItem?.qtyOrdered ?? 0;
      const status = computeItemStatus({ ...update, qtyOrdered });

      if (update.qtyReceived !== qtyOrdered) allReceived = false;

      batch.update(doc(db, "items", update.id), {
        qtyReceived: update.qtyReceived,
        qtyMissing: update.qtyMissing,
        qtyDamaged: update.qtyDamaged,
        status,
      });
    }

    const overallStatus: DeliveryStatus = allReceived
      ? "ready_for_pickup"
      : "partial";
    const now = new Date().toISOString();
    const eventId = `event-${crypto.randomUUID()}`;

    batch.update(doc(db, "deliveries", deliveryId), {
      status: overallStatus,
      submittedAt: now,
      updatedAt: now,
    });
    batch.set(doc(db, "statusHistory", eventId), {
      id: eventId,
      entityType: "delivery_order",
      entityId: deliveryId,
      fromStatus: delivery.status,
      toStatus: overallStatus,
      actorType: "vendor",
      actorName: driverName || "Vendor Driver",
      createdAt: now,
    });

    await batch.commit();
    return this.getDeliveryDetails(deliveryId);
  }

  async revertDeliveryStatus(
    deliveryId: string,
    actorType: "vendor" | "dispatcher",
    vendorRevertWindowMinutes = 60,
  ): Promise<DeliveryDetails | null> {
    const deliverySnap = await getDoc(doc(db, "deliveries", deliveryId));
    if (!deliverySnap.exists()) return null;
    const delivery = deliverySnap.data() as DeliveryOrder;

    const revertTargets =
      actorType === "vendor" ? VENDOR_REVERT_TARGETS : DISPATCHER_REVERT_TARGETS;
    const toStatus = revertTargets[delivery.status];
    if (!toStatus) return this.getDeliveryDetails(deliveryId);

    if (actorType === "vendor") {
      const submittedAt = delivery.submittedAt;
      if (!submittedAt) return this.getDeliveryDetails(deliveryId);
      const elapsedMs = Date.now() - new Date(submittedAt).getTime();
      if (elapsedMs > vendorRevertWindowMinutes * 60 * 1000) {
        return this.getDeliveryDetails(deliveryId);
      }
    }

    const now = new Date().toISOString();
    const eventId = `event-${crypto.randomUUID()}`;
    const batch = writeBatch(db);

    batch.update(doc(db, "deliveries", deliveryId), {
      status: toStatus,
      submittedAt: toStatus === "arrived" ? null : delivery.submittedAt,
      updatedAt: now,
    });
    batch.set(doc(db, "statusHistory", eventId), {
      id: eventId,
      entityType: "delivery_order",
      entityId: deliveryId,
      fromStatus: delivery.status,
      toStatus,
      reason: "Reverted",
      actorType,
      actorName: actorType === "dispatcher" ? "Dispatcher" : "Vendor",
      createdAt: now,
    });

    await batch.commit();
    return this.getDeliveryDetails(deliveryId);
  }

  async updateItemQty(
    deliveryId: string,
    itemId: string,
    qtyOrdered: number,
    qtyReceived: number,
    qtyMissing: number,
  ): Promise<void> {
    const now = new Date().toISOString();
    let itemStatus: ItemStatus = "missing";
    if (qtyReceived >= qtyOrdered) itemStatus = "received";
    else if (qtyReceived > 0) itemStatus = "partial";

    const batch = writeBatch(db);
    batch.update(doc(db, "items", itemId), {
      qtyReceived,
      qtyMissing,
      status: itemStatus,
    });
    batch.update(doc(db, "deliveries", deliveryId), {
      lastCheckmarkAt: now,
      updatedAt: now,
    });
    await batch.commit();
  }

  async recordPickupEvent(
    deliveryId: string,
    technicianName: string,
    itemsPickedSummary: string,
    notes?: string,
  ): Promise<void> {
    const deliverySnap = await getDoc(doc(db, "deliveries", deliveryId));
    if (!deliverySnap.exists()) {
      throw new Error("Delivery not found");
    }
    const delivery = deliverySnap.data() as DeliveryOrder;

    if (
      delivery.status === "picked_up" ||
      delivery.status === "installed"
    ) {
      return;
    }

    if (!VALID_TRANSITIONS[delivery.status]?.includes("picked_up")) {
      throw new Error(
        `Cannot record pickup while delivery status is "${delivery.status}"`,
      );
    }

    const eventId = crypto.randomUUID();
    const historyId = `event-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const trimmedNotes = notes?.trim();

    const pickupEvent: PickupEvent = {
      id: eventId,
      deliveryOrderId: deliveryId,
      jobId: delivery.jobId,
      technicianName,
      pickedUpAt: now,
      itemsPickedSummary,
      ...(trimmedNotes ? { notes: trimmedNotes } : {}),
    };

    const batch = writeBatch(db);
    batch.set(doc(db, "pickupEvents", eventId), pickupEvent);
    batch.update(doc(db, "deliveries", deliveryId), {
      status: "picked_up",
      updatedAt: now,
      stagingLocationId: "",
    });
    batch.set(doc(db, "statusHistory", historyId), {
      id: historyId,
      entityType: "delivery_order",
      entityId: deliveryId,
      fromStatus: delivery.status,
      toStatus: "picked_up",
      actorType: "technician",
      actorName: technicianName,
      createdAt: now,
    });

    await batch.commit();
  }
}

const APP_SETTINGS_DOC = doc(db, "appSettings", "config");
const DEFAULT_APP_SETTINGS: AppSettings = {
  vendorRevertWindowMinutes: 60,
  autoSubmitMinutes: 30,
};

export async function getAppSettings(): Promise<AppSettings> {
  const snap = await getDoc(APP_SETTINGS_DOC);
  if (!snap.exists()) return { ...DEFAULT_APP_SETTINGS };
  return { ...DEFAULT_APP_SETTINGS, ...(snap.data() as Partial<AppSettings>) };
}

export async function updateAppSettings(
  settings: Partial<AppSettings>,
): Promise<AppSettings> {
  await setDoc(APP_SETTINGS_DOC, settings, { merge: true });
  return getAppSettings();
}

export const firestoreDataService = new FirestoreDataService();

export async function addStagingLocation(
  deliveryId: string,
  locationId: string,
): Promise<void> {
  const deliverySnap = await getDoc(doc(db, "deliveries", deliveryId));
  if (!deliverySnap.exists()) return;
  const delivery = deliverySnap.data() as DeliveryOrder;

  if (deliveryUsesStagingLocation(delivery, locationId)) return;
  await assertStagingLocationAvailable(locationId, deliveryId);

  const now = new Date().toISOString();
  const eventId = `event-${crypto.randomUUID()}`;
  const batch = writeBatch(db);

  batch.update(doc(db, "deliveries", deliveryId), {
    additionalStagingLocationIds: arrayUnion(locationId),
    updatedAt: now,
  });
  batch.set(doc(db, "statusHistory", eventId), {
    id: eventId,
    entityType: "delivery_order",
    entityId: deliveryId,
    toStatus: "staging_extended",
    reason: `Additional staging location added: ${locationId}`,
    actorType: "vendor",
    actorName: "Vendor",
    createdAt: now,
  });

  await batch.commit();
}

/** Statuses shown on the public pickup portal (no auth / jobs read). */
const PICKUP_PORTAL_DELIVERY_STATUSES: DeliveryStatus[] = [
  "ready_for_pickup",
  "complete",
  "partial",
  "picked_up",
  "installed",
];

export async function loadPickupReadyDeliveriesPublic(
  jobId: string,
): Promise<DeliveryDetails[]> {
  const deliveries = await fetchWhere<DeliveryOrder>(
    "deliveries",
    "jobId",
    jobId,
  );
  const pickupReady = deliveries.filter((d) =>
    PICKUP_PORTAL_DELIVERY_STATUSES.includes(d.status),
  );
  const detailsList = await Promise.all(
    pickupReady.map((d) => getDeliveryDetailsPublic(d.id)),
  );
  return detailsList.filter((d): d is DeliveryDetails => d !== null);
}

type FirestoreDocSnap = Awaited<ReturnType<typeof getDoc>>;

/** Hydrate public delivery details when the delivery doc is already loaded (zone scan path). */
async function hydrateDeliveryDetailsPublic(
  delivery: DeliveryOrder,
): Promise<DeliveryDetails | null> {
  const deliveryId = delivery.id;
  const [vendorSnap, jobSnap, poSnap, locSnap, items] = await Promise.all([
    getDoc(doc(db, "vendors", delivery.vendorId)),
    getDoc(doc(db, "jobs", delivery.jobId)),
    delivery.purchaseOrderId
      ? getDoc(doc(db, "purchaseOrders", delivery.purchaseOrderId))
      : Promise.resolve(null as FirestoreDocSnap | null),
    delivery.stagingLocationId
      ? getDoc(doc(db, "stagingLocations", delivery.stagingLocationId))
      : Promise.resolve(null as FirestoreDocSnap | null),
    fetchWhere<Item>("items", "deliveryOrderId", deliveryId),
  ]);

  if (!vendorSnap.exists()) return null;
  const { contactName: _c, contactPhone: _p, email: _e, ...publicVendor } =
    vendorSnap.data() as Vendor;

  let job: Job | undefined;
  if (jobSnap.exists()) {
    job = jobSnap.data() as Job;
  }

  let purchaseOrder: PurchaseOrder | undefined;
  if (poSnap?.exists()) {
    purchaseOrder = poSnap.data() as PurchaseOrder;
  }

  const stagingLocation = locSnap ? stagingLocationFromSnap(locSnap) : undefined;

  const { notes: _n, ...publicDelivery } = delivery;

  return {
    delivery: publicDelivery as DeliveryOrder,
    job,
    vendor: publicVendor as Vendor,
    purchaseOrder,
    stagingLocation,
    items,
    statusHistory: [],
    pickupEvents: [],
  };
}

export async function getDeliveryDetailsPublic(
  deliveryId: string,
): Promise<DeliveryDetails | null> {
  const deliverySnap = await getDoc(doc(db, "deliveries", deliveryId));
  if (!deliverySnap.exists()) return null;
  const delivery = deliverySnap.data() as DeliveryOrder;
  return hydrateDeliveryDetailsPublic(delivery);
}

export async function getDeliveryByOrderNumber(
  orderNumber: string,
): Promise<DeliveryDetails | null> {
  const matches = await fetchWhere<DeliveryOrder>(
    "deliveries",
    "orderNumber",
    orderNumber,
  );
  if (matches.length === 0) return null;
  return getDeliveryDetailsPublic(matches[0].id);
}

async function findDeliveryDetailsByStagingCode(
  zoneCode: string,
  options: { excludeReceiveBlocked: boolean },
): Promise<DeliveryDetails | null> {
  const code = zoneCode.trim();
  if (!code) return null;

  const { locations, deliveries } = await fetchScanLookupData();
  const location = findStagingLocationByCode(locations, code);
  if (!location) return null;
  const candidates = deliveries.filter((delivery) => {
    if (ZONE_CLEARED_DELIVERY_STATUSES.has(delivery.status)) return false;
    if (
      options.excludeReceiveBlocked &&
      RECEIVE_BLOCKED_DELIVERY_STATUSES.has(delivery.status)
    ) {
      return false;
    }
    return getAllStagingLocationIds(delivery).includes(location.id);
  });

  if (candidates.length === 0) return null;

  const sorted = [...candidates].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  if (candidates.length > 1) {
    console.warn(
      `[stageverify] Zone "${location.code}": ${candidates.length} active deliveries; ` +
        `using most recently updated (${sorted[0].orderNumber}).`,
    );
  }
  return hydrateDeliveryDetailsPublic(sorted[0]);
}

/** Delivery currently staged at a zone code (vendor receive flow only). */
export async function getDeliveryDetailsPublicByStagingCode(
  zoneCode: string,
): Promise<DeliveryDetails | null> {
  return findDeliveryDetailsByStagingCode(zoneCode, {
    excludeReceiveBlocked: true,
  });
}

/** Delivery at a zone regardless of receive vs pickup status (for QR routing). */
export async function getDeliveryDetailsByStagingCode(
  zoneCode: string,
): Promise<DeliveryDetails | null> {
  return findDeliveryDetailsByStagingCode(zoneCode, {
    excludeReceiveBlocked: false,
  });
}

export interface ZoneOccupancySummary {
  deliveryId: string;
  orderNumber: string;
  vendorName: string;
  jobId: string;
  status: DeliveryOrder["status"];
}

/** Zone code → active delivery on that spot (for Minew ESL QR + status line). */
export async function mapActiveZoneOccupancyByCode(): Promise<
  Record<string, ZoneOccupancySummary>
> {
  const locations = await fetchAllStagingLocations();
  const [deliveries, vendors] = await Promise.all([
    fetchAll<DeliveryOrder>("deliveries"),
    fetchAll<Vendor>("vendors"),
  ]);
  const byCode: Record<string, ZoneOccupancySummary> = {};

  const shouldReplace = (
    existing: ZoneOccupancySummary,
    candidate: DeliveryOrder,
  ): boolean => {
    const prev = deliveries.find((d) => d.id === existing.deliveryId);
    return Boolean(
      prev && candidate.updatedAt.localeCompare(prev.updatedAt) > 0,
    );
  };

  for (const delivery of deliveries) {
    if (ZONE_CLEARED_DELIVERY_STATUSES.has(delivery.status)) continue;
    const vendor = vendors.find((v) => v.id === delivery.vendorId);
    const summary: ZoneOccupancySummary = {
      deliveryId: delivery.id,
      orderNumber: delivery.orderNumber,
      vendorName: vendor?.name ?? "Unknown vendor",
      jobId: delivery.jobId,
      status: delivery.status,
    };

    for (const locId of getAllStagingLocationIds(delivery)) {
      const location = locations.find((loc) => loc.id === locId);
      if (!location) continue;
      const key = normalizeStagingCodeKey(location.code);
      const existing = byCode[key];
      if (!existing || shouldReplace(existing, delivery)) {
        byCode[key] = summary;
      }
    }
  }

  return byCode;
}

export interface StagingLocationOccupant {
  deliveryId: string;
  orderNumber: string;
  vendorName: string;
  locationId: string;
  locationCode: string;
}

/** Staging location id → active delivery occupying that spot (excludes picked_up / installed). */
export async function mapOccupancyByLocationId(
  excludeDeliveryId?: string,
): Promise<Record<string, StagingLocationOccupant>> {
  const locations = await fetchAllStagingLocations();
  const [deliveries, vendors] = await Promise.all([
    fetchAll<DeliveryOrder>("deliveries"),
    fetchAll<Vendor>("vendors"),
  ]);
  const byLocationId: Record<string, StagingLocationOccupant> = {};

  const shouldReplace = (
    existing: StagingLocationOccupant,
    candidate: DeliveryOrder,
  ): boolean => {
    const prev = deliveries.find((d) => d.id === existing.deliveryId);
    return Boolean(
      prev && candidate.updatedAt.localeCompare(prev.updatedAt) > 0,
    );
  };

  for (const delivery of deliveries) {
    if (excludeDeliveryId && delivery.id === excludeDeliveryId) continue;
    if (ZONE_CLEARED_DELIVERY_STATUSES.has(delivery.status)) continue;
    const vendor = vendors.find((v) => v.id === delivery.vendorId);

    for (const locId of getAllStagingLocationIds(delivery)) {
      const location = locations.find((loc) => loc.id === locId);
      const occupant: StagingLocationOccupant = {
        deliveryId: delivery.id,
        orderNumber: delivery.orderNumber,
        vendorName: vendor?.name ?? "Unknown vendor",
        locationId: locId,
        locationCode: location?.code ?? locId,
      };
      const existing = byLocationId[locId];
      if (!existing || shouldReplace(existing, delivery)) {
        byLocationId[locId] = occupant;
      }
    }
  }

  return byLocationId;
}

export async function findStagingLocationOccupant(
  locationId: string,
  excludeDeliveryId?: string,
): Promise<StagingLocationOccupant | null> {
  const map = await mapOccupancyByLocationId(excludeDeliveryId);
  return map[locationId] ?? null;
}

async function assertStagingLocationAvailable(
  locationId: string,
  excludeDeliveryId: string,
): Promise<void> {
  const occupant = await findStagingLocationOccupant(
    locationId,
    excludeDeliveryId,
  );
  if (occupant) {
    throw new StagingLocationOccupiedError(
      occupant.locationCode,
      occupant.orderNumber,
    );
  }
}

/** Re-check every staging spot on a delivery before commit (catches races / stale UI). */
export async function assertDeliveryStagingLocationsAvailable(
  delivery: DeliveryOrder,
): Promise<void> {
  for (const locId of getAllStagingLocationIds(delivery)) {
    await assertStagingLocationAvailable(locId, delivery.id);
  }
}

/** @deprecated Use mapActiveZoneOccupancyByCode */
export async function mapActiveDeliveryIdsByZoneCode(): Promise<
  Record<string, string>
> {
  const byZone = await mapActiveZoneOccupancyByCode();
  return Object.fromEntries(
    Object.entries(byZone).map(([code, o]) => [code, o.deliveryId]),
  );
}

export async function listVendors(): Promise<Vendor[]> {
  return fetchAll<Vendor>("vendors");
}

export async function createVendor(vendor: Vendor): Promise<void> {
  await setDoc(doc(db, "vendors", vendor.id), vendor);
}

export async function updateVendor(vendor: Vendor): Promise<void> {
  await setDoc(doc(db, "vendors", vendor.id), vendor, { merge: true });
}

export async function listAllZones(): Promise<StagingLocation[]> {
  return fetchAllStagingLocations();
}

export async function createZone(
  data: Omit<StagingLocation, "id">,
): Promise<string> {
  const id = `zone-${crypto.randomUUID()}`;
  const zone: StagingLocation = {
    ...data,
    id,
    status: data.status ?? "Planned",
  };
  await setDoc(doc(db, "stagingLocations", id), zone);
  return id;
}

export async function updateZone(
  id: string,
  data: Partial<StagingLocation>,
): Promise<void> {
  await setDoc(doc(db, "stagingLocations", id), data, { merge: true });
}

export async function deactivateZone(id: string): Promise<void> {
  await updateZone(id, { status: "Planned" });
}

export async function listJobs(): Promise<Job[]> {
  return fetchAll<Job>("jobs");
}

export interface CreateDeliveryInput {
  vendorId: string;
  jobId: string;
  poNumber?: string;
  deliveryDate: string;
  stagingLocationId?: string;
  lineItems: Array<{ sku?: string; description: string; qtyOrdered: number }>;
}

export async function createDelivery(
  input: CreateDeliveryInput,
): Promise<string> {
  const now = new Date().toISOString();
  const deliveryId = `delivery-${crypto.randomUUID()}`;
  const allDeliveries = await fetchAll<DeliveryOrder>("deliveries");
  const orderNumber = `ORD-${String(allDeliveries.length + 1).padStart(3, "0")}`;

  if (input.stagingLocationId?.trim()) {
    await assertStagingLocationAvailable(input.stagingLocationId, deliveryId);
  }

  const batch = writeBatch(db);

  let purchaseOrderId: string | undefined;
  if (input.poNumber?.trim()) {
    purchaseOrderId = `po-${crypto.randomUUID()}`;
    const po: PurchaseOrder = {
      id: purchaseOrderId,
      poNumber: input.poNumber.trim(),
      jobId: input.jobId,
      vendorId: input.vendorId,
      orderDate: now.slice(0, 10),
      expectedDeliveryDate: input.deliveryDate,
      status: "open",
    };
    batch.set(doc(db, "purchaseOrders", purchaseOrderId), po);
  }

  const delivery: DeliveryOrder = {
    id: deliveryId,
    orderNumber,
    jobId: input.jobId,
    vendorId: input.vendorId,
    purchaseOrderId,
    deliveryDate: input.deliveryDate,
    stagingLocationId: input.stagingLocationId || undefined,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  batch.set(doc(db, "deliveries", deliveryId), delivery);

  input.lineItems.forEach((row) => {
    const itemId = `item-${crypto.randomUUID()}`;
    const item: Item = {
      id: itemId,
      deliveryOrderId: deliveryId,
      sku: row.sku?.trim() || undefined,
      description: row.description.trim(),
      qtyOrdered: row.qtyOrdered,
      qtyReceived: 0,
      qtyMissing: 0,
      qtyDamaged: 0,
      qtyBackordered: 0,
      status: "pending",
    };
    batch.set(doc(db, "items", itemId), item);
  });

  const eventId = `event-${crypto.randomUUID()}`;
  const historyEvent: StatusHistoryEvent = {
    id: eventId,
    entityType: "delivery_order",
    entityId: deliveryId,
    toStatus: "pending",
    actorType: "dispatcher",
    actorName: "Dispatcher",
    createdAt: now,
  };
  batch.set(doc(db, "statusHistory", eventId), historyEvent);

  await batch.commit();
  return deliveryId;
}

export async function markDeliveryShipped(deliveryId: string): Promise<void> {
  const deliverySnap = await getDoc(doc(db, "deliveries", deliveryId));
  if (!deliverySnap.exists()) return;

  const delivery = deliverySnap.data() as DeliveryOrder;
  const now = new Date().toISOString();
  const eventId = `event-${crypto.randomUUID()}`;
  const batch = writeBatch(db);

  batch.update(doc(db, "deliveries", deliveryId), {
    status: "shipped" satisfies DeliveryStatus,
    updatedAt: now,
  });
  batch.set(doc(db, "statusHistory", eventId), {
    id: eventId,
    entityType: "delivery_order",
    entityId: deliveryId,
    fromStatus: delivery.status,
    toStatus: "shipped",
    actorType: "dispatcher",
    actorName: "Dispatcher",
    createdAt: now,
  });

  await batch.commit();
}

export async function markDeliveryInstalled(deliveryId: string): Promise<void> {
  const deliverySnap = await getDoc(doc(db, "deliveries", deliveryId));
  if (!deliverySnap.exists()) return;

  const delivery = deliverySnap.data() as DeliveryOrder;
  const items = await fetchWhere<Item>("items", "deliveryOrderId", deliveryId);
  const now = new Date().toISOString();
  const eventId = `event-${crypto.randomUUID()}`;
  const batch = writeBatch(db);

  batch.update(doc(db, "deliveries", deliveryId), {
    status: "installed" satisfies DeliveryStatus,
    updatedAt: now,
  });

  for (const item of items) {
    if (item.status === "received") {
      batch.update(doc(db, "items", item.id), { status: "installed" });
    }
  }

  batch.set(doc(db, "statusHistory", eventId), {
    id: eventId,
    entityType: "delivery_order",
    entityId: deliveryId,
    fromStatus: delivery.status,
    toStatus: "installed",
    actorType: "technician",
    actorName: "Technician",
    createdAt: now,
  });

  await batch.commit();
}
