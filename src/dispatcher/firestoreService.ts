import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
  query,
  where,
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
} from "./models";
import type {
  DeliveryQuery,
  DeliverySortField,
  DispatcherDataService,
  PagedResult,
  SortDirection,
} from "./service";
import { VALID_TRANSITIONS, VENDOR_REVERT_TARGETS, DISPATCHER_REVERT_TARGETS } from "./service";
import type { AppSettings } from "./models";

async function fetchAll<T>(colName: string): Promise<T[]> {
  const snap = await getDocs(collection(db, colName));
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
        fetchAll<StagingLocation>("stagingLocations"),
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
      if (locSnap.exists()) stagingLocation = locSnap.data() as StagingLocation;
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
    actorType: "dispatcher" | "technician" = "dispatcher",
    actorName?: string,
  ): Promise<DeliveryDetails | null> {
    const deliverySnap = await getDoc(doc(db, "deliveries", deliveryId));
    if (!deliverySnap.exists()) return null;
    const delivery = deliverySnap.data() as DeliveryOrder;

    const fromStatus = delivery.status;
    if (!VALID_TRANSITIONS[fromStatus]?.includes(toStatus)) {
      return this.getDeliveryDetails(deliveryId);
    }

    const now = new Date().toISOString();
    const eventId = `event-${Date.now()}`;
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
        (actorType === "technician" ? "Technician" : "Dispatcher"),
      createdAt: now,
    });

    await batch.commit();
    return this.getDeliveryDetails(deliveryId);
  }

  async updateIssueSummary(
    deliveryId: string,
    summary: string,
  ): Promise<DeliveryDetails | null> {
    const deliverySnap = await getDoc(doc(db, "deliveries", deliveryId));
    if (!deliverySnap.exists()) return null;

    const now = new Date().toISOString();
    const eventId = `event-${Date.now()}`;
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
    const all = await fetchAll<StagingLocation>("stagingLocations");
    return all.filter((loc) => loc.active);
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
      if (prevSnap.exists())
        prevCode = (prevSnap.data() as StagingLocation).code;
    }

    let newCode = "unassigned";
    if (stagingLocationId) {
      const newSnap = await getDoc(
        doc(db, "stagingLocations", stagingLocationId),
      );
      if (newSnap.exists())
        newCode = (newSnap.data() as StagingLocation).code;
    }

    const now = new Date().toISOString();
    const eventId = `event-${Date.now()}`;
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
        const newPoId = `po-${Date.now()}`;
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

    const overallStatus: DeliveryStatus = allReceived ? "complete" : "partial";
    const now = new Date().toISOString();
    const eventId = `event-${Date.now()}`;

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
    const eventId = `event-${Date.now()}`;
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
    const details = await this.getDeliveryDetails(deliveryId);
    if (!details) return;

    const eventId = crypto.randomUUID();
    const now = new Date().toISOString();
    const event: PickupEvent = {
      id: eventId,
      deliveryOrderId: deliveryId,
      jobId: details.delivery.jobId,
      technicianName,
      pickedUpAt: now,
      itemsPickedSummary,
      notes,
    };

    await setDoc(doc(db, "pickupEvents", eventId), event);
    await this.updateDeliveryStatus(
      deliveryId,
      "picked_up",
      undefined,
      "technician",
      technicianName,
    );
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

export async function getDeliveryByOrderNumber(
  orderNumber: string,
): Promise<DeliveryDetails | null> {
  const matches = await fetchWhere<DeliveryOrder>(
    "deliveries",
    "orderNumber",
    orderNumber,
  );
  if (matches.length === 0) return null;
  return firestoreDataService.getDeliveryDetails(matches[0].id);
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
  const deliveryId = `delivery-${Date.now()}`;
  const allDeliveries = await fetchAll<DeliveryOrder>("deliveries");
  const orderNumber = `ORD-${String(allDeliveries.length + 1).padStart(3, "0")}`;
  const batch = writeBatch(db);

  let purchaseOrderId: string | undefined;
  if (input.poNumber?.trim()) {
    purchaseOrderId = `po-${Date.now()}`;
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

  input.lineItems.forEach((row, index) => {
    const itemId = `item-${Date.now()}-${index}`;
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

  const eventId = `event-${Date.now()}`;
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
