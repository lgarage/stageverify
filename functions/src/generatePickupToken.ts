import * as admin from "firebase-admin";
import { randomBytes } from "crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  asJobId,
  DEFAULT_PICKUP_TOKEN_DAYS,
  hashPickupToken,
  isPickupTokenActive,
  PickupTokenDoc,
} from "./pickupTokenValidation";

function getDb() {
  return admin.firestore();
}

async function revokeActiveTokensForJob(
  jobId: string,
  nowIso: string,
): Promise<void> {
  const snap = await getDb()
    .collection("pickupTokens")
    .where("jobId", "==", jobId)
    .get();

  const batch = getDb().batch();
  let writes = 0;

  for (const tokenDoc of snap.docs) {
    const data = tokenDoc.data() as PickupTokenDoc;
    if (!isPickupTokenActive(data)) continue;
    batch.update(tokenDoc.ref, { revokedAt: nowIso });
    writes += 1;
  }

  if (writes > 0) {
    await batch.commit();
  }
}

export const generatePickupToken = onCall(
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

    const jobSnap = await getDb().collection("jobs").doc(jobId).get();
    if (!jobSnap.exists) {
      throw new HttpsError("not-found", "Job not found.");
    }

    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const expiresAt = new Date(
      now + DEFAULT_PICKUP_TOKEN_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    await revokeActiveTokensForJob(jobId, nowIso);

    const token = randomBytes(32).toString("hex");
    const tokenHash = hashPickupToken(token);
    const createdBy =
      request.auth.token.email ??
      request.auth.token.name ??
      request.auth.uid;

    await getDb()
      .collection("pickupTokens")
      .doc(tokenHash)
      .set({
        id: tokenHash,
        jobId,
        tokenHash,
        expiresAt,
        revokedAt: null,
        createdBy,
        createdAt: nowIso,
      });

    return {
      token,
      expiresAt,
      jobId,
    };
  },
);
