/**
 * Dispatcher Change Location — atomic reassignment of active shop staging.
 * Releases ALL prior planned/actual staging refs and sets a single new primary.
 * Does NOT change multi-spot Assign Location merge semantics (client planned merge).
 */
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { requireDispatcherAuth } from "./inboundEmail/dispatcherAuth";
import { skipsShopStaging } from "./invoice/invoiceShellDisplayHelpers";
import { assertStagingLocationAvailableInTransaction } from "./stagingOccupancyGuard";

function getDb() {
  return admin.firestore();
}

const MAX_STAGING_ID_LEN = 128;
const MAX_NOTE_LEN = 500;

interface ReassignDeliveryStagingLocationRequest {
  deliveryId?: string;
  newLocationId?: string;
  note?: string;
}

export interface ReassignDeliveryStagingLocationResult {
  ok: true;
  deliveryId: string;
  unchanged?: true;
  fromLocationId: string | null;
  releasedLocationIds: string[];
  toLocationId: string;
  toLocationCode: string;
  plannedEntriesReleased: string[];
}

function asDeliveryId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) return null;
  return trimmed;
}

function asStagingLocationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_STAGING_ID_LEN) return null;
  return trimmed;
}

function asOptionalNote(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", "Invalid note.");
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_NOTE_LEN) {
    throw new HttpsError("invalid-argument", "Note is too long.");
  }
  return trimmed || undefined;
}

function filterNonEmptyStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)];
}

function hasAnyStagingRefs(delivery: admin.firestore.DocumentData): boolean {
  const primary =
    typeof delivery.stagingLocationId === "string"
      ? delivery.stagingLocationId.trim()
      : "";
  if (primary) return true;
  if (filterNonEmptyStrings(delivery.additionalStagingLocationIds).length > 0) {
    return true;
  }
  return filterNonEmptyStrings(delivery.plannedStagingLocationIds).length > 0;
}

function dispatcherIdentity(
  request: {
    auth?: {
      uid?: string;
      token?: { email?: string; name?: string };
    };
  },
  uid: string,
): string {
  const email = request.auth?.token?.email?.trim();
  if (email) return email;
  const name = request.auth?.token?.name?.trim();
  if (name) return name;
  return uid;
}

export const reassignDeliveryStagingLocation = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request): Promise<ReassignDeliveryStagingLocationResult> => {
    const uid = await requireDispatcherAuth(request);
    const data = (request.data ?? {}) as ReassignDeliveryStagingLocationRequest;
    const deliveryId = asDeliveryId(data.deliveryId);
    const newLocationId = asStagingLocationId(data.newLocationId);
    const note = asOptionalNote(data.note);

    if (!deliveryId) {
      throw new HttpsError("invalid-argument", "deliveryId is required.");
    }
    if (!newLocationId) {
      throw new HttpsError("invalid-argument", "newLocationId is required.");
    }

    const db = getDb();
    const deliveryRef = db.collection("deliveries").doc(deliveryId);
    const releasedBy = dispatcherIdentity(request, uid);

    let result: ReassignDeliveryStagingLocationResult | null = null;

    await db.runTransaction(async (tx) => {
      const deliverySnap = await tx.get(deliveryRef);
      if (!deliverySnap.exists) {
        throw new HttpsError("not-found", "Delivery not found.");
      }
      const delivery = deliverySnap.data() as admin.firestore.DocumentData;
      const status = String(delivery.status ?? "");

      if (status === "picked_up" || status === "installed") {
        throw new HttpsError(
          "failed-precondition",
          "Delivery is no longer editable for staging.",
        );
      }
      if (
        skipsShopStaging({
          id: deliveryId,
          vendorInvoiceImportId:
            typeof delivery.vendorInvoiceImportId === "string"
              ? delivery.vendorInvoiceImportId
              : undefined,
          invoiceImportStatus:
            typeof delivery.invoiceImportStatus === "string"
              ? delivery.invoiceImportStatus
              : undefined,
          invoiceFulfillmentMethod: delivery.invoiceFulfillmentMethod,
          invoiceDeliverToSite: delivery.invoiceDeliverToSite === true,
          createdFromInvoiceImport: delivery.createdFromInvoiceImport === true,
        })
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Will-Call / Pickup from Vendor has no shop staging to change.",
        );
      }
      if (!hasAnyStagingRefs(delivery)) {
        throw new HttpsError(
          "failed-precondition",
          "No staging assignment to change — use Assign Location.",
        );
      }

      const oldPrimary =
        typeof delivery.stagingLocationId === "string"
          ? delivery.stagingLocationId.trim()
          : "";
      const oldAdditional = filterNonEmptyStrings(
        delivery.additionalStagingLocationIds,
      );
      const oldPlanned = filterNonEmptyStrings(
        delivery.plannedStagingLocationIds,
      );
      const oldActiveIds = dedupe(
        [oldPrimary, ...oldAdditional].filter(Boolean),
      );

      const alreadyTarget =
        oldPrimary === newLocationId &&
        oldAdditional.length === 0 &&
        oldPlanned.length === 0;

      if (alreadyTarget) {
        const locSnap = await tx.get(
          db.collection("stagingLocations").doc(newLocationId),
        );
        const toLocationCode = locSnap.exists
          ? String(locSnap.data()?.code ?? "").trim() || newLocationId
          : newLocationId;
        result = {
          ok: true,
          unchanged: true,
          deliveryId,
          fromLocationId: oldPrimary || null,
          releasedLocationIds: [],
          toLocationId: newLocationId,
          toLocationCode,
          plannedEntriesReleased: [],
        };
        return;
      }

      const { code: toLocationCode } =
        await assertStagingLocationAvailableInTransaction(
          tx,
          db,
          newLocationId,
          deliveryId,
        );

      const now = new Date().toISOString();
      const releasedAuditIds = oldPlanned.filter((id) => id !== newLocationId);
      const patch: Record<string, unknown> = {
        stagingLocationId: newLocationId,
        additionalStagingLocationIds: [],
        plannedStagingLocationIds: [],
        updatedAt: now,
      };
      if (releasedAuditIds.length > 0) {
        patch.plannedLocationReleases = FieldValue.arrayUnion(
          ...releasedAuditIds.map((id) => ({
            locationId: id,
            releasedAt: now,
            releasedBy,
            reason: "dispatcher_change_location",
            ...(note ? { note } : {}),
          })),
        );
      }

      tx.update(deliveryRef, patch);

      result = {
        ok: true,
        deliveryId,
        fromLocationId: oldPrimary || null,
        releasedLocationIds: oldActiveIds,
        toLocationId: newLocationId,
        toLocationCode,
        plannedEntriesReleased: oldPlanned,
      };
    });

    if (!result) {
      throw new HttpsError("internal", "Reassignment did not complete.");
    }
    return result;
  },
);
