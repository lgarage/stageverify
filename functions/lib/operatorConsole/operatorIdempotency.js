"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.firestoreSafeJson = firestoreSafeJson;
exports.mintOperationId = mintOperationId;
exports.operationMarkerDocId = operationMarkerDocId;
exports.operationMarkerRef = operationMarkerRef;
exports.readIdempotentResult = readIdempotentResult;
exports.writeOperationMarker = writeOperationMarker;
const operatorCollections_1 = require("./operatorCollections");
const operatorIds_1 = require("./operatorIds");
const operatorValidation_1 = require("./operatorValidation");
/** Firestore-safe clone — drops undefined nested fields. */
function firestoreSafeJson(value) {
    return JSON.parse(JSON.stringify(value));
}
function mintOperationId(raw) {
    const resolved = (0, operatorValidation_1.resolveClientOperationId)(raw);
    return resolved || (0, operatorIds_1.newServerOperationId)();
}
/** Scope idempotency markers by operationType so clientOperationId cannot cross-callables. */
function operationMarkerDocId(operationType, operationId) {
    return `${operationType}:${operationId}`;
}
function operationMarkerRef(db, operationType, operationId) {
    return db
        .collection(operatorCollections_1.OPERATOR_OPERATIONS_COLLECTION)
        .doc(operationMarkerDocId(operationType, operationId));
}
async function readIdempotentResult(db, operationType, operationId) {
    const snap = await operationMarkerRef(db, operationType, operationId).get();
    if (!snap.exists)
        return null;
    const data = snap.data();
    if (data.operationType !== operationType)
        return null;
    return data.result;
}
function writeOperationMarker(tx, db, input) {
    const ref = operationMarkerRef(db, input.operationType, input.operationId);
    tx.set(ref, {
        clientOperationId: input.operationId,
        operationType: input.operationType,
        actorUid: input.actorUid,
        result: firestoreSafeJson(input.result),
        createdAt: input.nowIso,
    });
}
//# sourceMappingURL=operatorIdempotency.js.map