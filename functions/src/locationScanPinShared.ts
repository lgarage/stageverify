import * as admin from "firebase-admin";
import { createHash, randomBytes } from "crypto";
import { HttpsError } from "firebase-functions/v2/https";
import {
  findTechnicianByAccessPinSecrets,
  findVendorByAccessPinSecrets,
} from "./accessPinLookup";
import { asAccessPin, pinMatches } from "./pinMatching";
import type { VendorSessionScope } from "./vendorSessionValidation";

export { asAccessPin };

function getDb() {
  return admin.firestore();
}

export const MAX_ATTEMPTS_PER_WINDOW = 8;
export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
export const MIN_ATTEMPT_INTERVAL_MS = 750;
export const DEFAULT_TECHNICIAN_SESSION_MINUTES = 15;
export const DEFAULT_VENDOR_SESSION_MINUTES = 15;
export const DEFAULT_MANAGEMENT_SESSION_MINUTES = 30;

interface PinAttemptDoc {
  count?: number;
  windowStartedAt?: string;
  lastAttemptAt?: string;
}

export function asStagingLocationCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 32) return null;
  return trimmed;
}

export async function resolveStagingLocation(
  code: string,
): Promise<{ id: string; code: string } | null> {
  const snap = await getDb()
    .collection("stagingLocations")
    .where("code", "==", code)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, code: String(doc.data().code ?? code) };
}

export async function checkPinRateLimit(
  collectionName: string,
  attemptKey: string,
): Promise<void> {
  const ref = getDb().collection(collectionName).doc(attemptKey);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  await getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = (snap.exists ? snap.data() : {}) as PinAttemptDoc;
    const windowStart = data.windowStartedAt
      ? Date.parse(data.windowStartedAt)
      : now;
    const inWindow = now - windowStart < ATTEMPT_WINDOW_MS;
    const count = inWindow ? (data.count ?? 0) : 0;

    if (inWindow && count >= MAX_ATTEMPTS_PER_WINDOW) {
      throw new HttpsError(
        "resource-exhausted",
        "Too many attempts. Try again later.",
      );
    }

    const lastAttempt = data.lastAttemptAt
      ? Date.parse(data.lastAttemptAt)
      : 0;
    if (lastAttempt && now - lastAttempt < MIN_ATTEMPT_INTERVAL_MS) {
      throw new HttpsError(
        "resource-exhausted",
        "Please wait a moment before trying again.",
      );
    }

    tx.set(
      ref,
      {
        count: inWindow ? count + 1 : 1,
        windowStartedAt: inWindow
          ? data.windowStartedAt ?? nowIso
          : nowIso,
        lastAttemptAt: nowIso,
      },
      { merge: true },
    );
  });
}

export async function clearPinRateLimit(
  collectionName: string,
  attemptKey: string,
): Promise<void> {
  await getDb().collection(collectionName).doc(attemptKey).delete();
}

export async function getTechnicianSessionMinutes(): Promise<number> {
  const snap = await getDb().collection("appSettings").doc("config").get();
  if (!snap.exists) return DEFAULT_TECHNICIAN_SESSION_MINUTES;
  const minutes = (snap.data() as { technicianSessionMinutes?: number })
    .technicianSessionMinutes;
  if (
    typeof minutes === "number" &&
    Number.isFinite(minutes) &&
    minutes >= 5 &&
    minutes <= 480
  ) {
    return minutes;
  }
  return DEFAULT_TECHNICIAN_SESSION_MINUTES;
}

export async function getVendorSessionMinutes(): Promise<number> {
  const snap = await getDb().collection("appSettings").doc("config").get();
  if (!snap.exists) return DEFAULT_VENDOR_SESSION_MINUTES;
  const minutes = (snap.data() as { vendorSessionMinutes?: number })
    .vendorSessionMinutes;
  if (
    typeof minutes === "number" &&
    Number.isFinite(minutes) &&
    minutes >= 5 &&
    minutes <= 480
  ) {
    return minutes;
  }
  return DEFAULT_VENDOR_SESSION_MINUTES;
}

export async function getManagementSessionMinutes(): Promise<number> {
  const snap = await getDb().collection("appSettings").doc("config").get();
  if (!snap.exists) return DEFAULT_MANAGEMENT_SESSION_MINUTES;
  const minutes = (snap.data() as { managementSessionMinutes?: number })
    .managementSessionMinutes;
  if (
    typeof minutes === "number" &&
    Number.isFinite(minutes) &&
    minutes >= 5 &&
    minutes <= 480
  ) {
    return minutes;
  }
  return DEFAULT_MANAGEMENT_SESSION_MINUTES;
}

export interface TechnicianDoc {
  name?: string;
  pinCode?: string;
  pinHash?: string;
  active?: boolean;
  permissions?: {
    doorScan?: boolean;
    receiveReleases?: boolean;
  };
}

export interface VendorDoc {
  id?: string;
  vendorId?: string;
  name?: string;
  vendorName?: string;
  pinCode?: string;
  pinHash?: string;
  active?: boolean;
  companyWideSessionEnabled?: boolean;
}

export interface JobDoc {
  pinCode?: string;
  pinHash?: string;
  status?: string;
}

export function vendorDisplayName(vendor: VendorDoc): string {
  return vendor.name ?? vendor.vendorName ?? "Vendor";
}

export async function findTechnicianByPin(
  pin: string,
): Promise<{ id: string; data: TechnicianDoc } | null> {
  const fromSecrets = await findTechnicianByAccessPinSecrets(pin);
  if (fromSecrets) return fromSecrets;

  const db = getDb();
  const pinCodeSnap = await db
    .collection("technicians")
    .where("pinCode", "==", pin)
    .limit(2)
    .get();
  if (pinCodeSnap.size === 1) {
    const doc = pinCodeSnap.docs[0];
    const data = doc.data() as TechnicianDoc;
    if (data.active === false) return null;
    if (data.permissions?.doorScan === false) return null;
    return { id: doc.id, data };
  }
  if (pinCodeSnap.size > 1) return null;

  const all = await db.collection("technicians").limit(200).get();
  for (const doc of all.docs) {
    const tech = doc.data() as TechnicianDoc;
    if (tech.active === false) continue;
    if (tech.permissions?.doorScan === false) continue;
    if (pinMatches(tech, pin)) {
      return { id: doc.id, data: tech };
    }
  }
  return null;
}

export async function findJobByPin(
  pin: string,
): Promise<{ id: string; data: JobDoc } | null> {
  const db = getDb();
  const pinCodeSnap = await db
    .collection("jobs")
    .where("pinCode", "==", pin)
    .limit(2)
    .get();
  if (pinCodeSnap.size === 1) {
    return {
      id: pinCodeSnap.docs[0].id,
      data: pinCodeSnap.docs[0].data() as JobDoc,
    };
  }
  if (pinCodeSnap.size > 1) return null;

  const allJobs = await db.collection("jobs").limit(500).get();
  for (const doc of allJobs.docs) {
    const job = doc.data() as JobDoc;
    if (pinMatches(job, pin)) {
      return { id: doc.id, data: job };
    }
  }
  return null;
}

export async function findVendorByCompanyPin(
  pin: string,
): Promise<{ id: string; data: VendorDoc } | null> {
  const fromSecrets = await findVendorByAccessPinSecrets(pin);
  if (fromSecrets) return fromSecrets;

  const db = getDb();
  const pinCodeSnap = await db
    .collection("vendors")
    .where("pinCode", "==", pin)
    .where("companyWideSessionEnabled", "==", true)
    .limit(2)
    .get();

  const candidates: Array<{ id: string; data: VendorDoc }> = [];
  for (const doc of pinCodeSnap.docs) {
    const vendor = doc.data() as VendorDoc;
    if (vendor.active === false) continue;
    candidates.push({ id: doc.id, data: vendor });
  }

  if (candidates.length === 1) {
    return candidates[0];
  }
  if (candidates.length > 1) return null;

  const allVendors = await db
    .collection("vendors")
    .where("companyWideSessionEnabled", "==", true)
    .limit(200)
    .get();

  for (const doc of allVendors.docs) {
    const vendor = doc.data() as VendorDoc;
    if (vendor.active === false) continue;
    if (pinMatches(vendor, pin)) {
      return { id: doc.id, data: vendor };
    }
  }
  return null;
}

export async function anchorDeliveryForVendor(
  vendorId: string,
): Promise<string | null> {
  const snap = await getDb()
    .collection("deliveries")
    .where("vendorId", "==", vendorId)
    .limit(20)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].id;
}

export async function primaryVendorForJob(jobId: string): Promise<{
  vendorId: string;
  vendorName: string;
  deliveryId: string;
} | null> {
  const snap = await getDb()
    .collection("deliveries")
    .where("jobId", "==", jobId)
    .limit(20)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  const delivery = doc.data() as {
    vendorId: string;
    vendorName?: string;
  };
  const vendorSnap = await getDb()
    .collection("vendors")
    .doc(delivery.vendorId)
    .get();
  const vendor = vendorSnap.exists
    ? (vendorSnap.data() as VendorDoc)
    : { name: "Vendor" };
  return {
    vendorId: delivery.vendorId,
    vendorName: vendorDisplayName(vendor),
    deliveryId: doc.id,
  };
}

export async function createVendorSession(input: {
  deliveryId: string;
  vendorId: string;
  vendorName: string;
  sessionScope: VendorSessionScope;
  jobId?: string;
  scannedStagingLocationId?: string;
  scannedStagingLocationCode?: string;
  unplannedEligible?: boolean;
}): Promise<{ sessionToken: string; expiresAt: string }> {
  const sessionMinutes = await getVendorSessionMinutes();
  const now = Date.now();
  const expiresAt = new Date(
    now + sessionMinutes * 60 * 1000,
  ).toISOString();
  const sessionToken = randomBytes(32).toString("hex");

  await getDb().collection("vendorSessions").doc(sessionToken).set({
    id: sessionToken,
    deliveryId: input.deliveryId,
    vendorId: input.vendorId,
    vendorName: input.vendorName,
    expiresAt,
    createdAt: new Date(now).toISOString(),
    sessionScope: input.sessionScope,
    ...(input.jobId ? { jobId: input.jobId } : {}),
    ...(input.scannedStagingLocationId
      ? { scannedStagingLocationId: input.scannedStagingLocationId }
      : {}),
    ...(input.scannedStagingLocationCode
      ? { scannedStagingLocationCode: input.scannedStagingLocationCode }
      : {}),
    ...(input.unplannedEligible ? { unplannedEligible: true } : {}),
  });

  return { sessionToken, expiresAt };
}

export async function writeVendorPinVerifiedAudit(input: {
  deliveryId: string;
  vendorId: string;
  vendorName: string;
  jobId?: string;
  stagingLocationCode?: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const eventId = `pin-${createHash("sha256")
    .update(`${input.deliveryId}:${now}:${randomBytes(8).toString("hex")}`)
    .digest("hex")
    .slice(0, 24)}`;

  await getDb().collection("pinVerificationEvents").doc(eventId).set({
    id: eventId,
    deliveryOrderId: input.deliveryId,
    vendorId: input.vendorId,
    vendorName: input.vendorName,
    pinVerified: true,
    action: "PIN_VERIFIED",
    timestamp: now,
    createdAt: now,
    ...(input.jobId ? { jobId: input.jobId } : {}),
    ...(input.stagingLocationCode
      ? { stagingLocationCode: input.stagingLocationCode }
      : {}),
  });
}

export async function mintTechnicianSession(input: {
  technicianId: string;
  technicianName: string;
  stagingLocationCode: string;
  resolvedLocation: { id: string; code: string } | null;
}): Promise<{
  sessionToken: string;
  expiresAt: string;
  scannedStagingLocationCode: string;
}> {
  const sessionMinutes = await getTechnicianSessionMinutes();
  const now = Date.now();
  const expiresAt = new Date(
    now + sessionMinutes * 60 * 1000,
  ).toISOString();
  const sessionToken = randomBytes(32).toString("hex");
  const scannedStagingLocationCode =
    input.resolvedLocation?.code ?? input.stagingLocationCode;

  await getDb().collection("technicianSessions").doc(sessionToken).set({
    id: sessionToken,
    technicianId: input.technicianId,
    technicianName: input.technicianName,
    expiresAt,
    createdAt: new Date(now).toISOString(),
    scannedStagingLocationCode,
  });

  const eventId = `tech-pin-${createHash("sha256")
    .update(`${input.technicianId}:${now}:${randomBytes(8).toString("hex")}`)
    .digest("hex")
    .slice(0, 24)}`;

  await getDb().collection("pinVerificationEvents").doc(eventId).set({
    id: eventId,
    technicianId: input.technicianId,
    technicianName: input.technicianName,
    pinVerified: true,
    action: "TECH_PIN_VERIFIED",
    timestamp: new Date(now).toISOString(),
    createdAt: new Date(now).toISOString(),
    stagingLocationCode: scannedStagingLocationCode,
  });

  return { sessionToken, expiresAt, scannedStagingLocationCode };
}

export async function mintManagementSession(input: {
  location: { id: string; code: string };
  pinId: string;
  permissions: Record<string, boolean>;
}): Promise<{
  sessionToken: string;
  expiresAt: string;
  scannedStagingLocationCode: string;
}> {
  const sessionMinutes = await getManagementSessionMinutes();
  const now = Date.now();
  const expiresAt = new Date(
    now + sessionMinutes * 60 * 1000,
  ).toISOString();
  const sessionToken = randomBytes(32).toString("hex");

  await getDb().collection("managementSessions").doc(sessionToken).set({
    id: sessionToken,
    expiresAt,
    createdAt: new Date(now).toISOString(),
    scannedStagingLocationCode: input.location.code,
    scannedStagingLocationId: input.location.id,
    pinId: input.pinId,
    permissions: input.permissions,
  });

  const eventId = `mgmt-pin-${createHash("sha256")
    .update(`${input.location.id}:${now}:${randomBytes(8).toString("hex")}`)
    .digest("hex")
    .slice(0, 24)}`;

  await getDb().collection("pinVerificationEvents").doc(eventId).set({
    id: eventId,
    pinVerified: true,
    action: "MANAGEMENT_PIN_VERIFIED",
    timestamp: new Date(now).toISOString(),
    createdAt: new Date(now).toISOString(),
    stagingLocationCode: input.location.code,
    pinId: input.pinId,
  });

  return {
    sessionToken,
    expiresAt,
    scannedStagingLocationCode: input.location.code,
  };
}
