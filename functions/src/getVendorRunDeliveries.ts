import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { asSessionToken } from "./vendorSessionValidation";
import {
  collectLocationIds,
  hasAssignableSpot,
  isActiveVendorDelivery,
  locationCodesFromMap,
  resolveLocationCodesById,
} from "./vendorDeliverySpotUtils";

function getDb() {
  return admin.firestore();
}

interface GetVendorRunDeliveriesRequest {
  sessionToken?: string;
}

export interface VendorRunDeliveryItem {
  id: string;
  description: string;
  qtyOrdered: number;
  qtyReceived?: number;
  qtyBackordered?: number;
  status?: string;
}

export interface VendorRunDeliverySummary {
  deliveryId: string;
  jobId: string;
  jobName: string;
  orderNumber: string;
  vendorInvoiceNumber?: string;
  poNumber?: string;
  status?: string;
  stagingLocationCodes: string[];
  hasAssignableSpot: boolean;
  vendorPhysicalDropoffConfirmed: boolean;
  items: VendorRunDeliveryItem[];
}

async function assertVendorScopeSession(sessionToken: string): Promise<{
  vendorId: string;
  scannedStagingLocationCode?: string;
}> {
  const snap = await getDb().collection("vendorSessions").doc(sessionToken).get();
  if (!snap.exists) {
    throw new HttpsError(
      "permission-denied",
      "Session expired. Enter your PIN again.",
    );
  }
  const session = snap.data() as {
    vendorId?: string;
    expiresAt?: string;
    sessionScope?: string;
    scannedStagingLocationCode?: string;
  };

  if (session.sessionScope !== "vendor" || !session.vendorId) {
    throw new HttpsError(
      "permission-denied",
      "Session is not valid for vendor run.",
    );
  }

  const expiresMs = Date.parse(String(session.expiresAt ?? ""));
  if (!Number.isFinite(expiresMs) || Date.now() >= expiresMs) {
    throw new HttpsError(
      "permission-denied",
      "Session expired. Enter your PIN again.",
    );
  }

  return {
    vendorId: session.vendorId,
    scannedStagingLocationCode:
      typeof session.scannedStagingLocationCode === "string"
        ? session.scannedStagingLocationCode
        : undefined,
  };
}

function mapItems(
  itemsSnap: admin.firestore.QuerySnapshot,
): VendorRunDeliveryItem[] {
  return itemsSnap.docs.map((itemDoc) => {
    const item = itemDoc.data();
    const description =
      typeof item.description === "string" && item.description.trim()
        ? item.description.trim()
        : typeof item.name === "string" && item.name.trim()
          ? item.name.trim()
          : "Item";
    return {
      id: itemDoc.id,
      description,
      qtyOrdered: typeof item.qtyOrdered === "number" ? item.qtyOrdered : 0,
      ...(typeof item.qtyReceived === "number"
        ? { qtyReceived: item.qtyReceived }
        : {}),
      ...(typeof item.qtyBackordered === "number"
        ? { qtyBackordered: item.qtyBackordered }
        : {}),
      ...(typeof item.status === "string" ? { status: item.status } : {}),
    };
  });
}

/** Vendor-scoped multi-job delivery list (opt-in company PIN — D-09 amended). */
export const getVendorRunDeliveries = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const timings: Record<string, number> = {};
    const tStart = Date.now();

    const data = (request.data ?? {}) as GetVendorRunDeliveriesRequest;
    const sessionToken = asSessionToken(data.sessionToken);
    if (!sessionToken) {
      throw new HttpsError("invalid-argument", "Invalid session.");
    }

    const session = await assertVendorScopeSession(sessionToken);
    timings.sessionMs = Date.now() - tStart;

    const db = getDb();
    const tDeliveries = Date.now();

    const deliveriesSnap = await db
      .collection("deliveries")
      .where("vendorId", "==", session.vendorId)
      .limit(100)
      .get();

    timings.deliveriesQueryMs = Date.now() - tDeliveries;

    const activeDocs = deliveriesSnap.docs.filter((docSnap) =>
      isActiveVendorDelivery(docSnap.data()),
    );

    const jobIds = new Set<string>();
    const poIds = new Set<string>();
    const allLocationIds: string[] = [];

    for (const docSnap of activeDocs) {
      const delivery = docSnap.data();
      const jobId = String(delivery.jobId ?? "");
      if (jobId) jobIds.add(jobId);
      if (delivery.purchaseOrderId) {
        poIds.add(String(delivery.purchaseOrderId));
      }
      for (const id of collectLocationIds(delivery)) {
        allLocationIds.push(id);
      }
    }

    const tEnrich = Date.now();
    const jobRefs = [...jobIds].map((id) => db.collection("jobs").doc(id));
    const poRefs = [...poIds].map((id) =>
      db.collection("purchaseOrders").doc(id),
    );

    const [jobSnaps, locationCodeMap, poSnaps, ...itemsSnaps] =
      await Promise.all([
        jobRefs.length > 0 ? db.getAll(...jobRefs) : Promise.resolve([]),
        resolveLocationCodesById(db, allLocationIds),
        poRefs.length > 0 ? db.getAll(...poRefs) : Promise.resolve([]),
        ...activeDocs.map((docSnap) =>
          db
            .collection("items")
            .where("deliveryOrderId", "==", docSnap.id)
            .limit(50)
            .get(),
        ),
      ]);

    timings.enrichmentMs = Date.now() - tEnrich;

    const jobNameById = new Map<string, string>();
    for (const snap of jobSnaps) {
      if (snap.exists) {
        const jn = snap.data()?.jobName;
        if (typeof jn === "string" && jn.trim()) {
          jobNameById.set(snap.id, jn.trim());
        }
      }
    }

    const poNumberById = new Map<string, string>();
    for (const snap of poSnaps) {
      if (snap.exists) {
        const po = snap.data()?.poNumber;
        if (typeof po === "string") poNumberById.set(snap.id, po);
      }
    }

    const summaries: VendorRunDeliverySummary[] = activeDocs.map(
      (docSnap, index) => {
        const delivery = docSnap.data();
        const deliveryId = docSnap.id;
        const jobId = String(delivery.jobId ?? "");
        const jobName = (jobId && jobNameById.get(jobId)) || "Job";

        const locationIds = collectLocationIds(delivery);
        const stagingLocationCodes = locationCodesFromMap(
          locationIds,
          locationCodeMap,
        );

        let poNumber: string | undefined;
        if (delivery.purchaseOrderId) {
          const po = poNumberById.get(String(delivery.purchaseOrderId));
          if (po) poNumber = po;
        }

        const vendorInvoiceNumber =
          typeof delivery.vendorInvoiceNumber === "string" &&
          delivery.vendorInvoiceNumber.trim()
            ? delivery.vendorInvoiceNumber.trim()
            : undefined;

        return {
          deliveryId,
          jobId,
          jobName,
          orderNumber: String(delivery.orderNumber ?? deliveryId),
          vendorInvoiceNumber,
          poNumber,
          ...(typeof delivery.status === "string"
            ? { status: delivery.status }
            : {}),
          stagingLocationCodes,
          hasAssignableSpot: hasAssignableSpot(delivery),
          vendorPhysicalDropoffConfirmed:
            delivery.vendorPhysicalDropoffConfirmed === true,
          items: mapItems(itemsSnaps[index]),
        };
      },
    );

    summaries.sort((a, b) => {
      const jobCmp = a.jobName.localeCompare(b.jobName);
      if (jobCmp !== 0) return jobCmp;
      return a.orderNumber.localeCompare(b.orderNumber);
    });

    timings.totalMs = Date.now() - tStart;
    console.info("getVendorRunDeliveries timings", timings);

    return {
      vendorId: session.vendorId,
      scannedStagingLocationCode: session.scannedStagingLocationCode ?? null,
      deliveries: summaries,
    };
  },
);
