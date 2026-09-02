import type { Firestore, Transaction } from "firebase-admin/firestore";
import {
  OPERATOR_OPERATIONS_COLLECTION,
} from "./operatorCollections";
import { newServerOperationId } from "./operatorIds";
import { resolveClientOperationId } from "./operatorValidation";

export type OperatorOperationDoc = {
  clientOperationId: string;
  operationType: string;
  actorUid: string;
  result: unknown;
  createdAt: string;
};

/** Firestore-safe clone — drops undefined nested fields. */
export function firestoreSafeJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function mintOperationId(raw: unknown): string {
  const resolved = resolveClientOperationId(raw);
  return resolved || newServerOperationId();
}

export async function readIdempotentResult<T>(
  db: Firestore,
  operationId: string,
): Promise<T | null> {
  const snap = await db
    .collection(OPERATOR_OPERATIONS_COLLECTION)
    .doc(operationId)
    .get();
  if (!snap.exists) return null;
  const data = snap.data() as OperatorOperationDoc;
  return data.result as T;
}

export function writeOperationMarker(
  tx: Transaction,
  db: Firestore,
  input: {
    operationId: string;
    operationType: string;
    actorUid: string;
    result: unknown;
    nowIso: string;
  },
): void {
  const ref = db.collection(OPERATOR_OPERATIONS_COLLECTION).doc(input.operationId);
  tx.set(ref, {
    clientOperationId: input.operationId,
    operationType: input.operationType,
    actorUid: input.actorUid,
    result: firestoreSafeJson(input.result),
    createdAt: input.nowIso,
  } satisfies OperatorOperationDoc);
}
