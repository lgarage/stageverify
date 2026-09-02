import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CustomerBundle } from "./customerModels";
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
  assertSpotIdentityIsolation,
  buildActivityEvent,
  buildCustomerBundle,
  buildPhysicalLocation,
  buildUsersForCustomer,
  newCustomerRecord,
} from "./operatorMutationCore";
import {
  mintOperationId,
  readIdempotentResult,
  writeOperationMarker,
} from "./operatorIdempotency";
import {
  parseCreateCustomerLocationInput,
  parseCreateCustomerUserInput,
  parseCustomerStatus,
  requireCompanyName,
  resolveClientOperationId,
} from "./operatorValidation";

export const createCustomerWithOnboarding = onCall(
  {
    region: "us-central1",
    cors: OPERATOR_CALLABLE_CORS,
  },
  async (request) => {
    const actorUid = await requireOperatorAuth(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const operationId = mintOperationId(data.clientOperationId);

    const db = getDb();
    const existing = await readIdempotentResult<CustomerBundle>(db, operationId);
    if (existing) {
      return existing;
    }

    const companyName = requireCompanyName(data.companyName);
    const locationsRaw = data.locations;
    if (!Array.isArray(locationsRaw) || locationsRaw.length === 0) {
      throw new HttpsError(
        "invalid-argument",
        "At least one location is required.",
      );
    }

    const locationInputs = locationsRaw.map((loc, index) =>
      parseCreateCustomerLocationInput(loc, index),
    );
    const userInputs = Array.isArray(data.users)
      ? data.users.map((user, index) =>
          parseCreateCustomerUserInput(user, index),
        )
      : [];

    const nowIso = new Date().toISOString();
    const customer = newCustomerRecord(
      {
        companyName,
        primaryContactName:
          typeof data.primaryContactName === "string"
            ? data.primaryContactName.trim()
            : "",
        primaryContactEmail:
          typeof data.primaryContactEmail === "string"
            ? data.primaryContactEmail.trim()
            : "",
        primaryContactPhone:
          typeof data.primaryContactPhone === "string"
            ? data.primaryContactPhone.trim()
            : "",
        notes: typeof data.notes === "string" ? data.notes : "",
        customerStatus: parseCustomerStatus(data.customerStatus),
      },
      nowIso,
    );

    const locations = locationInputs.map((input) =>
      buildPhysicalLocation(customer.customerId, input, nowIso),
    );

    for (const label of ["G1"]) {
      assertSpotIdentityIsolation(locations, label);
    }

    const users = buildUsersForCustomer(
      customer.customerId,
      userInputs,
      locations,
      nowIso,
    );

    for (const user of users) {
      if (user.locationIds.length) {
        assertLocationIdsBelongToCustomer(
          customer.customerId,
          user.locationIds,
          locations,
        );
      }
    }

    const event = buildActivityEvent(
      {
        customerId: customer.customerId,
        type: "customer.created",
        message: `Customer "${companyName}" created with ${locations.length} location(s) and ${users.length} user(s).`,
        actorUid,
      },
      nowIso,
    );

    const bundle = buildCustomerBundle(customer, locations, users, [event]);

    await db.runTransaction(async (tx) => {
      const opRef = db.collection("operatorOperations").doc(operationId);
      const opSnap = await tx.get(opRef);
      if (opSnap.exists) {
        return;
      }

      tx.set(
        db.collection(CONSOLE_CUSTOMERS_COLLECTION).doc(customer.customerId),
        customer,
      );
      for (const loc of locations) {
        tx.set(
          db.collection(CONSOLE_LOCATIONS_COLLECTION).doc(loc.locationId),
          loc,
        );
      }
      for (const user of users) {
        tx.set(db.collection(CONSOLE_USERS_COLLECTION).doc(user.userId), user);
      }
      tx.set(
        db.collection(CONSOLE_ACTIVITY_EVENTS_COLLECTION).doc(event.eventId),
        stripUndefined(event as unknown as Record<string, unknown>),
      );
      writeOperationMarker(tx, db, {
        operationId,
        operationType: "createCustomerWithOnboarding",
        actorUid,
        result: bundle,
        nowIso,
      });
    });

    const replay = await readIdempotentResult<CustomerBundle>(db, operationId);
    return replay ?? bundle;
  },
);

/** Exported for tests — validates clientOperationId pattern only. */
export { resolveClientOperationId };
