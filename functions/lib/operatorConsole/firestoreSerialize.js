"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripUndefined = stripUndefined;
/** Remove undefined fields before Firestore writes. */
function stripUndefined(obj) {
    const out = { ...obj };
    for (const key of Object.keys(out)) {
        if (out[key] === undefined) {
            delete out[key];
        }
    }
    return out;
}
//# sourceMappingURL=firestoreSerialize.js.map