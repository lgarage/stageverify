"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertManagementPin = void 0;
const https_1 = require("firebase-functions/v2/https");
const accessPinCrypto_1 = require("./accessPinCrypto");
const managementPinRegistry_1 = require("./managementPinRegistry");
const managementPinWriteAuth_1 = require("./managementPinWriteAuth");
/** Dispatcher metadata / manager-gated PIN writes for management PIN + capability matrix. */
exports.upsertManagementPin = (0, https_1.onCall)({
    region: "us-central1",
    secrets: [accessPinCrypto_1.accessPinEncryptionKey],
}, async (request) => {
    const data = (request.data ?? {});
    const auth = await (0, managementPinWriteAuth_1.authorizeManagementPinWrite)(request, {
        id: data.id,
        label: data.label,
        pin: data.pin,
        active: data.active,
        permissions: data.permissions,
        sessionToken: data.sessionToken,
    });
    try {
        const result = await (0, managementPinRegistry_1.upsertManagementPinDoc)({
            id: data.id,
            label: data.label,
            pin: data.pin,
            active: data.active,
            permissions: data.permissions,
            sessionConsumption: auth.sessionConsumption,
            actorUid: auth.actorUid,
        });
        return { success: true, id: result.id };
    }
    catch (err) {
        if (err instanceof https_1.HttpsError)
            throw err;
        throw new https_1.HttpsError("internal", err instanceof Error ? err.message : "Failed to save management PIN.");
    }
});
//# sourceMappingURL=upsertManagementPin.js.map