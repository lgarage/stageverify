"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asFourDigitPin = asFourDigitPin;
exports.pinMatches = pinMatches;
const crypto_1 = require("crypto");
function asFourDigitPin(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!/^\d{4}$/.test(trimmed))
        return null;
    return trimmed;
}
function hashPin(pin, salt) {
    return (0, crypto_1.scryptSync)(pin, salt, 32).toString("hex");
}
/** Matches plain pinCode or scrypt pinHash (`salt:hex`). */
function pinMatches(carrier, pin) {
    if (typeof carrier.pinCode === "string" && carrier.pinCode.length > 0) {
        return carrier.pinCode === pin;
    }
    if (typeof carrier.pinHash === "string" && carrier.pinHash.includes(":")) {
        const [salt, expected] = carrier.pinHash.split(":");
        if (!salt || !expected)
            return false;
        const actual = hashPin(pin, salt);
        try {
            return (0, crypto_1.timingSafeEqual)(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
        }
        catch {
            return false;
        }
    }
    return false;
}
//# sourceMappingURL=pinMatching.js.map