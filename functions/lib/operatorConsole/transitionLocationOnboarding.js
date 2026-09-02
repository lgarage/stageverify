"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveClientOperationId = exports.transitionLocationOnboarding = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestoreSerialize_1 = require("./firestoreSerialize");
const operatorAuth_1 = require("./operatorAuth");
const operatorCollections_1 = require("./operatorCollections");
const operatorMutationCore_1 = require("./operatorMutationCore");
const operatorIdempotency_1 = require("./operatorIdempotency");
const operatorValidation_1 = require("./operatorValidation");
Object.defineProperty(exports, "resolveClientOperationId", { enumerable: true, get: function () { return operatorValidation_1.resolveClientOperationId; } });
const onboardingTransitions_1 = require("./onboardingTransitions");
exports.transitionLocationOnboarding = (0, https_1.onCall)({
    region: "us-central1",
    cors: operatorCollections_1.OPERATOR_CALLABLE_CORS,
}, async (request) => {
    const actorUid = await (0, operatorAuth_1.requireOperatorAuth)(request);
    const data = (request.data ?? {});
    const operationId = (0, operatorIdempotency_1.mintOperationId)(data.clientOperationId);
    const locationId = typeof data.locationId === "string" ? data.locationId.trim() : "";
    if (!locationId) {
        throw new https_1.HttpsError("invalid-argument", "locationId is required.");
    }
    const to = (0, operatorValidation_1.parseOnboardingStatus)(data.to);
    const db = (0, operatorAuth_1.getDb)();
    const existing = await (0, operatorIdempotency_1.readIdempotentResult)(db, operationId);
    if (existing) {
        return existing;
    }
    const locationRef = db
        .collection(operatorCollections_1.CONSOLE_LOCATIONS_COLLECTION)
        .doc(locationId);
    const locationSnap = await locationRef.get();
    if (!locationSnap.exists) {
        throw new https_1.HttpsError("not-found", "Location not found.");
    }
    const current = locationSnap.data();
    let next;
    try {
        next = (0, onboardingTransitions_1.transitionOnboarding)(current, to, new Date().toISOString());
    }
    catch (err) {
        throw new https_1.HttpsError("failed-precondition", err instanceof Error ? err.message : "Illegal onboarding transition.");
    }
    const nowIso = next.updatedAt;
    const event = (0, operatorMutationCore_1.buildActivityEvent)({
        customerId: current.customerId,
        locationId,
        type: "onboarding.transition",
        message: `Location "${current.locationName}" onboarding ${current.onboardingStatus} → ${to}.`,
        actorUid,
    }, nowIso);
    const customerRef = db
        .collection(operatorCollections_1.CONSOLE_CUSTOMERS_COLLECTION)
        .doc(current.customerId);
    await db.runTransaction(async (tx) => {
        const opRef = db.collection("operatorOperations").doc(operationId);
        const opSnap = await tx.get(opRef);
        if (opSnap.exists)
            return;
        tx.set(locationRef, next);
        tx.update(customerRef, { updatedAt: nowIso });
        tx.set(db.collection(operatorCollections_1.CONSOLE_ACTIVITY_EVENTS_COLLECTION).doc(event.eventId), (0, firestoreSerialize_1.stripUndefined)(event));
        (0, operatorIdempotency_1.writeOperationMarker)(tx, db, {
            operationId,
            operationType: "transitionLocationOnboarding",
            actorUid,
            result: next,
            nowIso,
        });
    });
    const replay = await (0, operatorIdempotency_1.readIdempotentResult)(db, operationId);
    return replay ?? next;
});
//# sourceMappingURL=transitionLocationOnboarding.js.map