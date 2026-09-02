import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  assertNotLastActiveOperatorInTransaction,
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

    const db = getDb();
    const ref = db.collection(OPERATOR_ACCOUNTS_COLLECTION).doc(targetUid);
    const now = new Date().toISOString();

    await db.runTransaction(async (tx) => {
      await assertNotLastActiveOperatorInTransaction(tx, targetUid);
      tx.set(ref, { active: false, updatedAt: now }, { merge: true });
    });

    return { success: true, targetUid };
  },
);
