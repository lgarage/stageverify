import * as admin from "firebase-admin";
import type { Transaction } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { OPERATOR_ACCOUNTS_COLLECTION } from "./operatorCollections";

export function getDb() {
  return admin.firestore();
}

export type OperatorAccountDoc = {
  active: boolean;
  displayName?: string;
  createdAt: string;
  updatedAt: string;
  createdByUid?: string;
};

/** Fail-closed operator privilege — uid-only via operatorAccounts/{uid}.active === true. */
export async function requireOperatorAuth(
  request: CallableRequest,
): Promise<string> {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  const uid = request.auth.uid;
  const snap = await getDb()
    .collection(OPERATOR_ACCOUNTS_COLLECTION)
    .doc(uid)
    .get();
  const data = snap.data() as OperatorAccountDoc | undefined;
  if (!snap.exists || data?.active !== true) {
    throw new HttpsError("permission-denied", "Operator access required.");
  }
  return uid;
}

export async function isActiveOperator(uid: string): Promise<boolean> {
  const snap = await getDb()
    .collection(OPERATOR_ACCOUNTS_COLLECTION)
    .doc(uid)
    .get();
  const data = snap.data() as OperatorAccountDoc | undefined;
  return snap.exists && data?.active === true;
}

export async function countActiveOperators(): Promise<number> {
  const snap = await getDb()
    .collection(OPERATOR_ACCOUNTS_COLLECTION)
    .where("active", "==", true)
    .get();
  return snap.size;
}

export async function assertNotLastActiveOperator(
  targetUid: string,
): Promise<void> {
  const activeCount = await countActiveOperators();
  if (activeCount <= 1) {
    const targetSnap = await getDb()
      .collection(OPERATOR_ACCOUNTS_COLLECTION)
      .doc(targetUid)
      .get();
    const targetData = targetSnap.data() as OperatorAccountDoc | undefined;
    if (targetSnap.exists && targetData?.active === true) {
      throw new HttpsError(
        "failed-precondition",
        "Cannot deactivate the last active operator account.",
      );
    }
  }
}

/** Transaction-safe last-operator guard — query + target read inside the same tx. */
export async function assertNotLastActiveOperatorInTransaction(
  tx: Transaction,
  targetUid: string,
): Promise<void> {
  const db = getDb();
  const targetRef = db.collection(OPERATOR_ACCOUNTS_COLLECTION).doc(targetUid);
  const targetSnap = await tx.get(targetRef);
  const targetData = targetSnap.data() as OperatorAccountDoc | undefined;
  if (!targetSnap.exists || targetData?.active !== true) {
    throw new HttpsError("not-found", "Active operator account not found.");
  }

  const activeQuery = db
    .collection(OPERATOR_ACCOUNTS_COLLECTION)
    .where("active", "==", true);
  const activeSnap = await tx.get(activeQuery);
  if (activeSnap.size <= 1) {
    throw new HttpsError(
      "failed-precondition",
      "Cannot deactivate the last active operator account.",
    );
  }
}
