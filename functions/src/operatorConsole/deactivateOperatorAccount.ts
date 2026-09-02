import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  assertNotLastActiveOperator,
  getDb,
  requireOperatorAuth,
} from "./operatorAuth";
import {
  OPERATOR_ACCOUNTS_COLLECTION,
  OPERATOR_CALLABLE_CORS,
} from "./operatorCollections";

export const deactivateOperatorAccount = onCall(
  {
    region: "us-central1",
    cors: OPERATOR_CALLABLE_CORS,
  },
  async (request) => {
    await requireOperatorAuth(request);
    const data = (request.data ?? {}) as { targetUid?: string };
    const targetUid =
      typeof data.targetUid === "string" ? data.targetUid.trim() : "";
    if (!targetUid) {
      throw new HttpsError("invalid-argument", "targetUid is required.");
    }

    await assertNotLastActiveOperator(targetUid);

    const ref = getDb().collection(OPERATOR_ACCOUNTS_COLLECTION).doc(targetUid);
    const snap = await ref.get();
    if (!snap.exists || snap.data()?.active !== true) {
      throw new HttpsError("not-found", "Active operator account not found.");
    }

    const now = new Date().toISOString();
    await ref.set({ active: false, updatedAt: now }, { merge: true });
    return { success: true, targetUid };
  },
);
