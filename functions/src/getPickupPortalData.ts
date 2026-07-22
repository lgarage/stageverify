import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  hydratePublicDeliveryDetails,
  PICKUP_PORTAL_DELIVERY_STATUSES,
  PICKUP_PORTAL_NOT_READY_DETAIL_STATUSES,
} from "./deliveryDetailsResponse";
import { asPickupToken } from "./pickupTokenValidation";
import { assertPickupAccessForJob } from "./pickupAccessValidation";

function getDb() {
  return admin.firestore();
}

interface GetPickupPortalDataRequest {
  token?: string;
  technicianSessionToken?: string;
  jobId?: string;
  includeDeliveryId?: string;
}

function asJobId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : null;
}

function asOptionalDeliveryId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : undefined;
}

/** Token-gated pickup portal data — replaces public Firestore enumeration. */
export const getPickupPortalData = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const data = (request.data ?? {}) as GetPickupPortalDataRequest;
    const token = asPickupToken(data.token);
    const jobId = asJobId(data.jobId);
    const includeDeliveryId = asOptionalDeliveryId(data.includeDeliveryId);

    if (!jobId || (!token && !data.technicianSessionToken)) {
      throw new HttpsError("invalid-argument", "Invalid pickup link.");
    }

    const db = getDb();
    await assertPickupAccessForJob(db, jobId, {
      pickupToken: token ?? undefined,
      technicianSessionToken: data.technicianSessionToken,
    });

    const deliveriesSnap = await db
      .collection("deliveries")
      .where("jobId", "==", jobId)
      .get();

    const visible = deliveriesSnap.docs.filter((docSnap) => {
      const status = docSnap.data().status as string;
      return (
        PICKUP_PORTAL_DELIVERY_STATUSES.includes(status as never) ||
        PICKUP_PORTAL_NOT_READY_DETAIL_STATUSES.includes(status as never) ||
        (includeDeliveryId !== undefined && docSnap.id === includeDeliveryId)
      );
    });

    const deliveries = (
      await Promise.all(
        visible.map((docSnap) =>
          hydratePublicDeliveryDetails(db, docSnap.id),
        ),
      )
    ).filter((d): d is NonNullable<typeof d> => d !== null);

    const stagingSnap = await db.collection("stagingLocations").limit(500).get();
    const stagingLocations = stagingSnap.docs.map((docSnap) => ({
      ...(docSnap.data() as object),
      id: docSnap.id,
    }));

    return { deliveries, stagingLocations };
  },
);
