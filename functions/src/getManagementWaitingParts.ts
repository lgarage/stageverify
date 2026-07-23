import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  asManagementSessionToken,
  assertManagementCatchAllSession,
} from "./managementSessionValidation";

function getDb() {
  return admin.firestore();
}

interface GetManagementWaitingPartsRequest {
  sessionToken?: string;
}

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

interface DeliveryDoc {
  jobId?: string;
  orderNumber?: string;
  vendorName?: string;
  customerPoOrReference?: string;
  vendorInvoiceNumber?: string;
  status?: DeliveryStatus;
  vendorPhysicalDropoffConfirmed?: boolean;
  reviewFlag?: { flagged?: boolean };
}

interface JobDoc {
  jobName?: string;
  name?: string;
  status?: string;
}

const WAITING_STATUSES = new Set<DeliveryStatus>(["pending", "shipped"]);

/** Jobs with expected deliveries not yet physically received (Phase 6 Slice A). */
export const getManagementWaitingParts = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const data = (request.data ?? {}) as GetManagementWaitingPartsRequest;
    const sessionToken = asManagementSessionToken(data.sessionToken);
    if (!sessionToken) {
      throw new HttpsError("invalid-argument", "Invalid session.");
    }

    await assertManagementCatchAllSession(sessionToken);

    const deliveriesSnap = await getDb()
      .collection("deliveries")
      .where("status", "in", ["pending", "shipped"])
      .limit(300)
      .get();

    const byJob = new Map<
      string,
      Array<{
        deliveryId: string;
        orderNumber: string;
        vendorName: string;
        poNumber?: string;
        vendorInvoiceNumber?: string;
        status: DeliveryStatus;
      }>
    >();

    for (const doc of deliveriesSnap.docs) {
      const delivery = doc.data() as DeliveryDoc;
      if (delivery.reviewFlag?.flagged === true) continue;
      if (doc.id.startsWith("delivery-unid-")) continue;
      if (delivery.vendorPhysicalDropoffConfirmed === true) continue;
      const status = delivery.status;
      if (!status || !WAITING_STATUSES.has(status)) continue;
      const jobId = delivery.jobId?.trim();
      if (!jobId) continue;
      const row = {
        deliveryId: doc.id,
        orderNumber: delivery.orderNumber?.trim() || doc.id,
        vendorName: delivery.vendorName?.trim() || "Vendor",
        poNumber: delivery.customerPoOrReference?.trim() || undefined,
        vendorInvoiceNumber: delivery.vendorInvoiceNumber?.trim() || undefined,
        status,
      };
      const list = byJob.get(jobId) ?? [];
      list.push(row);
      byJob.set(jobId, list);
    }

    const jobs: Array<{
      jobId: string;
      jobName: string;
      deliveries: typeof byJob extends Map<string, infer V> ? V : never;
    }> = [];

    for (const [jobId, deliveries] of byJob.entries()) {
      const jobSnap = await getDb().collection("jobs").doc(jobId).get();
      const jobData = jobSnap.exists ? (jobSnap.data() as JobDoc) : {};
      if (jobData.status === "closed") continue;
      const jobName =
        jobData.jobName?.trim() || jobData.name?.trim() || jobId;
      deliveries.sort((a, b) =>
        a.orderNumber.localeCompare(b.orderNumber, undefined, { numeric: true }),
      );
      jobs.push({ jobId, jobName, deliveries });
    }

    jobs.sort((a, b) => a.jobName.localeCompare(b.jobName));

    return { jobs };
  },
);
