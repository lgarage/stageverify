import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { PhysicalLocation } from "./customerModels";
import { stripUndefined } from "./firestoreSerialize";
import { getDb, requireOperatorAuth } from "./operatorAuth";
import {
  CONSOLE_ACTIVITY_EVENTS_COLLECTION,
  CONSOLE_CUSTOMERS_COLLECTION,
  CONSOLE_LOCATIONS_COLLECTION,
  OPERATOR_CALLABLE_CORS,
} from "./operatorCollections";
import {
  assertSpotIdentityIsolation,
  buildActivityEvent,
  buildPhysicalLocation,
} from "./operatorMutationCore";
import {
  mintOperationId,
  readIdempotentResult,
  writeOperationMarker,
} from "./operatorIdempotency";
import { parseCreateCustomerLocationInput } from "./operatorValidation";

export const addLocationToCustomer = onCall(
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
    const existing = await readIdempotentResult<PhysicalLocation>(
      db,
      operationId,
    );
    if (existing) {
      return existing;
    }

    const locationInput = parseCreateCustomerLocationInput(data.location, 0);
    const nowIso = new Date().toISOString();
    const location = buildPhysicalLocation(customerId, locationInput, nowIso);

    const customerRef = db
      .collection(CONSOLE_CUSTOMERS_COLLECTION)
      .doc(customerId);
    const customerSnap = await customerRef.get();
    if (!customerSnap.exists) {
      throw new HttpsError("not-found", "Customer not found.");
    }

    const siblingSnap = await db
      .collection(CONSOLE_LOCATIONS_COLLECTION)
      .where("customerId", "==", customerId)
      .get();
    const siblings = siblingSnap.docs.map(
      (doc) => doc.data() as PhysicalLocation,
    );
    assertSpotIdentityIsolation([...siblings, location], "G1");

    const event = buildActivityEvent(
      {
        customerId,
        locationId: location.locationId,
        type: "location.added",
        message: `Location "${location.locationName}" added.`,
        actorUid,
      },
      nowIso,
    );

    await db.runTransaction(async (tx) => {
      const opRef = db.collection("operatorOperations").doc(operationId);
      const opSnap = await tx.get(opRef);
      if (opSnap.exists) return;

      tx.update(customerRef, { updatedAt: nowIso });
      tx.set(
        db.collection(CONSOLE_LOCATIONS_COLLECTION).doc(location.locationId),
        location,
      );
      tx.set(
        db.collection(CONSOLE_ACTIVITY_EVENTS_COLLECTION).doc(event.eventId),
        stripUndefined(event as unknown as Record<string, unknown>),
      );
      writeOperationMarker(tx, db, {
        operationId,
        operationType: "addLocationToCustomer",
        actorUid,
        result: location,
        nowIso,
      });
    });

    const replay = await readIdempotentResult<PhysicalLocation>(db, operationId);
    return replay ?? location;
  },
);
