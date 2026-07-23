"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashPinForStorage = hashPinForStorage;
const crypto_1 = require("crypto");
/** Store as `salt:hex` on pinHash / managementPinHash fields. */
function hashPinForStorage(pin) {
    const salt = (0, crypto_1.randomBytes)(16).toString("hex");
    const hash = (0, crypto_1.scryptSync)(pin, salt, 32).toString("hex");
    return `${salt}:${hash}`;
}
//# sourceMappingURL=pinHashing.js.map