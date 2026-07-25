"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listManagementPins = void 0;
const https_1 = require("firebase-functions/v2/https");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
const managementPinRegistry_1 = require("./managementPinRegistry");
/** Dispatcher lists management PIN identities — never returns hashes. */
exports.listManagementPins = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    const pins = await (0, managementPinRegistry_1.listManagementPinsForSettings)();
    return { pins };
});
//# sourceMappingURL=listManagementPins.js.map