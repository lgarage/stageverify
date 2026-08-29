import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  computeDeliveryReadiness,
  getShopStagingAssignmentIds,
  type DeliveryDoc,
  type ItemDoc,
  type VendorDeliveryMode,
} from "./deliveryReadiness";
import {
  asTechnicianSessionToken,
  loadTechnicianDayRelease,
  todayReleaseDateUtc,
} from "./technicianSessionValidation";

function getDb() {
  return admin.firestore();
}

interface GetTechnicianReleasedJobsRequest {
  sessionToken?: string;
}

interface JobDoc {
  jobName?: string;
  name?: string;
}

export interface TechnicianReleasedJobRow {
  jobId: string;
  jobName: string;
  stagingLocationCodes: string[];
  deliveryCount: number;
  readyForPickupCount: number;
}

/** Loose match key: strip dashes/spaces, uppercase (parity with FE stagingCode.ts). */
function normalizeStagingCodeKey(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function formatStagingCodeCanonical(raw: string): string {
  const key = normalizeStagingCodeKey(raw);
  if (!key) return raw.trim();

  const shelfBin = /^S(\d+)([A-Z])$/.exec(key);
  if (shelfBin) return `S${shelfBin[1]}-${shelfBin[2]}`;

  const ground = /^G(\d+)$/.exec(key);
  if (ground) return `G${ground[1]}`;

  return key;
}

function resolveStagingLocationCodes(
  rawIds: string[],
  codeById: Map<string, string>,
  codeKeyToCanonical: Map<string, string>,
): string[] {
  const codes = new Set<string>();
  for (const rawId of rawIds) {
    const id = typeof rawId === "string" ? rawId.trim() : "";
    if (!id) continue;
    const byId = codeById.get(id);
    if (byId?.trim()) {
      codes.add(formatStagingCodeCanonical(byId));
      continue;
    }
    const canonical = codeKeyToCanonical.get(normalizeStagingCodeKey(id));
    if (canonical) codes.add(canonical);
  }
  return [...codes].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
  );
}

async function loadSession(sessionToken: string) {
  const snap = await getDb()
    .collection("technicianSessions")
    .doc(sessionToken)
    .get();
  if (!snap.exists) return null;
  const data = snap.data() as {
    technicianId: string;
    technicianName: string;
    expiresAt: string;
    scannedStagingLocationCode?: string;
  };
  const expiresMs = Date.parse(data.expiresAt);
  if (!Number.isFinite(expiresMs) || Date.now() >= expiresMs) {
    throw new HttpsError(
      "permission-denied",
      "Session expired. Enter your PIN again.",
    );
  }
  return data;
}

async function loadItemsForDelivery(deliveryId: string): Promise<ItemDoc[]> {
  const itemsSnap = await getDb()
    .collection("items")
    .where("deliveryOrderId", "==", deliveryId)
    .limit(500)
    .get();
  return itemsSnap.docs.map((doc) => doc.data() as ItemDoc);
}

/** Always-strict: returns only day-released jobs (empty array when none). */
export const getTechnicianReleasedJobs = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const data = (request.data ?? {}) as GetTechnicianReleasedJobsRequest;
    const sessionToken = asTechnicianSessionToken(data.sessionToken);
    if (!sessionToken) {
      throw new HttpsError("invalid-argument", "Invalid session.");
    }

    const session = await loadSession(sessionToken);
    if (!session) {
      throw new HttpsError(
        "permission-denied",
        "Session expired. Enter your PIN again.",
      );
    }

    const releaseDate = todayReleaseDateUtc();
    const release = await loadTechnicianDayRelease(
      session.technicianId,
      releaseDate,
    );
    const jobIds = release?.jobIds ?? [];

    if (jobIds.length === 0) {
      return {
        jobs: [] as TechnicianReleasedJobRow[],
        releaseDate,
        scannedStagingLocationCode: session.scannedStagingLocationCode ?? null,
        technicianName: session.technicianName,
      };
    }

    const stagingSnap = await getDb()
      .collection("stagingLocations")
      .limit(500)
      .get();
    const codeById = new Map<string, string>();
    const codeKeyToCanonical = new Map<string, string>();
    for (const doc of stagingSnap.docs) {
      const code = String(doc.data().code ?? doc.id);
      codeById.set(doc.id, code);
      const canonical = formatStagingCodeCanonical(code);
      if (canonical) codeKeyToCanonical.set(normalizeStagingCodeKey(code), canonical);
    }

    const settingsSnap = await getDb()
      .collection("appSettings")
      .doc("config")
      .get();
    const vendorDeliveryMode =
      (settingsSnap.data()?.vendorDeliveryMode as VendorDeliveryMode | undefined) ??
      "full_checkin";

    const now = new Date().toISOString();
    const jobs: TechnicianReleasedJobRow[] = [];

    for (const jobId of jobIds) {
      const jobSnap = await getDb().collection("jobs").doc(jobId).get();
      const jobData = jobSnap.exists ? (jobSnap.data() as JobDoc) : {};
      const jobName =
        jobData.jobName?.trim() ||
        jobData.name?.trim() ||
        jobId;

      const deliveriesSnap = await getDb()
        .collection("deliveries")
        .where("jobId", "==", jobId)
        .limit(100)
        .get();

      const locationIdSet = new Set<string>();
      let deliveryCount = 0;
      let readyForPickupCount = 0;

      for (const doc of deliveriesSnap.docs) {
        const delivery = doc.data() as DeliveryDoc;
        deliveryCount += 1;

        const items = await loadItemsForDelivery(doc.id);
        const readiness = computeDeliveryReadiness(
          delivery,
          items,
          now,
          vendorDeliveryMode,
        );
        if (readiness.readyForPickup) {
          readyForPickupCount += 1;
        }

        for (const locId of getShopStagingAssignmentIds(delivery)) {
          locationIdSet.add(locId);
        }
      }

      const stagingLocationCodes = resolveStagingLocationCodes(
        [...locationIdSet],
        codeById,
        codeKeyToCanonical,
      );

      jobs.push({
        jobId,
        jobName,
        stagingLocationCodes,
        deliveryCount,
        readyForPickupCount,
      });
    }

    jobs.sort((a, b) => {
      const aScanned =
        session.scannedStagingLocationCode &&
        a.stagingLocationCodes.includes(session.scannedStagingLocationCode)
          ? 0
          : 1;
      const bScanned =
        session.scannedStagingLocationCode &&
        b.stagingLocationCodes.includes(session.scannedStagingLocationCode)
          ? 0
          : 1;
      if (aScanned !== bScanned) return aScanned - bScanned;
      return a.jobName.localeCompare(b.jobName);
    });

    return {
      jobs,
      releaseDate,
      scannedStagingLocationCode: session.scannedStagingLocationCode ?? null,
      technicianName: session.technicianName,
    };
  },
);
