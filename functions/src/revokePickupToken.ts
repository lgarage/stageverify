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

export const revokePickupToken = onCall(
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

    const nowIso = new Date().toISOString();
    const snap = await getDb()
      .collection("pickupTokens")
      .where("jobId", "==", jobId)
      .get();

    const batch = getDb().batch();
    let revoked = 0;

    for (const tokenDoc of snap.docs) {
      const data = tokenDoc.data() as PickupTokenDoc;
      if (!isPickupTokenActive(data)) continue;
      batch.update(tokenDoc.ref, { revokedAt: nowIso });
      revoked += 1;
    }

    if (revoked > 0) {
      await batch.commit();
    }

    return { success: true, revokedCount: revoked };
  },
);
