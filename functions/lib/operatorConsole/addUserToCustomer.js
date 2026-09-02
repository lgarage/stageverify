"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addUserToCustomer = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestoreSerialize_1 = require("./firestoreSerialize");
const operatorAuth_1 = require("./operatorAuth");
const operatorCollections_1 = require("./operatorCollections");
const operatorMutationCore_1 = require("./operatorMutationCore");
const operatorIdempotency_1 = require("./operatorIdempotency");
const operatorIds_1 = require("./operatorIds");
const operatorValidation_1 = require("./operatorValidation");
exports.addUserToCustomer = (0, https_1.onCall)({
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
    const userInput = (0, operatorValidation_1.parseCreateCustomerUserInput)(data.user, 0);
    const locationIds = userInput.locationIds ?? [];
    if (!locationIds.length && userInput.locationIndexes?.length) {
        throw new https_1.HttpsError("invalid-argument", "locationIds are required when adding a user to an existing customer.");
    }
    const customerRef = db
        .collection(operatorCollections_1.CONSOLE_CUSTOMERS_COLLECTION)
        .doc(customerId);
    const customerSnap = await customerRef.get();
    if (!customerSnap.exists) {
        throw new https_1.HttpsError("not-found", "Customer not found.");
    }
    const locSnap = await db
        .collection(operatorCollections_1.CONSOLE_LOCATIONS_COLLECTION)
        .where("customerId", "==", customerId)
        .get();
    const locations = locSnap.docs.map((doc) => doc.data());
    try {
        (0, operatorMutationCore_1.assertLocationIdsBelongToCustomer)(customerId, locationIds, locations);
    }
    catch (err) {
        throw new https_1.HttpsError("invalid-argument", err instanceof Error ? err.message : "Invalid location assignment.");
    }
    const nowIso = new Date().toISOString();
    const user = {
        userId: (0, operatorIds_1.newUserId)(),
        customerId,
        name: userInput.name,
        email: userInput.email,
        role: userInput.role,
        locationIds: [...locationIds],
        createdAt: nowIso,
        updatedAt: nowIso,
    };
    const event = (0, operatorMutationCore_1.buildActivityEvent)({
        customerId,
        type: "user.added",
        message: `User "${user.name}" (${user.role}) added.`,
        actorUid,
    }, nowIso);
    await db.runTransaction(async (tx) => {
        const opRef = db.collection("operatorOperations").doc(operationId);
        const opSnap = await tx.get(opRef);
        if (opSnap.exists)
            return;
        tx.update(customerRef, { updatedAt: nowIso });
        tx.set(db.collection(operatorCollections_1.CONSOLE_USERS_COLLECTION).doc(user.userId), user);
        tx.set(db.collection(operatorCollections_1.CONSOLE_ACTIVITY_EVENTS_COLLECTION).doc(event.eventId), (0, firestoreSerialize_1.stripUndefined)(event));
        (0, operatorIdempotency_1.writeOperationMarker)(tx, db, {
            operationId,
            operationType: "addUserToCustomer",
            actorUid,
            result: user,
            nowIso,
        });
    });
    const replay = await (0, operatorIdempotency_1.readIdempotentResult)(db, operationId);
    return replay ?? user;
});
//# sourceMappingURL=addUserToCustomer.js.map