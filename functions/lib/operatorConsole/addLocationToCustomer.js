"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addLocationToCustomer = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestoreSerialize_1 = require("./firestoreSerialize");
const operatorAuth_1 = require("./operatorAuth");
const operatorCollections_1 = require("./operatorCollections");
const operatorMutationCore_1 = require("./operatorMutationCore");
const operatorIdempotency_1 = require("./operatorIdempotency");
const operatorValidation_1 = require("./operatorValidation");
exports.addLocationToCustomer = (0, https_1.onCall)({
    region: "us-central1",
    cors: operatorCollections_1.OPERATOR_CALLABLE_CORS,
}, async (request) => {
    const actorUid = await (0, operatorAuth_1.requireOperatorAuth)(request);
    const data = (request.data ?? {});
    const operationId = (0, operatorIdempotency_1.mintOperationId)(data.clientOperationId);
    const customerId = typeof data.customerId === "string" ? data.customerId.trim() : "";
    if (!customerId) {
        throw new https_1.HttpsError("invalid-argument", "customerId is required.");
    }
    const db = (0, operatorAuth_1.getDb)();
    const existing = await (0, operatorIdempotency_1.readIdempotentResult)(db, operationId);
    if (existing) {
        return existing;
    }
    const locationInput = (0, operatorValidation_1.parseCreateCustomerLocationInput)(data.location, 0);
    const nowIso = new Date().toISOString();
    const location = (0, operatorMutationCore_1.buildPhysicalLocation)(customerId, locationInput, nowIso);
    const customerRef = db
        .collection(operatorCollections_1.CONSOLE_CUSTOMERS_COLLECTION)
        .doc(customerId);
    const customerSnap = await customerRef.get();
    if (!customerSnap.exists) {
        throw new https_1.HttpsError("not-found", "Customer not found.");
    }
    const siblingSnap = await db
        .collection(operatorCollections_1.CONSOLE_LOCATIONS_COLLECTION)
        .where("customerId", "==", customerId)
        .get();
    const siblings = siblingSnap.docs.map((doc) => doc.data());
    (0, operatorMutationCore_1.assertSpotIdentityIsolation)([...siblings, location], "G1");
    const event = (0, operatorMutationCore_1.buildActivityEvent)({
        customerId,
        locationId: location.locationId,
        type: "location.added",
        message: `Location "${location.locationName}" added.`,
        actorUid,
    }, nowIso);
    await db.runTransaction(async (tx) => {
        const opRef = db.collection("operatorOperations").doc(operationId);
        const opSnap = await tx.get(opRef);
        if (opSnap.exists)
            return;
        tx.update(customerRef, { updatedAt: nowIso });
        tx.set(db.collection(operatorCollections_1.CONSOLE_LOCATIONS_COLLECTION).doc(location.locationId), location);
        tx.set(db.collection(operatorCollections_1.CONSOLE_ACTIVITY_EVENTS_COLLECTION).doc(event.eventId), (0, firestoreSerialize_1.stripUndefined)(event));
        (0, operatorIdempotency_1.writeOperationMarker)(tx, db, {
            operationId,
            operationType: "addLocationToCustomer",
            actorUid,
            result: location,
            nowIso,
        });
    });
    const replay = await (0, operatorIdempotency_1.readIdempotentResult)(db, operationId);
    return replay ?? location;
});
//# sourceMappingURL=addLocationToCustomer.js.map