import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";

function getDb() {
  return admin.firestore();
}

export interface ManagementSessionDoc {
  id: string;
  expiresAt: string;
  createdAt: string;
  scannedStagingLocationCode: string;
  scannedStagingLocationId: string;
}

export function asManagementSessionToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[a-f0-9]{64}$/.test(trimmed)) return null;
  return trimmed;
}

async function loadSession(
  sessionToken: string,
): Promise<ManagementSessionDoc | null> {
  const snap = await getDb()
    .collection("managementSessions")
    .doc(sessionToken)
    .get();
  if (!snap.exists) return null;
  return snap.data() as ManagementSessionDoc;
}

function assertNotExpired(session: ManagementSessionDoc): void {
  const expiresMs = Date.parse(session.expiresAt);
  if (!Number.isFinite(expiresMs) || Date.now() >= expiresMs) {
    throw new HttpsError(
      "permission-denied",
      "Session expired. Enter your PIN again.",
    );
  }
}

interface CatchAllConfig {
  catchAllStagingLocationId: string;
  parcelIntakeEnabled: boolean;
}

export async function loadCatchAllConfig(): Promise<CatchAllConfig | null> {
  const snap = await getDb().collection("appSettings").doc("config").get();
  if (!snap.exists) return null;
  const data = snap.data() as {
    catchAllStagingLocationId?: string;
    parcelIntakeEnabled?: boolean;
  };
  const catchAllStagingLocationId = data.catchAllStagingLocationId?.trim() ?? "";
  if (!catchAllStagingLocationId || data.parcelIntakeEnabled !== true) {
    return null;
  }
  return {
    catchAllStagingLocationId,
    parcelIntakeEnabled: true,
  };
}

/** Validates management session and catch-all location binding (Phase 6 Slice A). */
export async function assertManagementCatchAllSession(
  sessionToken: string,
): Promise<ManagementSessionDoc> {
  const session = await loadSession(sessionToken);
  if (!session) {
    throw new HttpsError(
      "permission-denied",
      "Session expired. Enter your PIN again.",
    );
  }
  assertNotExpired(session);

  const config = await loadCatchAllConfig();
  if (!config) {
    throw new HttpsError(
      "failed-precondition",
      "Catch-all parcel intake is not configured.",
    );
  }
  if (session.scannedStagingLocationId !== config.catchAllStagingLocationId) {
    throw new HttpsError(
      "permission-denied",
      "Session is not valid for this catch-all location.",
    );
  }
  return session;
}
