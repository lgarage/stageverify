import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";

function getDb() {
  return admin.firestore();
}

export interface TechnicianSessionDoc {
  id: string;
  technicianId: string;
  technicianName: string;
  expiresAt: string;
  scannedStagingLocationCode?: string;
}

export interface TechnicianDayReleaseDoc {
  technicianId: string;
  releaseDate: string;
  jobIds: string[];
}

export function asTechnicianSessionToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[a-f0-9]{64}$/.test(trimmed)) return null;
  return trimmed;
}

export function todayReleaseDateUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loadSession(
  sessionToken: string,
): Promise<TechnicianSessionDoc | null> {
  const snap = await getDb()
    .collection("technicianSessions")
    .doc(sessionToken)
    .get();
  if (!snap.exists) return null;
  return snap.data() as TechnicianSessionDoc;
}

function assertNotExpired(session: TechnicianSessionDoc): void {
  const expiresMs = Date.parse(session.expiresAt);
  if (!Number.isFinite(expiresMs) || Date.now() >= expiresMs) {
    throw new HttpsError(
      "permission-denied",
      "Session expired. Enter your PIN again.",
    );
  }
}

export async function loadTechnicianDayRelease(
  technicianId: string,
  releaseDate: string,
): Promise<TechnicianDayReleaseDoc | null> {
  const docId = `${technicianId}_${releaseDate}`;
  const snap = await getDb()
    .collection("technicianDayReleases")
    .doc(docId)
    .get();
  if (!snap.exists) return null;
  return snap.data() as TechnicianDayReleaseDoc;
}

/** Validates technician session and that jobId is day-released (always-strict). */
export async function assertTechnicianSessionForJobPickup(
  sessionToken: string,
  jobId: string,
  releaseDate: string = todayReleaseDateUtc(),
): Promise<TechnicianSessionDoc> {
  const session = await loadSession(sessionToken);
  if (!session) {
    throw new HttpsError(
      "permission-denied",
      "Session expired. Enter your PIN again.",
    );
  }
  assertNotExpired(session);

  const release = await loadTechnicianDayRelease(
    session.technicianId,
    releaseDate,
  );
  const jobIds = release?.jobIds ?? [];
  if (!jobIds.includes(jobId)) {
    throw new HttpsError(
      "permission-denied",
      "This job is not released for you today.",
    );
  }

  return session;
}
