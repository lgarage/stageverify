"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setManagementPin = void 0;
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const accessPinCrypto_1 = require("./accessPinCrypto");
const pinMatching_1 = require("./pinMatching");
const managementPinRegistry_1 = require("./managementPinRegistry");
const managementPinWriteAuth_1 = require("./managementPinWriteAuth");
function getDb() {
    return admin.firestore();
}
/**
 * Back-compat: upserts the stable `default` management PIN with full capabilities.
 * New Settings UI should prefer upsertManagementPin for multi-PIN + matrix.
 */
exports.setManagementPin = (0, https_1.onCall)({
    region: "us-central1",
    secrets: [accessPinCrypto_1.accessPinEncryptionKey],
}, async (request) => {
    const data = (request.data ?? {});
    const pin = (0, pinMatching_1.asAccessPin)(data.pin);
    if (!pin) {
        throw new https_1.HttpsError("invalid-argument", "A 4–6 digit PIN is required.");
    }
    const auth = await (0, managementPinWriteAuth_1.authorizeManagementPinWrite)(request, {
        pin,
        id: managementPinRegistry_1.DEFAULT_MANAGEMENT_PIN_ID,
        fixedTargetId: managementPinRegistry_1.DEFAULT_MANAGEMENT_PIN_ID,
        sessionToken: data.sessionToken,
    });
    await (0, managementPinRegistry_1.upsertManagementPinDoc)({
        id: managementPinRegistry_1.DEFAULT_MANAGEMENT_PIN_ID,
        label: "Management PIN",
        pin,
        active: true,
        permissions: {
            enterPortalAnyQr: true,
            catchAllCheckIn: true,
            viewWaitingParts: true,
            markOrFlagParcel: true,
        },
        sessionConsumption: auth.sessionConsumption,
        actorUid: auth.actorUid,
    });
    const now = new Date().toISOString();
    // Keep legacy secret in sync for older readers during dual-read window.
    const defaultSnap = await getDb()
        .collection("managementPins")
        .doc(managementPinRegistry_1.DEFAULT_MANAGEMENT_PIN_ID)
        .get();
    const pinHash = defaultSnap.data()
        ?.pinHash;
    if (pinHash) {
        await getDb()
            .collection("managementPinSecrets")
            .doc("config")
            .set({ managementPinHash: pinHash, updatedAt: now }, { merge: true });
    }
    await getDb()
        .collection("appSettings")
        .doc("config")
        .set({
        managementPinConfigured: true,
        managementPinHash: firestore_1.FieldValue.delete(),
        updatedAt: now,
    }, { merge: true });
    return { success: true };
});
//# sourceMappingURL=setManagementPin.js.map