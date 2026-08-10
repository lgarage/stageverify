import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { applyVendorDeliveredReceiving } from "./applyVendorDeliveredReceiving";
import {
  asDeliveryId,
  asSessionToken,
} from "./vendorSessionValidation";

function getDb() {
  return admin.firestore();
}

const MAX_BULK_IDS = 50;

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

interface MarkVendorDeliveriesBulkRequest {
  sessionToken?: string;
  deliveryIds?: string[];
  actorName?: string;
}

interface BulkMarkResult {
  deliveryId: string;
  success: boolean;
  error?: string;
  status?: DeliveryStatus;
  vendorPhysicalDropoffConfirmed?: boolean;
  idempotent?: boolean;
  itemsUpdated?: number;
}

function asActorName(value: unknown): string {
  if (typeof value !== "string") return "Vendor Driver";
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : "Vendor Driver";
}

function asDeliveryIdList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  for (const entry of value) {
    const id = asDeliveryId(entry);
    if (!id) return null;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids.length > 0 ? ids : null;
}

async function assertVendorScopeSession(sessionToken: string): Promise<void> {
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
  const session = snap.data() as {
    vendorId?: string;
    expiresAt?: string;
    sessionScope?: string;
  };

  if (session.sessionScope !== "vendor" || !session.vendorId) {
    throw new HttpsError(
      "permission-denied",
      "Session is not valid for vendor bulk mark.",
    );
  }

  const expiresMs = Date.parse(String(session.expiresAt ?? ""));
  if (!Number.isFinite(expiresMs) || Date.now() >= expiresMs) {
    throw new HttpsError(
      "permission-denied",
      "Session expired. Enter your PIN again.",
    );
  }
}

async function markOneDeliveryDelivered(
  deliveryId: string,
  sessionToken: string,
  actorName: string,
): Promise<BulkMarkResult> {
  try {
    // Bulk path is complete-all only (no per-line exceptions in Slice 1).
    const result = await applyVendorDeliveredReceiving(getDb(), {
      deliveryId,
      sessionToken,
      actorName,
      lineExceptions: [],
    });
    return {
      deliveryId,
      success: true,
      status: result.status,
      vendorPhysicalDropoffConfirmed: true,
      idempotent: result.idempotent,
      itemsUpdated: result.itemsUpdated,
    };
  } catch (err) {
    const message =
      err instanceof HttpsError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Mark delivered failed.";
    return { deliveryId, success: false, error: message };
  }
}

/** Bulk vendor DELIVERED — vendor-scoped sessions; complete-all receiving truth. */
export const markVendorDeliveriesBulk = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const data = (request.data ?? {}) as MarkVendorDeliveriesBulkRequest;
    const sessionToken = asSessionToken(data.sessionToken);
    const deliveryIds = asDeliveryIdList(data.deliveryIds);
    const actorName = asActorName(data.actorName);

    if (!sessionToken || !deliveryIds) {
      throw new HttpsError("invalid-argument", "Invalid session.");
    }

    if (deliveryIds.length > MAX_BULK_IDS) {
      throw new HttpsError(
        "invalid-argument",
        `Too many deliveries (max ${MAX_BULK_IDS}).`,
      );
    }

    await assertVendorScopeSession(sessionToken);

    const results: BulkMarkResult[] = [];
    for (const deliveryId of deliveryIds) {
      results.push(
        await markOneDeliveryDelivered(deliveryId, sessionToken, actorName),
      );
    }

    return { results };
  },
);
