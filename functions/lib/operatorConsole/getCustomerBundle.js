"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCustomerBundle = void 0;
const https_1 = require("firebase-functions/v2/https");
const operatorAuth_1 = require("./operatorAuth");
const operatorCollections_1 = require("./operatorCollections");
exports.getCustomerBundle = (0, https_1.onCall)({
    region: "us-central1",
    cors: operatorCollections_1.OPERATOR_CALLABLE_CORS,
}, async (request) => {
    await (0, operatorAuth_1.requireOperatorAuth)(request);
    const data = (request.data ?? {});
    const customerId = typeof data.customerId === "string" ? data.customerId.trim() : "";
    if (!customerId) {
        throw new https_1.HttpsError("invalid-argument", "customerId is required.");
    }
    const db = (0, operatorAuth_1.getDb)();
    const customerSnap = await db
        .collection(operatorCollections_1.CONSOLE_CUSTOMERS_COLLECTION)
        .doc(customerId)
        .get();
    if (!customerSnap.exists) {
        throw new https_1.HttpsError("not-found", "Customer not found.");
    }
    const [locationsSnap, usersSnap, eventsSnap] = await Promise.all([
        db
            .collection(operatorCollections_1.CONSOLE_LOCATIONS_COLLECTION)
            .where("customerId", "==", customerId)
            .get(),
        db
            .collection(operatorCollections_1.CONSOLE_USERS_COLLECTION)
            .where("customerId", "==", customerId)
            .get(),
        db
            .collection(operatorCollections_1.CONSOLE_ACTIVITY_EVENTS_COLLECTION)
            .where("customerId", "==", customerId)
            .get(),
    ]);
    const bundle = {
        customer: customerSnap.data(),
        locations: locationsSnap.docs.map((doc) => doc.data()),
        users: usersSnap.docs.map((doc) => doc.data()),
        events: eventsSnap.docs
            .map((doc) => doc.data())
            .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    };
    return bundle;
});
//# sourceMappingURL=getCustomerBundle.js.map