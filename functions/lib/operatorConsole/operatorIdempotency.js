"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.firestoreSafeJson = firestoreSafeJson;
exports.mintOperationId = mintOperationId;
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
async function readIdempotentResult(db, operationId) {
    const snap = await db
        .collection(operatorCollections_1.OPERATOR_OPERATIONS_COLLECTION)
        .doc(operationId)
        .get();
    if (!snap.exists)
        return null;
    const data = snap.data();
    return data.result;
}
function writeOperationMarker(tx, db, input) {
    const ref = db.collection(operatorCollections_1.OPERATOR_OPERATIONS_COLLECTION).doc(input.operationId);
    tx.set(ref, {
        clientOperationId: input.operationId,
        operationType: input.operationType,
        actorUid: input.actorUid,
        result: firestoreSafeJson(input.result),
        createdAt: input.nowIso,
    });
}
//# sourceMappingURL=operatorIdempotency.js.map