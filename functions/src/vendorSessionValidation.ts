import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";

function getDb() {
  return admin.firestore();
}

export type VendorSessionScope = "delivery" | "job" | "vendor";

export interface VendorSessionDoc {
  id: string;
  deliveryId: string;
  vendorId: string;
  vendorName: string;
  expiresAt: string;
  sessionScope?: VendorSessionScope;
  jobId?: string;
  scannedStagingLocationId?: string;
  scannedStagingLocationCode?: string;
}

export function asSessionToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[a-f0-9]{64}$/.test(trimmed)) return null;
  return trimmed;
}

export function asDeliveryId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : null;
}

async function loadSession(
  sessionToken: string,
): Promise<VendorSessionDoc | null> {
  const snap = await getDb()
    .collection("vendorSessions")
    .doc(sessionToken)
    .get();
  if (!snap.exists) return null;
  return snap.data() as VendorSessionDoc;
}

function assertNotExpired(session: VendorSessionDoc): void {
  const expiresMs = Date.parse(session.expiresAt);
  if (!Number.isFinite(expiresMs) || Date.now() >= expiresMs) {
    throw new HttpsError(
      "permission-denied",
      "Session expired. Enter your PIN again.",
    );
  }
}

/** Validates opaque vendor session token is active and bound to deliveryId. */
export async function assertVendorSessionValid(
  sessionToken: string,
  deliveryId: string,
): Promise<VendorSessionDoc> {
  return assertVendorSessionForDelivery(sessionToken, deliveryId);
}

/** Job-scoped or delivery-scoped session check for a specific delivery. */
export async function assertVendorSessionForDelivery(
  sessionToken: string,
  deliveryId: string,
): Promise<VendorSessionDoc> {
  const session = await loadSession(sessionToken);
  if (!session) {
    throw new HttpsError(
      "permission-denied",
      "Session expired. Enter your PIN again.",
    );
  }

  assertNotExpired(session);

  if (session.sessionScope === "vendor") {
    const deliverySnap = await getDb()
      .collection("deliveries")
      .doc(deliveryId)
      .get();
    if (!deliverySnap.exists) {
      throw new HttpsError("not-found", "Delivery not found.");
    }
    const deliveryVendorId = String(deliverySnap.data()?.vendorId ?? "");
    if (deliveryVendorId !== session.vendorId) {
      throw new HttpsError(
        "permission-denied",
        "Session is not valid for this delivery.",
      );
    }
    return session;
  }

  if (session.sessionScope === "job" && session.jobId) {
    const deliverySnap = await getDb()
      .collection("deliveries")
      .doc(deliveryId)
      .get();
    if (!deliverySnap.exists) {
      throw new HttpsError("not-found", "Delivery not found.");
    }
    const deliveryJobId = String(deliverySnap.data()?.jobId ?? "");
    if (deliveryJobId !== session.jobId) {
      throw new HttpsError(
        "permission-denied",
        "Session is not valid for this delivery.",
      );
    }
    return session;
  }

  if (session.deliveryId !== deliveryId) {
    throw new HttpsError(
      "permission-denied",
      "Session is not valid for this delivery.",
    );
  }

  return session;
}
