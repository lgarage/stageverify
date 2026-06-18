import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  asPickupToken,
  hashPickupToken,
  isPickupTokenActive,
  PickupTokenDoc,
} from "./pickupTokenValidation";

function getDb() {
  return admin.firestore();
}

export const validatePickupToken = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const token = asPickupToken(
      (request.data as { token?: string })?.token,
    );
    if (!token) {
      throw new HttpsError("invalid-argument", "Invalid pickup link.");
    }

    const tokenHash = hashPickupToken(token);
    const snap = await getDb().collection("pickupTokens").doc(tokenHash).get();
    if (!snap.exists) {
      throw new HttpsError(
        "not-found",
        "Invalid or expired pickup link.",
      );
    }

    const data = snap.data() as PickupTokenDoc;
    if (!isPickupTokenActive(data)) {
      throw new HttpsError(
        "permission-denied",
        "Invalid or expired pickup link.",
      );
    }

    return {
      valid: true,
      jobId: data.jobId,
      expiresAt: data.expiresAt,
    };
  },
);
