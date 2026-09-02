import { onCall } from "firebase-functions/v2/https";
import type { CustomerSummary } from "./customerModels";
import { getDb, requireOperatorAuth } from "./operatorAuth";
import {
  CONSOLE_CUSTOMERS_COLLECTION,
  CONSOLE_LOCATIONS_COLLECTION,
  OPERATOR_CALLABLE_CORS,
} from "./operatorCollections";
import { rollupCustomerOnboarding } from "./onboardingTransitions";
import type { PhysicalLocation } from "./customerModels";

export const listCustomersWithSummary = onCall(
  {
    region: "us-central1",
    cors: OPERATOR_CALLABLE_CORS,
  },
  async (request) => {
    await requireOperatorAuth(request);
    const db = getDb();

    const customersSnap = await db.collection(CONSOLE_CUSTOMERS_COLLECTION).get();
    const locationsSnap = await db.collection(CONSOLE_LOCATIONS_COLLECTION).get();

    const locationsByCustomer = new Map<string, PhysicalLocation[]>();
    for (const doc of locationsSnap.docs) {
      const loc = doc.data() as PhysicalLocation;
      const list = locationsByCustomer.get(loc.customerId) ?? [];
      list.push(loc);
      locationsByCustomer.set(loc.customerId, list);
    }

    const rows: CustomerSummary[] = customersSnap.docs.map((doc) => {
      const customer = doc.data() as CustomerSummary & {
        customerId: string;
        companyName: string;
        customerStatus: CustomerSummary["customerStatus"];
      };
      const customerLocations =
        locationsByCustomer.get(customer.customerId) ?? [];
      return {
        customerId: customer.customerId,
        companyName: customer.companyName,
        customerStatus: customer.customerStatus,
        locationCount: customerLocations.length,
        onboardingRollup: rollupCustomerOnboarding(customerLocations),
      };
    });

    rows.sort((a, b) => a.companyName.localeCompare(b.companyName));
    return rows;
  },
);
