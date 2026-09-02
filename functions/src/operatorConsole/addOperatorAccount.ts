import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getDb, requireOperatorAuth } from "./operatorAuth";
import { stripUndefined } from "./firestoreSerialize";
import {
  OPERATOR_ACCOUNTS_COLLECTION,
  OPERATOR_CALLABLE_CORS,
} from "./operatorCollections";

export const addOperatorAccount = onCall(
  {
    region: "us-central1",
    cors: OPERATOR_CALLABLE_CORS,
  },
  async (request) => {
    const actorUid = await requireOperatorAuth(request);
    const data = (request.data ?? {}) as {
      targetUid?: string;
      displayName?: string;
    };
    const targetUid =
      typeof data.targetUid === "string" ? data.targetUid.trim() : "";
    if (!targetUid) {
      throw new HttpsError("invalid-argument", "targetUid is required.");
    }

    const activeCount = await getDb()
      .collection(OPERATOR_ACCOUNTS_COLLECTION)
      .where("active", "==", true)
      .get();
    if (activeCount.empty) {
      throw new HttpsError(
        "failed-precondition",
        "First operator must be bootstrapped via scripts/operator/bootstrap-first-operator.mjs.",
      );
    }

    try {
      await admin.auth().getUser(targetUid);
    } catch {
      throw new HttpsError("not-found", "Target user does not exist in Auth.");
    }

    const existing = await getDb()
      .collection(OPERATOR_ACCOUNTS_COLLECTION)
      .doc(targetUid)
      .get();
    if (existing.exists && existing.data()?.active === true) {
      throw new HttpsError(
        "already-exists",
        "Target user is already an active operator.",
      );
    }

    const now = new Date().toISOString();
    const displayName =
      typeof data.displayName === "string" ? data.displayName.trim() : "";

    await getDb()
      .collection(OPERATOR_ACCOUNTS_COLLECTION)
      .doc(targetUid)
      .set(
        stripUndefined({
          active: true,
          displayName: displayName || undefined,
          createdAt: existing.exists
            ? (existing.data()?.createdAt as string) ?? now
            : now,
          updatedAt: now,
          createdByUid: actorUid,
        }),
        { merge: true },
      );

    return { success: true, targetUid };
  },
);
