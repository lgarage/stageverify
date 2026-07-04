"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.firestoreSafeValue = firestoreSafeValue;
/** Remove undefined fields so Firestore Admin writes do not throw. */
function firestoreSafeValue(value) {
    if (value === undefined) {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((item) => firestoreSafeValue(item));
    }
    if (value !== null && typeof value === "object") {
        const out = {};
        for (const [key, entry] of Object.entries(value)) {
            if (entry === undefined)
                continue;
            out[key] = firestoreSafeValue(entry);
        }
        return out;
    }
    return value;
}
//# sourceMappingURL=firestoreSafeValue.js.map