"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.incrementCatchAllPendingCount = incrementCatchAllPendingCount;
exports.decrementCatchAllPendingCount = decrementCatchAllPendingCount;
const admin = require("firebase-admin");
const APP_SETTINGS_DOC = "config";
/** Packages dropped at catch-all awaiting management check-in (CF-only field). */
async function incrementCatchAllPendingCount(db) {
    const ref = db.collection("appSettings").doc(APP_SETTINGS_DOC);
    await ref.set({ catchAllPendingCheckInCount: admin.firestore.FieldValue.increment(1) }, { merge: true });
    const snap = await ref.get();
    return snap.data()?.catchAllPendingCheckInCount ?? 0;
}
async function decrementCatchAllPendingCount(db) {
    const ref = db.collection("appSettings").doc(APP_SETTINGS_DOC);
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.data()?.catchAllPendingCheckInCount ?? 0;
        const next = Math.max(0, current - 1);
        tx.set(ref, { catchAllPendingCheckInCount: next }, { merge: true });
        return next;
    });
}
//# sourceMappingURL=catchAllPendingCount.js.map