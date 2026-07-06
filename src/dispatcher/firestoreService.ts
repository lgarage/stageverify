import {
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
  query,
  where,
  limit,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { db } from "../firebase";
import { restGetDelivery, restGetItemsForDelivery } from "../firestoreRest";
import { withTimeout } from "../withTimeout";
import { functions } from "../firebase";
import { httpsCallable } from "firebase/functions";
import { getVendorSessionToken } from "../vendorPinSession";
import { validateVendorSessionClient } from "../validateVendorSessionClient";
import {
  VendorSessionError,
  vendorSessionErrorMessage,
} from "../vendorSessionErrors";
import type {
  DeliveryDetails,
  DeliveryListRow,
  DeliveryOrder,
  DeliveryStatus,
  Item,
  ItemStatus,
  Job,
  MaterialIssue,
  IssueResolutionType,
  CreateMaterialIssueInput,
  CreateMaterialIssueResult,
  GeneratePickupTokenInput,
  GeneratePickupTokenResult,
  RevokePickupTokenInput,
  RevokePickupTokenResult,
  PickupTokenStatusResult,
  PickupEvent,
  PurchaseOrder,
  StagingLocation,
  StatusHistoryEvent,
  Vendor,
  AppSettings,
  EmailProviderConnection,
  EmailProviderConnectionStatus,
  EmailProviderId,
  InboundGmailSyncResult,
  ShopStockLocationMapping,
  ShopStockLine,
  SendVendorEmailInput,
  SendVendorEmailResult,
  VendorEmailEvent,
  VendorInvoiceImportReview,
  InvoiceMatchResult,
  ApproveVendorInvoiceImportResult,
} from "./models";
import {
  getAllStagingLocationIds,
  isLocationActive,
  parseStagingLocation,
  RECEIVE_BLOCKED_DELIVERY_STATUSES,
  ZONE_CLEARED_DELIVERY_STATUSES,
  V2_COLLECTION_NAMES,
} from "./models";
import { findStagingLocationByCode, normalizeStagingCodeKey } from "./stagingCode";
import {
  computeJobReadiness,
  type JobReadinessResult,
} from "./readiness";
import {
  computeDeliveryDisplayState,
  rowMatchesOverviewStatusFilter,
} from "./deliveryDisplayHelpers";
import { resolveDeliveryPoNumber } from "./invoice/invoiceShellDisplayHelpers";
import { extractDeliverToSiteLabel } from "./invoice/invoiceShellDisplayHelpers";
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
import {
  ShopStockLocationReservedError,
  findShopStockMappingForLocationCode,
} from "./shopStockMapping";

export {
  StagingLocationOccupiedError,
  deliveryUsesStagingLocation,
  isStagingLocationOccupiedError,
} from "./stagingOccupancy";
export {
  ShopStockLocationReservedError,
  isShopStockLocationReservedError,
} from "./shopStockMapping";

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
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T);
}

async function fetchWhere<T>(
  colName: string,
  field: string,
  value: string,
): Promise<T[]> {
  const snap = await getDocs(
    query(collection(db, colName), where(field, "==", value)),
  );
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T);
}

/** Seed/demo deliveries from seedFirestore.ts — hidden on prod gh-pages list only. */
const SEED_DEMO_DELIVERY_IDS = new Set([
  "delivery-1",
  "delivery-2",
  "delivery-3",
  "delivery-demo-vendor-1",
  "delivery-demo-vendor-2",
]);

const SEED_DEMO_ORDER_PATTERN = /^ORD-00[1-6]$/;

function isSeedDemoDelivery(delivery: DeliveryOrder): boolean {
  if (SEED_DEMO_DELIVERY_IDS.has(delivery.id)) return true;
  const orderNumber = delivery.orderNumber?.trim() ?? "";
  return SEED_DEMO_ORDER_PATTERN.test(orderNumber);
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

async function invokeRecalculateDeliveryReadiness(
  deliveryId: string,
): Promise<void> {
  const sessionToken = getVendorSessionToken(deliveryId);
  const payload: { deliveryOrderId: string; sessionToken?: string } = {
    deliveryOrderId: deliveryId,
  };
  if (sessionToken) {
    payload.sessionToken = sessionToken;
  }
  const callable = httpsCallable(functions, "recalculateDeliveryReadiness");
  await callable(payload);
}

async function requireActiveVendorSession(deliveryId: string): Promise<void> {
  const sessionToken = getVendorSessionToken(deliveryId);
  if (!sessionToken) {
    throw new VendorSessionError("Session expired. Enter your PIN again.");
  }
  try {
    await validateVendorSessionClient({ sessionToken, deliveryId });
  } catch (err) {
    throw new VendorSessionError(vendorSessionErrorMessage(err));
  }
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

    const [deliveries, allJobs, allVendors, allLocations, allPOs, allItems, allMaterialIssues] =
      await Promise.all([
        deliveriesPromise,
        fetchAll<Job>("jobs"),
        fetchAll<Vendor>("vendors"),
        fetchAllStagingLocations(),
        fetchAll<PurchaseOrder>("purchaseOrders"),
        fetchAll<Item>("items"),
        fetchAll<MaterialIssue>("materialIssues"),
      ]);

    const materialIssuesByDelivery = new Map<string, MaterialIssue[]>();
    for (const issue of allMaterialIssues) {
      const list = materialIssuesByDelivery.get(issue.deliveryOrderId) ?? [];
      list.push(issue);
      materialIssuesByDelivery.set(issue.deliveryOrderId, list);
    }

    const hideSeedDemoRows = import.meta.env.PROD;

    const rows: DeliveryListRow[] = [];
    for (const delivery of deliveries) {
      if (hideSeedDemoRows && isSeedDemoDelivery(delivery)) continue;

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
      const received =
        delivery.invoiceDeliverToSite === true &&
        delivery.invoiceDeliverToSiteConfirmed === true
          ? ordered
          : lineItems.reduce((sum, i) => sum + i.qtyReceived, 0);
      const materialIssues = materialIssuesByDelivery.get(delivery.id) ?? [];
      const display = computeDeliveryDisplayState(
        delivery,
        lineItems,
        materialIssues,
        { jobPickupScheduled: Boolean(job.pickupScheduledAt) },
      );

      rows.push({
        deliveryId: delivery.id,
        // Authoritative for list filter chips / counts — matches statusDisplayLabel.
        status: display.readiness.deliveryStatus,
        statusDisplayLabel: display.statusDisplayLabel,
        jobNumber: job.jobNumber,
        jobName: job.jobName,
        poNumber: resolveDeliveryPoNumber(
          delivery.customerPoOrReference,
          po?.poNumber,
        ),
        orderNumber: delivery.orderNumber,
        vendorName: vendor.name,
        deliveryDate: delivery.deliveryDate,
        stagingLocationCode: loc?.code,
        itemsReceivedLabel: `${received}/${ordered}`,
        issueSummary: display.issueSummary,
        openIssueCount: display.openIssueCount,
        missingStagingAssignment: display.missingStagingAssignment,
      });
    }

    const filtered = rows.filter((row) => {
      if (q.statuses?.length) {
        const matches = q.statuses.some((status) =>
          rowMatchesOverviewStatusFilter(row, status),
        );
        if (!matches) return false;
      }
      if (q.search && !includesSearch(row, q.search)) return false;
      return true;
    });

    const sorted = sortRows(filtered, sortBy, sortDirection);
    return asPagedResult(sorted, page, pageSize);
  }

  async getJobReadinessBreakdown(
    jobId: string,
  ): Promise<{
    readiness: JobReadinessResult;
    deliveries: DeliveryOrder[];
    purchaseOrders: PurchaseOrder[];
    vendorsById: Map<string, Vendor>;
    itemsByDelivery: Map<string, Item[]>;
  } | null> {
    const jobSnap = await getDoc(doc(db, "jobs", jobId));
    if (!jobSnap.exists()) return null;

    const [deliveries, purchaseOrders, vendors] = await Promise.all([
      fetchWhere<DeliveryOrder>("deliveries", "jobId", jobId),
      fetchWhere<PurchaseOrder>("purchaseOrders", "jobId", jobId),
      fetchAll<Vendor>("vendors"),
    ]);

    const itemsByDelivery = new Map<string, Item[]>();
    await Promise.all(
      deliveries.map(async (delivery) => {
        const items = await fetchWhere<Item>(
          "items",
          "deliveryOrderId",
          delivery.id,
        );
        itemsByDelivery.set(delivery.id, items);
      }),
    );

    const readiness = computeJobReadiness(
      jobId,
      deliveries,
      purchaseOrders,
      itemsByDelivery,
    );

    const vendorsById = new Map(vendors.map((v) => [v.id, v]));
    return { readiness, deliveries, purchaseOrders, vendorsById, itemsByDelivery };
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

    const job = { ...(jobSnap.data() as Job), id: jobSnap.id };
    const vendor = { ...(vendorSnap.data() as Vendor), id: vendorSnap.id };

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
    const materialIssues = await listMaterialIssuesForDelivery(deliveryId);

    return {
      delivery,
      job,
      vendor,
      purchaseOrder,
      stagingLocation,
      items,
      statusHistory: statusHistoryEvents,
      pickupEvents,
      materialIssues,
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

    if (toStatus === "ready_for_pickup") {
      await invokeRecalculateDeliveryReadiness(deliveryId);
      if (actorType === "technician") return null;
      if (actorType === "vendor") {
        return getDeliveryDetailsPublic(deliveryId);
      }
      return this.getDeliveryDetails(deliveryId);
    }

    if (toStatus === "picked_up") {
      throw new Error(
        "Use recordPickupEvent — direct picked_up writes are not supported.",
      );
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
    batch.update(doc(db, "deliveries", deliveryId), updatedFields);
    batch.set(doc(db, "statusHistory", eventId), {
      id: eventId,
      entityType: "delivery_order",
      entityId: deliveryId,
      fromStatus,
      toStatus: toStatus,
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
    if (!getAuth().currentUser) {
      const sessionToken = getVendorSessionToken(deliveryId);
      if (!sessionToken) {
        throw new VendorSessionError("Session expired. Enter your PIN again.");
      }
      const callable = httpsCallable(functions, "assignVendorStagingLocation");
      try {
        await callable({
          deliveryId,
          sessionToken,
          stagingLocationId,
          mode: "primary",
        });
      } catch (err) {
        throw new VendorSessionError(vendorSessionErrorMessage(err));
      }
      await invokeRecalculateDeliveryReadiness(deliveryId);
      return hydrateAfterVendorWrite(deliveryId, (id) =>
        this.getDeliveryDetails(id),
      );
    }

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
    if (getAuth().currentUser) {
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
    }

    await batch.commit();
    await invokeRecalculateDeliveryReadiness(deliveryId);
    return hydrateAfterVendorWrite(deliveryId, (id) =>
      this.getDeliveryDetails(id),
    );
  }

  async updateShopStockPickList(
    deliveryId: string,
    items: string[],
    locationNote: string,
    shopStockLines?: ShopStockLine[],
  ): Promise<DeliveryDetails | null> {
    const deliverySnap = await getDoc(doc(db, "deliveries", deliveryId));
    if (!deliverySnap.exists()) return null;
    const delivery = deliverySnap.data() as DeliveryOrder;
    if (delivery.status === "picked_up" || delivery.status === "installed") {
      return null;
    }

    const now = new Date().toISOString();
    const trimmedNote = locationNote.trim();

    const patch: Record<string, unknown> = {
      shopStockPickListItems: items,
      shopStockLocationNote: trimmedNote,
      updatedAt: now,
    };
    if (shopStockLines !== undefined) {
      patch.shopStockLines = shopStockLines;
    }

    await setDoc(doc(db, "deliveries", deliveryId), patch, { merge: true });
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

  async generatePickupToken(jobId: string): Promise<GeneratePickupTokenResult> {
    const callable = httpsCallable<
      GeneratePickupTokenInput,
      GeneratePickupTokenResult
    >(functions, "generatePickupToken");
    const response = await callable({ jobId });
    return response.data;
  }

  async revokePickupToken(jobId: string): Promise<RevokePickupTokenResult> {
    const callable = httpsCallable<
      RevokePickupTokenInput,
      RevokePickupTokenResult
    >(functions, "revokePickupToken");
    const response = await callable({ jobId });
    return response.data;
  }

  async getPickupTokenStatus(jobId: string): Promise<PickupTokenStatusResult> {
    const callable = httpsCallable<
      { jobId: string },
      PickupTokenStatusResult
    >(functions, "getPickupTokenStatus");
    const response = await callable({ jobId });
    return response.data;
  }

  async updateJobPickupScheduled(
    jobId: string,
    scheduled: boolean,
    scheduledBy?: string,
  ): Promise<Job | null> {
    const jobRef = doc(db, "jobs", jobId);
    const jobSnap = await getDoc(jobRef);
    if (!jobSnap.exists()) return null;

    const now = new Date().toISOString();
    const actor =
      scheduledBy?.trim() ||
      getAuth().currentUser?.email ||
      getAuth().currentUser?.displayName ||
      "dispatcher";

    await setDoc(
      jobRef,
      scheduled
        ? {
            pickupScheduledAt: now,
            pickupScheduledBy: actor,
            updatedAt: now,
          }
        : {
            pickupScheduledAt: deleteField(),
            pickupScheduledBy: deleteField(),
            updatedAt: now,
          },
      { merge: true },
    );

    const refreshed = await getDoc(jobRef);
    return refreshed.exists()
      ? ({ ...(refreshed.data() as Job), id: jobId } satisfies Job)
      : null;
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
    await requireActiveVendorSession(deliveryId);

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

    for (const update of itemUpdates) {
      const existingItem = existingItems.find((i) => i.id === update.id);
      const qtyOrdered = existingItem?.qtyOrdered ?? 0;
      const status = computeItemStatus({ ...update, qtyOrdered });

      batch.update(doc(db, "items", update.id), {
        qtyReceived: update.qtyReceived,
        qtyMissing: update.qtyMissing,
        qtyDamaged: update.qtyDamaged,
        status,
      });
    }

    const now = new Date().toISOString();
    const anyReceivedAfterCheckIn = itemUpdates.some(
      (update) => update.qtyReceived > 0,
    );
    const vendorStatus: DeliveryStatus =
      delivery.status === "arrived" && anyReceivedAfterCheckIn
        ? "partial"
        : delivery.status;

    batch.update(doc(db, "deliveries", deliveryId), {
      submittedAt: now,
      status: vendorStatus,
      updatedAt: now,
    });

    if (delivery.status !== vendorStatus) {
      const eventId = `event-${crypto.randomUUID()}`;
      batch.set(doc(db, "statusHistory", eventId), {
        id: eventId,
        entityType: "delivery_order",
        entityId: deliveryId,
        fromStatus: delivery.status,
        toStatus: vendorStatus,
        actorType: "vendor",
        actorName: driverName || "Vendor Driver",
        createdAt: now,
      });
    }

    await batch.commit();
    await invokeRecalculateDeliveryReadiness(deliveryId);
    return hydrateAfterVendorWrite(deliveryId, (id) =>
      this.getDeliveryDetails(id),
    );
  }

  async markVendorDelivered(
    deliveryId: string,
    actorName = "Vendor Driver",
  ): Promise<DeliveryDetails | null> {
    const sessionToken = getVendorSessionToken(deliveryId);
    if (!sessionToken) {
      throw new VendorSessionError("Session expired. Enter your PIN again.");
    }

    const callable = httpsCallable(functions, "markVendorDelivered");
    try {
      await callable({
        deliveryId,
        sessionToken,
        actorName,
      });
    } catch (err) {
      throw new VendorSessionError(vendorSessionErrorMessage(err));
    }

    return hydrateAfterVendorWrite(deliveryId, (id) =>
      this.getDeliveryDetails(id),
    );
  }

  async confirmVendorOrderComplete(
    deliveryId: string,
    _actorName = "Dispatcher",
  ): Promise<DeliveryDetails | null> {
    const deliverySnap = await getDoc(doc(db, "deliveries", deliveryId));
    if (!deliverySnap.exists()) return null;
    const now = new Date().toISOString();
    const batch = writeBatch(db);
    batch.update(doc(db, "deliveries", deliveryId), {
      vendorOrderComplete: true,
      vendorOrderCompleteAt: now,
      vendorOrderCompleteSource: "dispatcher",
      updatedAt: now,
    });
    await batch.commit();
    await invokeRecalculateDeliveryReadiness(deliveryId);
    return this.getDeliveryDetails(deliveryId);
  }

  async setDeliverToSiteConfirmed(
    deliveryId: string,
    confirmed: boolean,
    actorName = "Dispatcher",
  ): Promise<DeliveryDetails | null> {
    const deliverySnap = await getDoc(doc(db, "deliveries", deliveryId));
    if (!deliverySnap.exists()) return null;
    const delivery = deliverySnap.data() as DeliveryOrder;
    if (delivery.invoiceDeliverToSite !== true) {
      return this.getDeliveryDetails(deliveryId);
    }

    const now = new Date().toISOString();
    const eventId = `event-${crypto.randomUUID()}`;
    const batch = writeBatch(db);
    const siteLabel = delivery.invoiceDeliverToLabel?.trim();
    const lineItems = await fetchWhere<Item>(
      "items",
      "deliveryOrderId",
      deliveryId,
    );

    if (confirmed) {
      batch.update(doc(db, "deliveries", deliveryId), {
        invoiceDeliverToSiteConfirmed: true,
        invoiceDeliverToSiteConfirmedAt: now,
        invoiceDeliverToSiteConfirmedBy: actorName,
        updatedAt: now,
      });
      for (const item of lineItems) {
        if (item.qtyReceived >= item.qtyOrdered) continue;
        batch.update(doc(db, "items", item.id), {
          qtyReceived: item.qtyOrdered,
          status: computeItemStatus({
            qtyReceived: item.qtyOrdered,
            qtyMissing: item.qtyMissing,
            qtyDamaged: item.qtyDamaged,
            qtyOrdered: item.qtyOrdered,
          }),
        });
      }
    } else {
      batch.update(doc(db, "deliveries", deliveryId), {
        invoiceDeliverToSiteConfirmed: false,
        invoiceDeliverToSiteConfirmedAt: null,
        invoiceDeliverToSiteConfirmedBy: null,
        updatedAt: now,
      });
      for (const item of lineItems) {
        if (item.qtyReceived === 0) continue;
        batch.update(doc(db, "items", item.id), {
          qtyReceived: 0,
          status: computeItemStatus({
            qtyReceived: 0,
            qtyMissing: item.qtyMissing,
            qtyDamaged: item.qtyDamaged,
            qtyOrdered: item.qtyOrdered,
          }),
        });
      }
    }

    batch.set(doc(db, "statusHistory", eventId), {
      id: eventId,
      entityType: "delivery_order",
      entityId: deliveryId,
      fromStatus: delivery.status,
      toStatus: delivery.status,
      reason: confirmed
        ? siteLabel
          ? `Delivered to site: ${siteLabel}`
          : "Delivered to site"
        : "Site delivery confirmation cleared",
      actorType: "dispatcher",
      actorName,
      createdAt: now,
    });

    await batch.commit();
    await invokeRecalculateDeliveryReadiness(deliveryId);
    return this.getDeliveryDetails(deliveryId);
  }

  async revertDeliveryStatus(
    deliveryId: string,
    actorType: "vendor" | "dispatcher",
    vendorRevertWindowMinutes = 60,
  ): Promise<DeliveryDetails | null> {
    const hydrateResult = (id: string): Promise<DeliveryDetails | null> =>
      actorType === "vendor"
        ? hydrateAfterVendorWrite(id, (hydrateId) =>
            this.getDeliveryDetails(hydrateId),
          )
        : this.getDeliveryDetails(id);

    const deliverySnap = await getDoc(doc(db, "deliveries", deliveryId));
    if (!deliverySnap.exists()) return null;
    const delivery = deliverySnap.data() as DeliveryOrder;

    const revertTargets =
      actorType === "vendor" ? VENDOR_REVERT_TARGETS : DISPATCHER_REVERT_TARGETS;
    let toStatus = revertTargets[delivery.status];

    if (
      actorType === "vendor" &&
      !toStatus &&
      delivery.status === "arrived" &&
      delivery.submittedAt
    ) {
      toStatus = "arrived";
    }

    if (!toStatus) return hydrateResult(deliveryId);

    if (actorType === "vendor") {
      const submittedAt = delivery.submittedAt;
      if (!submittedAt) return hydrateResult(deliveryId);
      const elapsedMs = Date.now() - new Date(submittedAt).getTime();
      if (elapsedMs > vendorRevertWindowMinutes * 60 * 1000) {
        return hydrateResult(deliveryId);
      }
    }

    const now = new Date().toISOString();
    const eventId = `event-${crypto.randomUUID()}`;
    const batch = writeBatch(db);

    const clearSubmitted =
      toStatus === "arrived" ||
      (delivery.status === "arrived" && delivery.submittedAt);

    const clearPhysicalEvidence =
      actorType === "vendor" &&
      (clearSubmitted || delivery.vendorPhysicalDropoffConfirmed === true);

    batch.update(doc(db, "deliveries", deliveryId), {
      status: toStatus,
      submittedAt: clearSubmitted ? null : delivery.submittedAt,
      ...(clearPhysicalEvidence
        ? {
            vendorPhysicalDropoffConfirmed: false,
            vendorPhysicalDropoffConfirmedAt: null,
            deliveredAt: null,
            physicalDropoffSource: null,
          }
        : {}),
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
    if (actorType === "vendor" || actorType === "dispatcher") {
      await invokeRecalculateDeliveryReadiness(deliveryId);
    }
    return hydrateResult(deliveryId);
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
    clientOperationId?: string,
    stagingLocationIds?: string[],
    pickupToken?: string,
  ): Promise<void> {
    const deliverySnap = await getDoc(doc(db, "deliveries", deliveryId));
    if (!deliverySnap.exists()) {
      throw new Error("Delivery not found");
    }
    const delivery = deliverySnap.data() as DeliveryOrder;
    const operationId = clientOperationId?.trim();
    if (!operationId) {
      throw new Error("clientOperationId is required for pickup.");
    }

    const callable = httpsCallable(functions, "recordPickupEvent");
    await callable({
      deliveryOrderId: deliveryId,
      jobId: delivery.jobId,
      technicianName,
      itemsPickedSummary,
      notes,
      clientOperationId: operationId,
      stagingLocationIds,
      ...(pickupToken ? { pickupToken } : {}),
    });
  }

  async updatePickupChecklist(
    deliveryId: string,
    jobId: string,
    pickupCheckedItemIds: string[],
    pickupToken: string,
  ): Promise<void> {
    const token = pickupToken.trim();
    if (!token) {
      throw new Error("pickupToken is required for pickup checklist.");
    }
    const callable = httpsCallable(functions, "updatePickupChecklist");
    await callable({
      deliveryOrderId: deliveryId,
      jobId,
      pickupCheckedItemIds,
      pickupToken: token,
    });
  }
}

const APP_SETTINGS_DOC = doc(db, "appSettings", "config");
const DEFAULT_APP_SETTINGS: AppSettings = {
  vendorRevertWindowMinutes: 60,
  autoSubmitMinutes: 30,
  vendorDeliveryMode: "full_checkin",
  vendorSessionMinutes: 15,
  monitoringInboxEmail: "",
  emailMonitoringEnabled: false,
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

const EMAIL_PROVIDER_DOC = doc(db, "emailProviderConnections", "gmail");

const DEFAULT_EMAIL_PROVIDER_CONNECTION: EmailProviderConnection = {
  provider: "gmail",
  status: "disconnected",
  updatedAt: new Date(0).toISOString(),
};

export function parseEmailProviderConnection(
  data: Record<string, unknown> | undefined,
): EmailProviderConnection {
  if (!data) return { ...DEFAULT_EMAIL_PROVIDER_CONNECTION };
  const status = data.status as EmailProviderConnectionStatus | undefined;
  const validStatuses: EmailProviderConnectionStatus[] = [
    "disconnected",
    "connected",
    "token_expired",
  ];
  return {
    provider: (data.provider as EmailProviderId) ?? "gmail",
    status:
      status && validStatuses.includes(status) ? status : "disconnected",
    connectedAccountEmail:
      typeof data.connectedAccountEmail === "string"
        ? data.connectedAccountEmail
        : undefined,
    connectedAt:
      typeof data.connectedAt === "string" ? data.connectedAt : undefined,
    connectedByUid:
      typeof data.connectedByUid === "string" ? data.connectedByUid : undefined,
    updatedAt:
      typeof data.updatedAt === "string"
        ? data.updatedAt
        : new Date().toISOString(),
  };
}

export async function getEmailProviderConnection(): Promise<EmailProviderConnection> {
  const snap = await getDoc(EMAIL_PROVIDER_DOC);
  if (!snap.exists()) return { ...DEFAULT_EMAIL_PROVIDER_CONNECTION };
  return parseEmailProviderConnection(snap.data() as Record<string, unknown>);
}

export function isEmailProviderConnected(
  connection: EmailProviderConnection | null | undefined,
): boolean {
  return connection?.status === "connected";
}

const initiateGmailOAuthCallable = httpsCallable<
  { returnUrl?: string },
  { authUrl: string; state: string; configured: boolean }
>(functions, "initiateGmailOAuth");

const disconnectGmailOAuthCallable = httpsCallable<object, { ok: boolean }>(
  functions,
  "disconnectGmailOAuth",
);

export async function initiateGmailOAuth(returnUrl: string): Promise<string> {
  const response = await initiateGmailOAuthCallable({ returnUrl });
  return response.data.authUrl;
}

export async function disconnectGmailOAuth(): Promise<void> {
  await disconnectGmailOAuthCallable({});
}

const triggerInboundGmailSyncCallable = httpsCallable<
  object,
  InboundGmailSyncResult
>(functions, "triggerInboundGmailSyncCallable");

/** Manual inbound Gmail sync — same path as scheduled syncInboundGmail. */
export async function triggerInboundGmailSync(): Promise<InboundGmailSyncResult> {
  const response = await triggerInboundGmailSyncCallable({});
  return response.data;
}

const sendVendorEmailCallable = httpsCallable<
  SendVendorEmailInput,
  SendVendorEmailResult
>(functions, "sendVendorEmail");

export async function sendVendorEmail(
  input: SendVendorEmailInput,
): Promise<SendVendorEmailResult> {
  const response = await sendVendorEmailCallable(input);
  return response.data;
}

export async function listVendorEmailEventsForDelivery(
  deliveryOrderId: string,
): Promise<VendorEmailEvent[]> {
  const snap = await getDocs(
    query(
      collection(db, V2_COLLECTION_NAMES.vendorEmailEvents),
      where("deliveryOrderId", "==", deliveryOrderId),
    ),
  );
  const events = snap.docs.map((d) => d.data() as VendorEmailEvent);
  events.sort((a, b) => {
    const aTime = a.sentAt ?? a.receivedAt ?? a.createdAt;
    const bTime = b.sentAt ?? b.receivedAt ?? b.createdAt;
    return bTime.localeCompare(aTime);
  });
  return events;
}

/** Live pending inbound vendor email events for Needs Review strip (Stage 1). */
export async function listPendingInboundVendorEmailEvents(
  limit = 50,
): Promise<VendorEmailEvent[]> {
  const snap = await getDocs(
    query(
      collection(db, V2_COLLECTION_NAMES.vendorEmailEvents),
      where("reviewStatus", "==", "pending_review"),
    ),
  );
  const events = snap.docs
    .map((d) => d.data() as VendorEmailEvent)
    .filter((e) => e.direction === "inbound" || !e.direction)
    .slice(0, limit);
  events.sort((a, b) => (b.receivedAt ?? b.createdAt).localeCompare(a.receivedAt ?? a.createdAt));
  return events;
}

export const firestoreDataService = new FirestoreDataService();

export async function addStagingLocation(
  deliveryId: string,
  locationId: string,
): Promise<void> {
  if (!getAuth().currentUser) {
    const sessionToken = getVendorSessionToken(deliveryId);
    if (!sessionToken) {
      throw new VendorSessionError("Session expired. Enter your PIN again.");
    }
    const callable = httpsCallable(functions, "assignVendorStagingLocation");
    try {
      await callable({
        deliveryId,
        sessionToken,
        stagingLocationId: locationId,
        mode: "additional",
      });
    } catch (err) {
      throw new VendorSessionError(vendorSessionErrorMessage(err));
    }
    return;
  }

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
  const status = delivery.status;
  batch.set(doc(db, "statusHistory", eventId), {
    id: eventId,
    entityType: "delivery_order",
    entityId: deliveryId,
    fromStatus: status,
    toStatus: status,
    reason: `Additional staging location added: ${locationId}`,
    actorType: "vendor",
    actorName: "Vendor",
    createdAt: now,
  });

  await batch.commit();
}

/** Default pickup queue: ready_for_pickup plus in-progress/completed pickups. */
const PICKUP_PORTAL_DELIVERY_STATUSES: DeliveryStatus[] = [
  "ready_for_pickup",
  "picked_up",
  "installed",
];

const PICKUP_PORTAL_NOT_READY_DETAIL_STATUSES: DeliveryStatus[] = [
  "partial",
  "arrived",
];

export async function loadPickupReadyDeliveriesPublic(
  jobId: string,
  options?: { includeDeliveryId?: string },
): Promise<DeliveryDetails[]> {
  const deliveries = await fetchWhere<DeliveryOrder>(
    "deliveries",
    "jobId",
    jobId,
  );
  const includeId = options?.includeDeliveryId;
  const visibleOnPickup = deliveries.filter(
    (d) =>
      PICKUP_PORTAL_DELIVERY_STATUSES.includes(d.status) ||
      PICKUP_PORTAL_NOT_READY_DETAIL_STATUSES.includes(d.status) ||
      (includeId !== undefined && d.id === includeId),
  );
  const detailsList = await Promise.all(
    visibleOnPickup.map((d) => getDeliveryDetailsPublic(d.id)),
  );
  return detailsList.filter((d): d is DeliveryDetails => d !== null);
}

type FirestoreDocSnap = Awaited<ReturnType<typeof getDoc>>;

function publicVendorFromDelivery(delivery: DeliveryOrder): Vendor {
  return {
    id: delivery.vendorId,
    name: delivery.vendorName ?? "Vendor",
    createdAt: delivery.createdAt,
  };
}

/** Denormalized vendor label — safe for unauthenticated occupancy reads. */
function denormalizedVendorName(delivery: DeliveryOrder): string {
  return delivery.vendorName?.trim() || "Vendor";
}

/** Public vendor writes must not hydrate via auth-only getDeliveryDetails. */
async function hydrateAfterVendorWrite(
  deliveryId: string,
  authenticatedHydrate: (id: string) => Promise<DeliveryDetails | null>,
): Promise<DeliveryDetails | null> {
  if (getAuth().currentUser) {
    return authenticatedHydrate(deliveryId);
  }
  return getDeliveryDetailsPublic(deliveryId);
}

/** Hydrate public delivery details when the delivery doc is already loaded (zone scan path). */
async function hydrateDeliveryDetailsPublic(
  delivery: DeliveryOrder,
): Promise<DeliveryDetails | null> {
  const deliveryId = delivery.id;
  const [jobSnap, poSnap, locSnap, items] = await Promise.all([
    getDoc(doc(db, "jobs", delivery.jobId)),
    delivery.purchaseOrderId
      ? getDoc(doc(db, "purchaseOrders", delivery.purchaseOrderId))
      : Promise.resolve(null as FirestoreDocSnap | null),
    delivery.stagingLocationId
      ? getDoc(doc(db, "stagingLocations", delivery.stagingLocationId))
      : Promise.resolve(null as FirestoreDocSnap | null),
    fetchWhere<Item>("items", "deliveryOrderId", deliveryId),
  ]);

  const publicVendor = publicVendorFromDelivery(delivery);

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
    materialIssues: [],
  };
}

const VENDOR_DELIVERY_LOAD_MS = 10_000;
const VENDOR_RECEIVE_CACHE_PREFIX = "sv-vendor-recv:";

const vendorReceiveInflight = new Map<
  string,
  Promise<DeliveryDetails | null>
>();

function readVendorReceiveCache(
  deliveryId: string,
): DeliveryDetails | null {
  try {
    const raw = sessionStorage.getItem(
      `${VENDOR_RECEIVE_CACHE_PREFIX}${deliveryId}`,
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DeliveryDetails;
    if (
      typeof parsed.delivery?.id !== "string" ||
      !Array.isArray(parsed.items)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeVendorReceiveCache(
  deliveryId: string,
  details: DeliveryDetails,
): void {
  try {
    sessionStorage.setItem(
      `${VENDOR_RECEIVE_CACHE_PREFIX}${deliveryId}`,
      JSON.stringify(details),
    );
  } catch {
    /* sessionStorage quota — non-fatal */
  }
}

/** Start loading delivery + items while vendor enters PIN (REST-only — reliable on iOS). */
export function prefetchVendorReceiveDelivery(
  deliveryId: string,
  options?: { force?: boolean },
): void {
  const trimmed = deliveryId.trim();
  if (!trimmed) return;
  if (!options?.force && vendorReceiveInflight.has(trimmed)) return;
  vendorReceiveInflight.set(
    trimmed,
    loadVendorReceiveViaRest(trimmed)
      .then((details) => {
        if (details) writeVendorReceiveCache(trimmed, details);
        return details;
      })
      .catch((err: unknown) => {
        vendorReceiveInflight.delete(trimmed);
        throw err;
      }),
  );
}

function deliveryOrderFromSnap(
  deliveryId: string,
  data: DeliveryOrder,
): DeliveryOrder {
  return { ...data, id: data.id ?? deliveryId };
}

function buildMinimalPublicDetails(
  delivery: DeliveryOrder,
  items: Item[],
): DeliveryDetails {
  const { notes: _n, ...publicDelivery } = delivery;
  return {
    delivery: publicDelivery as DeliveryOrder,
    vendor: publicVendorFromDelivery(delivery) as Vendor,
    items,
    statusHistory: [],
    pickupEvents: [],
    materialIssues: [],
  };
}

/**
 * Fast public hydrate for vendor PIN unlock — delivery + line items only.
 * Skips job/PO/staging reads that can stall iOS Safari; enrich later if needed.
 */
async function loadVendorReceiveViaRest(
  deliveryId: string,
): Promise<DeliveryDetails | null> {
  const delivery = await withTimeout(
    restGetDelivery(deliveryId),
    VENDOR_DELIVERY_LOAD_MS,
    "Delivery load timed out. Check your connection and try again.",
  );
  if (!delivery) return null;
  const items = await withTimeout(
    restGetItemsForDelivery(deliveryId),
    VENDOR_DELIVERY_LOAD_MS,
    "Items load timed out. Check your connection and try again.",
  );
  return buildMinimalPublicDetails(delivery, items);
}

export async function getDeliveryDetailsPublicForVendorReceive(
  deliveryId: string,
): Promise<DeliveryDetails | null> {
  const cached = readVendorReceiveCache(deliveryId);
  if (cached) return cached;

  const inflight = vendorReceiveInflight.get(deliveryId);
  if (inflight) {
    try {
      const details = await inflight;
      if (details) return details;
    } catch {
      /* prefetch failed — fresh REST load below */
    }
  }

  const details = await loadVendorReceiveViaRest(deliveryId);
  if (details) writeVendorReceiveCache(deliveryId, details);
  return details;
}

export async function getDeliveryDetailsPublic(
  deliveryId: string,
): Promise<DeliveryDetails | null> {
  const deliverySnap = await getDoc(doc(db, "deliveries", deliveryId));
  if (!deliverySnap.exists()) return null;
  const delivery = deliveryOrderFromSnap(
    deliveryId,
    deliverySnap.data() as DeliveryOrder,
  );
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
  const deliveries = await fetchAll<DeliveryOrder>("deliveries");
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
    const summary: ZoneOccupancySummary = {
      deliveryId: delivery.id,
      orderNumber: delivery.orderNumber,
      vendorName: denormalizedVendorName(delivery),
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
  const deliveries = await fetchAll<DeliveryOrder>("deliveries");
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

    for (const locId of getAllStagingLocationIds(delivery)) {
      const location = locations.find((loc) => loc.id === locId);
      const occupant: StagingLocationOccupant = {
        deliveryId: delivery.id,
        orderNumber: delivery.orderNumber,
        vendorName: denormalizedVendorName(delivery),
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

  const locSnap = await getDoc(doc(db, "stagingLocations", locationId));
  if (!locSnap.exists()) return;
  const location = stagingLocationFromSnap(locSnap);
  if (!location) return;
  const mappings = await listShopStockMappings();
  const reserved = findShopStockMappingForLocationCode(location.code, mappings);
  if (reserved) {
    throw new ShopStockLocationReservedError(
      location.code,
      reserved.stockItemLabel,
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

export async function listShopStockMappings(): Promise<
  ShopStockLocationMapping[]
> {
  return fetchAll<ShopStockLocationMapping>("shopStockLocationMappings");
}

export async function createShopStockMapping(
  input: Omit<
    ShopStockLocationMapping,
    "id" | "createdAt" | "updatedAt" | "qtyAssigned" | "qtyPickedUp"
  > & { qtyAssigned?: number; qtyPickedUp?: number },
): Promise<string> {
  const now = new Date().toISOString();
  const id = `ssm-${crypto.randomUUID()}`;
  const mapping: ShopStockLocationMapping = {
    id,
    stockItemLabel: input.stockItemLabel.trim(),
    locationCode: input.locationCode.trim(),
    combinationGroupLabel: input.combinationGroupLabel?.trim() || undefined,
    memberLocationCodes: input.memberLocationCodes?.length
      ? input.memberLocationCodes.map((c) => c.trim()).filter(Boolean)
      : undefined,
    qtyAvailable: Math.max(0, input.qtyAvailable),
    qtyAssigned: Math.max(0, input.qtyAssigned ?? 0),
    qtyPickedUp: Math.max(0, input.qtyPickedUp ?? 0),
    active: input.active,
    notes: input.notes?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  await setDoc(doc(db, "shopStockLocationMappings", id), mapping);
  return id;
}

export async function updateShopStockMapping(
  mapping: ShopStockLocationMapping,
): Promise<void> {
  await setDoc(
    doc(db, "shopStockLocationMappings", mapping.id),
    {
      ...mapping,
      stockItemLabel: mapping.stockItemLabel.trim(),
      locationCode: mapping.locationCode.trim(),
      combinationGroupLabel: mapping.combinationGroupLabel?.trim() || undefined,
      memberLocationCodes: mapping.memberLocationCodes?.length
        ? mapping.memberLocationCodes.map((c) => c.trim()).filter(Boolean)
        : undefined,
      notes: mapping.notes?.trim() || undefined,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

export async function deactivateShopStockMapping(id: string): Promise<void> {
  await setDoc(
    doc(db, "shopStockLocationMappings", id),
    { active: false, updatedAt: new Date().toISOString() },
    { merge: true },
  );
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

  const vendorSnap = await getDoc(doc(db, "vendors", input.vendorId));
  const vendorName = vendorSnap.exists()
    ? (vendorSnap.data() as Vendor).name
    : "Vendor";

  const delivery: DeliveryOrder = {
    id: deliveryId,
    orderNumber,
    jobId: input.jobId,
    vendorId: input.vendorId,
    vendorName,
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

const createMaterialIssueCallable = httpsCallable<
  CreateMaterialIssueInput,
  CreateMaterialIssueResult
>(functions, "createMaterialIssue");

export { verifyVendorPin } from "../verifyVendorPinClient";

export async function reportMaterialIssue(
  input: CreateMaterialIssueInput,
): Promise<CreateMaterialIssueResult> {
  const response = await createMaterialIssueCallable(input);
  return response.data;
}

export interface ResolveMaterialIssueInput {
  issueId: string;
  resolutionType: IssueResolutionType;
  resolutionNote: string;
}

export interface ResolveMaterialIssueResult {
  issueId: string;
  status: "resolved";
  readinessRecalculated: boolean;
}

const resolveMaterialIssueCallable = httpsCallable<
  ResolveMaterialIssueInput,
  ResolveMaterialIssueResult
>(functions, "resolveMaterialIssue");

export async function resolveMaterialIssue(
  input: ResolveMaterialIssueInput,
): Promise<ResolveMaterialIssueResult> {
  const response = await resolveMaterialIssueCallable(input);
  return response.data;
}

export async function listMaterialIssuesForDelivery(
  deliveryOrderId: string,
): Promise<MaterialIssue[]> {
  const snap = await getDocs(
    query(
      collection(db, "materialIssues"),
      where("deliveryOrderId", "==", deliveryOrderId),
    ),
  );
  const issues = snap.docs.map((d) => d.data() as MaterialIssue);
  issues.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return issues;
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

const listVendorInvoiceImportsCallable = httpsCallable<
  { limit?: number; inboundEmailProcessingId?: string },
  { items: VendorInvoiceImportReview[]; count: number }
>(functions, "listVendorInvoiceImports");

const matchInvoiceToRecordsCallable = httpsCallable<
  { vendorInvoiceImportId: string },
  InvoiceMatchResult
>(functions, "matchInvoiceToRecordsCallable");

const approveVendorInvoiceImportCallable = httpsCallable<
  {
    vendorInvoiceImportId: string;
    action: "approve" | "reject" | "reopen" | "link" | "create_shell";
    deliveryOrderId?: string;
  },
  ApproveVendorInvoiceImportResult
>(functions, "approveVendorInvoiceImport");

const getVendorInvoiceImportCallable = httpsCallable<
  { id: string },
  VendorInvoiceImportReview
>(functions, "getVendorInvoiceImport");

export interface VendorInvoicePdfPayload {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  dataBase64: string;
}

const getVendorInvoicePdfCallable = httpsCallable<
  { vendorInvoiceImportId: string },
  VendorInvoicePdfPayload
>(functions, "getVendorInvoicePdf");

export async function listVendorInvoiceImports(options?: {
  limit?: number;
  inboundEmailProcessingId?: string;
}): Promise<VendorInvoiceImportReview[]> {
  const response = await listVendorInvoiceImportsCallable({
    limit: options?.limit,
    inboundEmailProcessingId: options?.inboundEmailProcessingId,
  });
  return response.data.items ?? [];
}

export async function getVendorInvoiceImport(
  id: string,
): Promise<VendorInvoiceImportReview> {
  const response = await getVendorInvoiceImportCallable({ id });
  return response.data;
}

export async function fetchVendorInvoicePdf(
  vendorInvoiceImportId: string,
): Promise<VendorInvoicePdfPayload> {
  const response = await getVendorInvoicePdfCallable({ vendorInvoiceImportId });
  return response.data;
}

export async function matchInvoiceToRecords(
  vendorInvoiceImportId: string,
): Promise<InvoiceMatchResult> {
  const response = await matchInvoiceToRecordsCallable({ vendorInvoiceImportId });
  return response.data;
}

export async function approveVendorInvoiceImport(input: {
  vendorInvoiceImportId: string;
  action: "approve" | "reject" | "reopen" | "link" | "create_shell";
  deliveryOrderId?: string;
}): Promise<ApproveVendorInvoiceImportResult> {
  const response = await approveVendorInvoiceImportCallable(input);
  return response.data;
}

function invoiceShellBackfillCandidate(
  row: VendorInvoiceImportReview,
): boolean {
  if (row.reviewStatus !== "approved" || row.importStatus === "issue") {
    return false;
  }
  if (!row.linkedDeliveryOrderId?.trim()) {
    return true;
  }
  const orderNotes = row.orderNotes ?? [];
  if (extractDeliverToSiteLabel(orderNotes)) {
    return true;
  }
  if (row.importStatus === "pickup_at_vendor") {
    return true;
  }
  const fulfillment = row.parsedHeader?.fulfillmentMethod;
  return fulfillment === "will_call_pickup";
}

/** Idempotent backfill: create shells for unlinked imports; re-patch linked invoice shells. */
export async function ensureApprovedUnlinkedInvoiceShells(
  imports: VendorInvoiceImportReview[],
): Promise<{ linkedCount: number; failedCount: number; errors: string[] }> {
  const needsShell = imports.filter(invoiceShellBackfillCandidate);
  if (needsShell.length === 0) {
    return { linkedCount: 0, failedCount: 0, errors: [] };
  }

  let linkedCount = 0;
  let failedCount = 0;
  const errors: string[] = [];
  for (const row of needsShell) {
    const label =
      (typeof row.parsedHeader?.vendorInvoiceNumber === "string" &&
        row.parsedHeader.vendorInvoiceNumber.trim()) ||
      row.id;
    try {
      const result = await approveVendorInvoiceImport({
        vendorInvoiceImportId: row.id,
        action: "create_shell",
      });
      if (result.deliveryOrderId?.trim()) {
        linkedCount += 1;
      } else {
        failedCount += 1;
        errors.push(
          `Invoice ${label}: approved but no dashboard delivery was linked.`,
        );
      }
    } catch (err) {
      failedCount += 1;
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Invoice ${label}: ${message}`);
    }
  }
  return { linkedCount, failedCount, errors };
}
