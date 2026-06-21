import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { applyDeliveryReadinessTransaction } from "./applyDeliveryReadiness";
import {
  asSessionToken,
  assertVendorSessionValid,
} from "./vendorSessionValidation";

function getDb() {
  return admin.firestore();
}

interface RecalculateRequest {
  deliveryOrderId?: string;
  sessionToken?: string;
}

function asDeliveryId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : null;
}

function mapApplyError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("not found")) {
    throw new HttpsError("not-found", message);
  }
  if (message.includes("too many line items")) {
    throw new HttpsError("failed-precondition", message);
  }
  if (message.includes("no items")) {
    throw new HttpsError("failed-precondition", message);
  }
  throw err instanceof Error ? err : new Error(message);
}

/** Trusted server-owned readiness recalculation — Admin SDK writes only. */
export const recalculateDeliveryReadiness = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const data = (request.data ?? {}) as RecalculateRequest;
    const deliveryOrderId = asDeliveryId(data.deliveryOrderId);
    if (!deliveryOrderId) {
      throw new HttpsError("invalid-argument", "deliveryOrderId is required.");
    }

    const sessionToken = asSessionToken(data.sessionToken);
    if (request.auth?.uid) {
      // Dispatcher / authenticated caller
    } else if (sessionToken) {
      await assertVendorSessionValid(sessionToken, deliveryOrderId);
    } else {
      throw new HttpsError(
        "permission-denied",
        "Sign in or provide a valid vendor session.",
      );
    }

    try {
      return await applyDeliveryReadinessTransaction(
        getDb(),
        deliveryOrderId,
      );
    } catch (err) {
      mapApplyError(err);
    }
  },
);
