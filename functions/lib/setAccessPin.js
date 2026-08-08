"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setAccessPin = void 0;
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const accessPinCrypto_1 = require("./accessPinCrypto");
const accessPinSecretsShared_1 = require("./accessPinSecretsShared");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
const pinMatching_1 = require("./pinMatching");
const pinHashing_1 = require("./pinHashing");
const ENTITY_COLLECTION = {
    technician: "technicians",
    vendor: "vendors",
};
/** Dispatcher sets technician/vendor PIN — hash + encrypt in CF-only secrets doc. */
exports.setAccessPin = (0, https_1.onCall)({
    region: "us-central1",
    secrets: [accessPinCrypto_1.accessPinEncryptionKey],
}, async (request) => {
    const uid = await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    const data = (request.data ?? {});
    const targetType = (0, accessPinSecretsShared_1.parseAccessPinTargetType)(data.targetType);
    const targetId = typeof data.targetId === "string" ? data.targetId.trim() : "";
    const pin = (0, pinMatching_1.asFourDigitPin)(data.pin);
    if (!targetType || !targetId || !pin) {
        throw new https_1.HttpsError("invalid-argument", "Invalid PIN access target.");
    }
    const db = (0, accessPinSecretsShared_1.getDb)();
    const entityRef = db.collection(ENTITY_COLLECTION[targetType]).doc(targetId);
    const entitySnap = await entityRef.get();
    if (!entitySnap.exists) {
        throw new https_1.HttpsError("not-found", "Target not found.");
    }
    const now = new Date().toISOString();
    const pinHash = (0, pinHashing_1.hashPinForStorage)(pin);
    const pinEncrypted = (0, accessPinCrypto_1.encryptPinForStorage)(pin);
    const secretRef = db
        .collection("accessPinSecrets")
        .doc((0, accessPinSecretsShared_1.accessPinSecretDocId)(targetType, targetId));
    await db.runTransaction(async (tx) => {
        tx.set(secretRef, {
            targetType,
            targetId,
            pinHash,
            pinEncrypted,
            revealable: true,
            updatedAt: now,
        });
        tx.set(entityRef, {
            pinConfigured: true,
            pinCode: firestore_1.FieldValue.delete(),
            pinHash: firestore_1.FieldValue.delete(),
            updatedAt: now,
        }, { merge: true });
    });
    await (0, accessPinSecretsShared_1.writePinAccessAudit)({
        action: "PIN_SET",
        targetType,
        targetId,
        actorUid: uid,
    });
    return { success: true, targetType, targetId, pinConfigured: true };
});
//# sourceMappingURL=setAccessPin.js.map