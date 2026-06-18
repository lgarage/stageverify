import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";

function getDb() {
  return admin.firestore();
}

export interface VendorSessionDoc {
  id: string;
  deliveryId: string;
  vendorId: string;
  vendorName: string;
  expiresAt: string;
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

/** Validates opaque vendor session token is active and bound to deliveryId. */
export async function assertVendorSessionValid(
  sessionToken: string,
  deliveryId: string,
): Promise<VendorSessionDoc> {
  const snap = await getDb()
    .collection("vendorSessions")
    .doc(sessionToken)
    .get();
  if (!snap.exists) {
    throw new HttpsError(
      "permission-denied",
      "Session expired. Enter your PIN again.",
    );
  }

  const session = snap.data() as VendorSessionDoc;
  if (session.deliveryId !== deliveryId) {
    throw new HttpsError(
      "permission-denied",
      "Session is not valid for this delivery.",
    );
  }

  const expiresMs = Date.parse(session.expiresAt);
  if (!Number.isFinite(expiresMs) || Date.now() >= expiresMs) {
    throw new HttpsError(
      "permission-denied",
      "Session expired. Enter your PIN again.",
    );
  }

  return session;
}
