"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRAINING_NOTE_AUDIT_COLLECTION = void 0;
exports.expireAtFromNow = expireAtFromNow;
exports.writeTrainingNoteAudit = writeTrainingNoteAudit;
exports.listTrainingNoteAudit = listTrainingNoteAudit;
const constants_1 = require("./constants");
exports.TRAINING_NOTE_AUDIT_COLLECTION = "trainingNoteAudit";
function expireAtFromNow(now = new Date()) {
    const d = new Date(now.getTime());
    d.setUTCDate(d.getUTCDate() + constants_1.TRAINING_NOTE_AUDIT_TTL_DAYS);
    return d.toISOString();
}
async function writeTrainingNoteAudit(db, input) {
    const createdAt = new Date().toISOString();
    const ref = db.collection(exports.TRAINING_NOTE_AUDIT_COLLECTION).doc();
    const doc = {
        uid: input.uid.trim(),
        importId: input.importId.trim(),
        vendorKey: input.vendorKey.trim(),
        noteRaw: input.noteRaw.slice(0, 800),
        noteRedacted: input.noteRedacted.slice(0, 800),
        lane: input.lane,
        createdAt,
        expireAt: expireAtFromNow(),
    };
    await ref.set(doc);
    return ref.id;
}
async function listTrainingNoteAudit(db, input) {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const snap = await db
        .collection(exports.TRAINING_NOTE_AUDIT_COLLECTION)
        .orderBy("createdAt", "desc")
        .limit(limit)
        .get();
    return snap.docs.map((d) => {
        const data = d.data();
        const item = {
            id: d.id,
            uid: data.uid,
            importId: data.importId,
            vendorKey: data.vendorKey,
            noteRedacted: data.noteRedacted,
            lane: data.lane,
            createdAt: data.createdAt,
            expireAt: data.expireAt,
        };
        if (input.includeRaw) {
            item.noteRaw = data.noteRaw;
        }
        return item;
    });
}
//# sourceMappingURL=trainingNoteAudit.js.map