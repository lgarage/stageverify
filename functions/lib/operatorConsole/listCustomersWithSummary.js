"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listCustomersWithSummary = void 0;
const https_1 = require("firebase-functions/v2/https");
const operatorAuth_1 = require("./operatorAuth");
const operatorCollections_1 = require("./operatorCollections");
const onboardingTransitions_1 = require("./onboardingTransitions");
exports.listCustomersWithSummary = (0, https_1.onCall)({
    region: "us-central1",
    cors: operatorCollections_1.OPERATOR_CALLABLE_CORS,
}, async (request) => {
    await (0, operatorAuth_1.requireOperatorAuth)(request);
    const db = (0, operatorAuth_1.getDb)();
    const customersSnap = await db.collection(operatorCollections_1.CONSOLE_CUSTOMERS_COLLECTION).get();
    const locationsSnap = await db.collection(operatorCollections_1.CONSOLE_LOCATIONS_COLLECTION).get();
    const locationsByCustomer = new Map();
    for (const doc of locationsSnap.docs) {
        const loc = doc.data();
        const list = locationsByCustomer.get(loc.customerId) ?? [];
        list.push(loc);
        locationsByCustomer.set(loc.customerId, list);
    }
    const rows = customersSnap.docs.map((doc) => {
        const customer = doc.data();
        const customerLocations = locationsByCustomer.get(customer.customerId) ?? [];
        return {
            customerId: customer.customerId,
            companyName: customer.companyName,
            customerStatus: customer.customerStatus,
            locationCount: customerLocations.length,
            onboardingRollup: (0, onboardingTransitions_1.rollupCustomerOnboarding)(customerLocations),
        };
    });
    rows.sort((a, b) => a.companyName.localeCompare(b.companyName));
    return rows;
});
//# sourceMappingURL=listCustomersWithSummary.js.map