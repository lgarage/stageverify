import { onCall, HttpsError } from "firebase-functions/v2/https";
import type {
  ActivityEvent,
  Customer,
  CustomerBundle,
  OperatorUser,
  PhysicalLocation,
} from "./customerModels";
import { getDb, requireOperatorAuth } from "./operatorAuth";
import {
  CONSOLE_ACTIVITY_EVENTS_COLLECTION,
  CONSOLE_CUSTOMERS_COLLECTION,
  CONSOLE_LOCATIONS_COLLECTION,
  CONSOLE_USERS_COLLECTION,
  OPERATOR_CALLABLE_CORS,
} from "./operatorCollections";

export const getCustomerBundle = onCall(
  {
    region: "us-central1",
    cors: OPERATOR_CALLABLE_CORS,
  },
  async (request) => {
    await requireOperatorAuth(request);
    const data = (request.data ?? {}) as { customerId?: string };
    const customerId =
      typeof data.customerId === "string" ? data.customerId.trim() : "";
    if (!customerId) {
      throw new HttpsError("invalid-argument", "customerId is required.");
    }

    const db = getDb();
    const customerSnap = await db
      .collection(CONSOLE_CUSTOMERS_COLLECTION)
      .doc(customerId)
      .get();
    if (!customerSnap.exists) {
      throw new HttpsError("not-found", "Customer not found.");
    }

    const [locationsSnap, usersSnap, eventsSnap] = await Promise.all([
      db
        .collection(CONSOLE_LOCATIONS_COLLECTION)
        .where("customerId", "==", customerId)
        .get(),
      db
        .collection(CONSOLE_USERS_COLLECTION)
        .where("customerId", "==", customerId)
        .get(),
      db
        .collection(CONSOLE_ACTIVITY_EVENTS_COLLECTION)
        .where("customerId", "==", customerId)
        .get(),
    ]);

    const bundle: CustomerBundle = {
      customer: customerSnap.data() as Customer,
      locations: locationsSnap.docs.map(
        (doc) => doc.data() as PhysicalLocation,
      ),
      users: usersSnap.docs.map((doc) => doc.data() as OperatorUser),
      events: eventsSnap.docs
        .map((doc) => doc.data() as ActivityEvent)
        .sort(
          (a, b) =>
            Date.parse(b.createdAt) - Date.parse(a.createdAt),
        ),
    };

    return bundle;
  },
);
