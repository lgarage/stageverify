import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { asSessionToken } from "./vendorSessionValidation";
import {
  collectLocationIds,
  hasAssignableSpot,
  isActiveVendorDelivery,
  resolveLocationCodes,
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
}

export interface VendorRunDeliverySummary {
  deliveryId: string;
  jobId: string;
  jobName: string;
  orderNumber: string;
  vendorInvoiceNumber?: string;
  poNumber?: string;
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
    const data = (request.data ?? {}) as GetVendorRunDeliveriesRequest;
    const sessionToken = asSessionToken(data.sessionToken);
    if (!sessionToken) {
      throw new HttpsError("invalid-argument", "Invalid session.");
    }

    const session = await assertVendorScopeSession(sessionToken);
    const db = getDb();

    const deliveriesSnap = await db
      .collection("deliveries")
      .where("vendorId", "==", session.vendorId)
      .limit(100)
      .get();

    const summaries: VendorRunDeliverySummary[] = [];

    for (const docSnap of deliveriesSnap.docs) {
      const delivery = docSnap.data();
      if (!isActiveVendorDelivery(delivery)) continue;

      const deliveryId = docSnap.id;
      const jobId = String(delivery.jobId ?? "");
      let jobName = "Job";
      if (jobId) {
        const jobSnap = await db.collection("jobs").doc(jobId).get();
        if (jobSnap.exists) {
          const jn = jobSnap.data()?.jobName;
          if (typeof jn === "string" && jn.trim()) jobName = jn.trim();
        }
      }

      const locationIds = collectLocationIds(delivery);
      const stagingLocationCodes = await resolveLocationCodes(db, locationIds);

      let poNumber: string | undefined;
      if (delivery.purchaseOrderId) {
        const poSnap = await db
          .collection("purchaseOrders")
          .doc(String(delivery.purchaseOrderId))
          .get();
        if (poSnap.exists) {
          const po = poSnap.data()?.poNumber;
          if (typeof po === "string") poNumber = po;
        }
      }

      const itemsSnap = await db
        .collection("items")
        .where("deliveryOrderId", "==", deliveryId)
        .limit(50)
        .get();

      const items: VendorRunDeliveryItem[] = itemsSnap.docs.map((itemDoc) => {
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
          qtyOrdered:
            typeof item.qtyOrdered === "number" ? item.qtyOrdered : 0,
        };
      });

      const vendorInvoiceNumber =
        typeof delivery.vendorInvoiceNumber === "string" &&
        delivery.vendorInvoiceNumber.trim()
          ? delivery.vendorInvoiceNumber.trim()
          : undefined;

      summaries.push({
        deliveryId,
        jobId,
        jobName,
        orderNumber: String(delivery.orderNumber ?? deliveryId),
        vendorInvoiceNumber,
        poNumber,
        stagingLocationCodes,
        hasAssignableSpot: hasAssignableSpot(delivery),
        vendorPhysicalDropoffConfirmed:
          delivery.vendorPhysicalDropoffConfirmed === true,
        items,
      });
    }

    summaries.sort((a, b) => {
      const jobCmp = a.jobName.localeCompare(b.jobName);
      if (jobCmp !== 0) return jobCmp;
      return a.orderNumber.localeCompare(b.orderNumber);
    });

    return {
      vendorId: session.vendorId,
      scannedStagingLocationCode: session.scannedStagingLocationCode ?? null,
      deliveries: summaries,
    };
  },
);
