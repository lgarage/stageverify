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

/** Scope idempotency markers by operationType so clientOperationId cannot cross-callables. */
export function operationMarkerDocId(
  operationType: string,
  operationId: string,
): string {
  return `${operationType}:${operationId}`;
}

export function operationMarkerRef(
  db: Firestore,
  operationType: string,
  operationId: string,
) {
  return db
    .collection(OPERATOR_OPERATIONS_COLLECTION)
    .doc(operationMarkerDocId(operationType, operationId));
}

export async function readIdempotentResult<T>(
  db: Firestore,
  operationType: string,
  operationId: string,
): Promise<T | null> {
  const snap = await operationMarkerRef(db, operationType, operationId).get();
  if (!snap.exists) return null;
  const data = snap.data() as OperatorOperationDoc;
  if (data.operationType !== operationType) return null;
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
  const ref = operationMarkerRef(db, input.operationType, input.operationId);
  tx.set(ref, {
    clientOperationId: input.operationId,
    operationType: input.operationType,
    actorUid: input.actorUid,
    result: firestoreSafeJson(input.result),
    createdAt: input.nowIso,
  } satisfies OperatorOperationDoc);
}
