import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  asSessionToken,
  assertVendorSessionValid,
} from "./vendorSessionValidation";
import {
  RECEIVE_BLOCKED_DELIVERY_STATUSES,
  ZONE_CLEARED_DELIVERY_STATUSES,
  getAllStagingLocationIds,
} from "./deliveryDetailsResponse";

function getDb() {
  return admin.firestore();
}

interface GetJobVendorDeliveriesRequest {
  jobId?: string;
  sessionToken?: string;
}

export interface JobVendorDeliverySummary {
  deliveryId: string;
  orderNumber: string;
  poNumber?: string;
  vendorName: string;
  status: string;
  stagingLocationCodes: string[];
  scannedStagingLocationCode?: string;
}

function asJobId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : null;
}

async function resolveLocationCodes(
  db: admin.firestore.Firestore,
  locationIds: string[],
): Promise<string[]> {
  if (locationIds.length === 0) return [];
  const codes: string[] = [];
  for (const id of locationIds) {
    const snap = await db.collection("stagingLocations").doc(id).get();
    if (snap.exists) {
      const code = snap.data()?.code;
      if (typeof code === "string" && code.trim()) {
        codes.push(code.trim());
      }
    }
  }
  return codes;
}

function collectLocationIds(delivery: admin.firestore.DocumentData): string[] {
  const ids = getAllStagingLocationIds(delivery);
  const planned = delivery.plannedStagingLocationIds;
  if (Array.isArray(planned)) {
    for (const id of planned) {
      if (typeof id === "string" && id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/** Post-PIN job-scoped delivery list — never cross-job (D14). */
export const getJobVendorDeliveries = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const data = (request.data ?? {}) as GetJobVendorDeliveriesRequest;
    const jobId = asJobId(data.jobId);
    const sessionToken = asSessionToken(data.sessionToken);

    if (!jobId || !sessionToken) {
      throw new HttpsError("invalid-argument", "Invalid session.");
    }

    const session = await assertVendorSessionValidForJob(sessionToken, jobId);
    const db = getDb();

    const deliveriesSnap = await db
      .collection("deliveries")
      .where("jobId", "==", jobId)
      .limit(100)
      .get();

    const summaries: JobVendorDeliverySummary[] = [];

    for (const docSnap of deliveriesSnap.docs) {
      const delivery = docSnap.data();
      const status = String(delivery.status ?? "");
      if (ZONE_CLEARED_DELIVERY_STATUSES.has(status as never)) continue;
      if (RECEIVE_BLOCKED_DELIVERY_STATUSES.has(status as never)) continue;

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

      summaries.push({
        deliveryId: docSnap.id,
        orderNumber: String(delivery.orderNumber ?? docSnap.id),
        poNumber,
        vendorName:
          typeof delivery.vendorName === "string" && delivery.vendorName.trim()
            ? delivery.vendorName.trim()
            : "Vendor",
        status,
        stagingLocationCodes,
        scannedStagingLocationCode: session.scannedStagingLocationCode,
      });
    }

    summaries.sort((a, b) => a.orderNumber.localeCompare(b.orderNumber));

    return {
      jobId,
      scannedStagingLocationCode: session.scannedStagingLocationCode ?? null,
      deliveries: summaries,
    };
  },
);

async function assertVendorSessionValidForJob(
  sessionToken: string,
  jobId: string,
): Promise<{
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
    jobId?: string;
    deliveryId?: string;
    expiresAt?: string;
    scannedStagingLocationCode?: string;
    sessionScope?: string;
  };

  if (session.jobId !== jobId) {
    throw new HttpsError(
      "permission-denied",
      "Session is not valid for this job.",
    );
  }

  const expiresMs = Date.parse(String(session.expiresAt ?? ""));
  if (!Number.isFinite(expiresMs) || Date.now() >= expiresMs) {
    throw new HttpsError(
      "permission-denied",
      "Session expired. Enter your PIN again.",
    );
  }

  if (session.sessionScope === "delivery" && session.deliveryId) {
    await assertVendorSessionValid(sessionToken, session.deliveryId);
  }

  return {
    scannedStagingLocationCode:
      typeof session.scannedStagingLocationCode === "string"
        ? session.scannedStagingLocationCode
        : undefined,
  };
}
