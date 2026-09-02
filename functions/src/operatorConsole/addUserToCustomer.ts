import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { OperatorUser, PhysicalLocation } from "./customerModels";
import { stripUndefined } from "./firestoreSerialize";
import { getDb, requireOperatorAuth } from "./operatorAuth";
import {
  CONSOLE_ACTIVITY_EVENTS_COLLECTION,
  CONSOLE_CUSTOMERS_COLLECTION,
  CONSOLE_LOCATIONS_COLLECTION,
  CONSOLE_USERS_COLLECTION,
  OPERATOR_CALLABLE_CORS,
} from "./operatorCollections";
import {
  assertLocationIdsBelongToCustomer,
  buildActivityEvent,
} from "./operatorMutationCore";
import {
  mintOperationId,
  operationMarkerRef,
  readIdempotentResult,
  writeOperationMarker,
} from "./operatorIdempotency";
import { newUserId } from "./operatorIds";
import { parseCreateCustomerUserInput } from "./operatorValidation";

const OPERATION_TYPE = "addUserToCustomer";

export const addUserToCustomer = onCall(
  {
    region: "us-central1",
    cors: OPERATOR_CALLABLE_CORS,
  },
  async (request) => {
    const actorUid = await requireOperatorAuth(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const operationId = mintOperationId(data.clientOperationId);
    const customerId =
      typeof data.customerId === "string" ? data.customerId.trim() : "";
    if (!customerId) {
      throw new HttpsError("invalid-argument", "customerId is required.");
    }

    const db = getDb();
    const existing = await readIdempotentResult<OperatorUser>(
      db,
      OPERATION_TYPE,
      operationId,
    );
    if (existing) {
      return existing;
    }

    const userInput = parseCreateCustomerUserInput(data.user, 0);
    const locationIds = userInput.locationIds ?? [];
    if (!locationIds.length && userInput.locationIndexes?.length) {
      throw new HttpsError(
        "invalid-argument",
        "locationIds are required when adding a user to an existing customer.",
      );
    }

    const customerRef = db
      .collection(CONSOLE_CUSTOMERS_COLLECTION)
      .doc(customerId);
    const customerSnap = await customerRef.get();
    if (!customerSnap.exists) {
      throw new HttpsError("not-found", "Customer not found.");
    }

    const locSnap = await db
      .collection(CONSOLE_LOCATIONS_COLLECTION)
      .where("customerId", "==", customerId)
      .get();
    const locations = locSnap.docs.map(
      (doc) => doc.data() as PhysicalLocation,
    );

    try {
      assertLocationIdsBelongToCustomer(customerId, locationIds, locations);
    } catch (err) {
      throw new HttpsError(
        "invalid-argument",
        err instanceof Error ? err.message : "Invalid location assignment.",
      );
    }

    const nowIso = new Date().toISOString();
    const user: OperatorUser = {
      userId: newUserId(),
      customerId,
      name: userInput.name,
      email: userInput.email,
      role: userInput.role,
      locationIds: [...locationIds],
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const event = buildActivityEvent(
      {
        customerId,
        type: "user.added",
        message: `User "${user.name}" (${user.role}) added.`,
        actorUid,
      },
      nowIso,
    );

    await db.runTransaction(async (tx) => {
      const opRef = operationMarkerRef(db, OPERATION_TYPE, operationId);
      const opSnap = await tx.get(opRef);
      if (opSnap.exists) return;

      tx.update(customerRef, { updatedAt: nowIso });
      tx.set(db.collection(CONSOLE_USERS_COLLECTION).doc(user.userId), user);
      tx.set(
        db.collection(CONSOLE_ACTIVITY_EVENTS_COLLECTION).doc(event.eventId),
        stripUndefined(event as unknown as Record<string, unknown>),
      );
      writeOperationMarker(tx, db, {
        operationId,
        operationType: "addUserToCustomer",
        actorUid,
        result: user,
        nowIso,
      });
    });

    const replay = await readIdempotentResult<OperatorUser>(
      db,
      OPERATION_TYPE,
      operationId,
    );
    return replay ?? user;
  },
);
