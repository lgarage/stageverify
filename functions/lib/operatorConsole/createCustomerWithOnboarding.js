"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveClientOperationId = exports.createCustomerWithOnboarding = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestoreSerialize_1 = require("./firestoreSerialize");
const operatorAuth_1 = require("./operatorAuth");
const operatorCollections_1 = require("./operatorCollections");
const operatorMutationCore_1 = require("./operatorMutationCore");
const operatorIdempotency_1 = require("./operatorIdempotency");
const operatorValidation_1 = require("./operatorValidation");
Object.defineProperty(exports, "resolveClientOperationId", { enumerable: true, get: function () { return operatorValidation_1.resolveClientOperationId; } });
exports.createCustomerWithOnboarding = (0, https_1.onCall)({
    region: "us-central1",
    cors: operatorCollections_1.OPERATOR_CALLABLE_CORS,
}, async (request) => {
    const actorUid = await (0, operatorAuth_1.requireOperatorAuth)(request);
    const data = (request.data ?? {});
    const operationId = (0, operatorIdempotency_1.mintOperationId)(data.clientOperationId);
    const db = (0, operatorAuth_1.getDb)();
    const existing = await (0, operatorIdempotency_1.readIdempotentResult)(db, operationId);
    if (existing) {
        return existing;
    }
    const companyName = (0, operatorValidation_1.requireCompanyName)(data.companyName);
    const locationsRaw = data.locations;
    if (!Array.isArray(locationsRaw) || locationsRaw.length === 0) {
        throw new https_1.HttpsError("invalid-argument", "At least one location is required.");
    }
    const locationInputs = locationsRaw.map((loc, index) => (0, operatorValidation_1.parseCreateCustomerLocationInput)(loc, index));
    const userInputs = Array.isArray(data.users)
        ? data.users.map((user, index) => (0, operatorValidation_1.parseCreateCustomerUserInput)(user, index))
        : [];
    const nowIso = new Date().toISOString();
    const customer = (0, operatorMutationCore_1.newCustomerRecord)({
        companyName,
        primaryContactName: typeof data.primaryContactName === "string"
            ? data.primaryContactName.trim()
            : "",
        primaryContactEmail: typeof data.primaryContactEmail === "string"
            ? data.primaryContactEmail.trim()
            : "",
        primaryContactPhone: typeof data.primaryContactPhone === "string"
            ? data.primaryContactPhone.trim()
            : "",
        notes: typeof data.notes === "string" ? data.notes : "",
        customerStatus: (0, operatorValidation_1.parseCustomerStatus)(data.customerStatus),
    }, nowIso);
    const locations = locationInputs.map((input) => (0, operatorMutationCore_1.buildPhysicalLocation)(customer.customerId, input, nowIso));
    for (const label of ["G1"]) {
        (0, operatorMutationCore_1.assertSpotIdentityIsolation)(locations, label);
    }
    const users = (0, operatorMutationCore_1.buildUsersForCustomer)(customer.customerId, userInputs, locations, nowIso);
    for (const user of users) {
        if (user.locationIds.length) {
            (0, operatorMutationCore_1.assertLocationIdsBelongToCustomer)(customer.customerId, user.locationIds, locations);
        }
    }
    const event = (0, operatorMutationCore_1.buildActivityEvent)({
        customerId: customer.customerId,
        type: "customer.created",
        message: `Customer "${companyName}" created with ${locations.length} location(s) and ${users.length} user(s).`,
        actorUid,
    }, nowIso);
    const bundle = (0, operatorMutationCore_1.buildCustomerBundle)(customer, locations, users, [event]);
    await db.runTransaction(async (tx) => {
        const opRef = db.collection("operatorOperations").doc(operationId);
        const opSnap = await tx.get(opRef);
        if (opSnap.exists) {
            return;
        }
        tx.set(db.collection(operatorCollections_1.CONSOLE_CUSTOMERS_COLLECTION).doc(customer.customerId), customer);
        for (const loc of locations) {
            tx.set(db.collection(operatorCollections_1.CONSOLE_LOCATIONS_COLLECTION).doc(loc.locationId), loc);
        }
        for (const user of users) {
            tx.set(db.collection(operatorCollections_1.CONSOLE_USERS_COLLECTION).doc(user.userId), user);
        }
        tx.set(db.collection(operatorCollections_1.CONSOLE_ACTIVITY_EVENTS_COLLECTION).doc(event.eventId), (0, firestoreSerialize_1.stripUndefined)(event));
        (0, operatorIdempotency_1.writeOperationMarker)(tx, db, {
            operationId,
            operationType: "createCustomerWithOnboarding",
            actorUid,
            result: bundle,
            nowIso,
        });
    });
    const replay = await (0, operatorIdempotency_1.readIdempotentResult)(db, operationId);
    return replay ?? bundle;
});
//# sourceMappingURL=createCustomerWithOnboarding.js.map