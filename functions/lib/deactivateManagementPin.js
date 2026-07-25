"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivateManagementPin = void 0;
const https_1 = require("firebase-functions/v2/https");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
const managementPinRegistry_1 = require("./managementPinRegistry");
/** Dispatcher deactivates a management PIN (sessions re-check and deny). */
exports.deactivateManagementPin = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    const id = request.data?.id;
    if (typeof id !== "string" || !id.trim()) {
        throw new https_1.HttpsError("invalid-argument", "PIN id is required.");
    }
    await (0, managementPinRegistry_1.deactivateManagementPinDoc)(id);
    return { success: true };
});
//# sourceMappingURL=deactivateManagementPin.js.map