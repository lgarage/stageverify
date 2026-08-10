import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { applyVendorDeliveredReceiving } from "./applyVendorDeliveredReceiving";
import {
  asDeliveryId,
  asSessionToken,
} from "./vendorSessionValidation";
import { parseLineExceptions } from "./vendorDeliveredItemTruth";

function getDb() {
  return admin.firestore();
}

interface MarkVendorDeliveredRequest {
  deliveryId?: string;
  sessionToken?: string;
  actorName?: string;
  /** Optional exception lines; omitted/empty = complete-all (D-90). */
  lineExceptions?: unknown;
}

function asActorName(value: unknown): string {
  if (typeof value !== "string") return "Vendor Driver";
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : "Vendor Driver";
}

/** Server-owned vendor DELIVERED — session, item qty truth, readiness. */
export const markVendorDelivered = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const data = (request.data ?? {}) as MarkVendorDeliveredRequest;
    const deliveryId = asDeliveryId(data.deliveryId);
    const sessionToken = asSessionToken(data.sessionToken);
    const actorName = asActorName(data.actorName);
    const lineExceptions = parseLineExceptions(data.lineExceptions);

    if (!deliveryId || !sessionToken) {
      throw new HttpsError("invalid-argument", "Invalid session.");
    }
    if (lineExceptions === null) {
      throw new HttpsError("invalid-argument", "Invalid line exceptions.");
    }

    const result = await applyVendorDeliveredReceiving(getDb(), {
      deliveryId,
      sessionToken,
      actorName,
      lineExceptions,
    });

    return {
      deliveryId: result.deliveryId,
      status: result.status,
      vendorPhysicalDropoffConfirmed: result.vendorPhysicalDropoffConfirmed,
      vendorPhysicalDropoffConfirmedAt: result.vendorPhysicalDropoffConfirmedAt,
      idempotent: result.idempotent,
      itemsUpdated: result.itemsUpdated,
      readiness: result.readiness,
    };
  },
);
