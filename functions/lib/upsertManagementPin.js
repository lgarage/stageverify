"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertManagementPin = void 0;
const https_1 = require("firebase-functions/v2/https");
const accessPinCrypto_1 = require("./accessPinCrypto");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
const managementPinRegistry_1 = require("./managementPinRegistry");
/** Dispatcher create/update management PIN + capability matrix. */
exports.upsertManagementPin = (0, https_1.onCall)({
    region: "us-central1",
    secrets: [accessPinCrypto_1.accessPinEncryptionKey],
}, async (request) => {
    await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    const data = (request.data ?? {});
    try {
        const result = await (0, managementPinRegistry_1.upsertManagementPinDoc)({
            id: data.id,
            label: data.label,
            pin: data.pin,
            active: data.active,
            permissions: data.permissions,
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