"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveTrainingLessonCore = saveTrainingLessonCore;
exports.recordIgnoreLaneTrainingNote = recordIgnoreLaneTrainingNote;
const admin = require("firebase-admin");
const vendorTrainingMd_1 = require("./vendorTrainingMd");
const classifyLessonNoteRejection_1 = require("./classifyLessonNoteRejection");
const notifyTrainingLessonPending_1 = require("./notifyTrainingLessonPending");
const adminConfig_1 = require("./adminConfig");
const trainingLessonRateLimit_1 = require("./trainingLessonRateLimit");
const trainingNoteAudit_1 = require("./trainingNoteAudit");
function getDb() {
    return admin.firestore();
}
async function saveTrainingLessonCore(input) {
    const raw = input.correctionNoteRaw.trim();
    if (!raw) {
        return {
            trainingLessonWrote: false,
            trainingLessonPendingAdminReview: false,
            trainingLessonAlertEmailed: false,
            reason: "empty",
        };
    }
    const uid = input.uid.trim();
    if (!uid) {
        return {
            trainingLessonWrote: false,
            trainingLessonPendingAdminReview: false,
            trainingLessonAlertEmailed: false,
            reason: "missing_uid",
        };
    }
    const db = input.db ?? getDb();
    const { noteRedacted, safe, rejectClass } = (0, classifyLessonNoteRejection_1.classifyLessonNoteRejection)(raw);
    if (!safe) {
        const alertEmail = await (0, adminConfig_1.readAlertEmailFromSecrets)();
        let emailed = false;
        if (alertEmail) {
            const notify = await (0, notifyTrainingLessonPending_1.notifyTrainingLessonPendingAdmin)({
                alertEmail,
                vendorKey: (0, vendorTrainingMd_1.sanitizeVendorKey)(input.vendorKey),
                reason: rejectClass ?? "note_empty_or_unsafe",
                importId: input.importId,
                notePreview: noteRedacted || raw.slice(0, 120),
            });
            emailed = notify.emailed;
        }
        return {
            trainingLessonWrote: false,
            trainingLessonPendingAdminReview: true,
            trainingLessonAlertEmailed: emailed,
            reason: rejectClass ?? "note_empty_or_unsafe",
        };
    }
    try {
        await (0, trainingLessonRateLimit_1.checkAndIncrementTrainingLessonRateLimit)(db, uid);
    }
    catch (err) {
        if (err instanceof trainingLessonRateLimit_1.TrainingLessonRateLimitError) {
            return {
                trainingLessonWrote: false,
                trainingLessonPendingAdminReview: false,
                trainingLessonAlertEmailed: false,
                reason: "rate_limited",
            };
        }
        throw err;
    }
    try {
        const lesson = await (0, vendorTrainingMd_1.appendVendorTrainingLesson)({
            vendorKey: input.vendorKey,
            correctionNote: noteRedacted,
            atIso: input.atIso,
        });
        if (lesson.wrote) {
            if (input.importId?.trim()) {
                try {
                    await (0, trainingNoteAudit_1.writeTrainingNoteAudit)(db, {
                        uid,
                        importId: input.importId,
                        vendorKey: (0, vendorTrainingMd_1.sanitizeVendorKey)(input.vendorKey),
                        noteRaw: raw,
                        noteRedacted,
                        lane: "playbook",
                    });
                }
                catch (auditErr) {
                    console.error("trainingNoteAudit write failed:", auditErr);
                }
            }
            return {
                trainingLessonWrote: true,
                trainingLessonPendingAdminReview: false,
                trainingLessonAlertEmailed: false,
            };
        }
        if (lesson.reason === "note_empty_or_unsafe") {
            const alertEmail = await (0, adminConfig_1.readAlertEmailFromSecrets)();
            let emailed = false;
            if (alertEmail) {
                const notify = await (0, notifyTrainingLessonPending_1.notifyTrainingLessonPendingAdmin)({
                    alertEmail,
                    vendorKey: (0, vendorTrainingMd_1.sanitizeVendorKey)(input.vendorKey),
                    reason: lesson.reason,
                    importId: input.importId,
                    notePreview: noteRedacted,
                });
                emailed = notify.emailed;
            }
            return {
                trainingLessonWrote: false,
                trainingLessonPendingAdminReview: true,
                trainingLessonAlertEmailed: emailed,
                reason: lesson.reason,
            };
        }
        return {
            trainingLessonWrote: false,
            trainingLessonPendingAdminReview: false,
            trainingLessonAlertEmailed: false,
            reason: lesson.reason ?? "append_failed",
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("saveTrainingLessonCore append failed:", message);
        return {
            trainingLessonWrote: false,
            trainingLessonPendingAdminReview: false,
            trainingLessonAlertEmailed: false,
            reason: "append_error",
        };
    }
}
/** Ignore-lane note audit + rate limit when a teach note accompanies confirm (D-59 P7). */
async function recordIgnoreLaneTrainingNote(input) {
    const raw = input.noteRaw.trim();
    if (!raw)
        return { recorded: false, reason: "empty" };
    if (raw.length > 800)
        return { recorded: false, reason: "note_too_long" };
    const uid = input.uid.trim();
    if (!uid)
        return { recorded: false, reason: "missing_uid" };
    const db = input.db ?? getDb();
    const { noteRedacted, safe, rejectClass } = (0, classifyLessonNoteRejection_1.classifyLessonNoteRejection)(raw);
    if (!safe) {
        return { recorded: false, reason: rejectClass ?? "note_empty_or_unsafe" };
    }
    try {
        await (0, trainingLessonRateLimit_1.checkAndIncrementTrainingLessonRateLimit)(db, uid);
    }
    catch (err) {
        if (err instanceof trainingLessonRateLimit_1.TrainingLessonRateLimitError) {
            return { recorded: false, reason: "rate_limited" };
        }
        throw err;
    }
    await (0, trainingNoteAudit_1.writeTrainingNoteAudit)(db, {
        uid,
        importId: input.importId,
        vendorKey: (0, vendorTrainingMd_1.sanitizeVendorKey)(input.vendorKey),
        noteRaw: raw,
        noteRedacted,
        lane: "ignore",
    });
    return { recorded: true };
}
//# sourceMappingURL=saveTrainingLessonCore.js.map