import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  asJobId,
  isPickupTokenActive,
  PickupTokenDoc,
} from "./pickupTokenValidation";

function getDb() {
  return admin.firestore();
}

export const getPickupTokenStatus = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }

    const jobId = asJobId((request.data as { jobId?: string })?.jobId);
    if (!jobId) {
      throw new HttpsError("invalid-argument", "Invalid job.");
    }

    const snap = await getDb()
      .collection("pickupTokens")
      .where("jobId", "==", jobId)
      .get();

    let active: PickupTokenDoc | null = null;
    for (const tokenDoc of snap.docs) {
      const data = tokenDoc.data() as PickupTokenDoc;
      if (!isPickupTokenActive(data)) continue;
      if (
        !active ||
        Date.parse(data.createdAt) > Date.parse(active.createdAt)
      ) {
        active = data;
      }
    }

    if (!active) {
      return { hasActiveToken: false };
    }

    return {
      hasActiveToken: true,
      expiresAt: active.expiresAt,
      createdAt: active.createdAt,
      createdBy: active.createdBy,
    };
  },
);
