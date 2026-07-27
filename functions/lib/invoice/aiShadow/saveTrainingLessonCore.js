"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveTrainingLessonCore = saveTrainingLessonCore;
/**
 * Shared lesson append + safety-reject email for Approve and Save lesson paths.
 */
const vendorTrainingMd_1 = require("./vendorTrainingMd");
const redactLessonNote_1 = require("./redactLessonNote");
const notifyTrainingLessonPending_1 = require("./notifyTrainingLessonPending");
const adminConfig_1 = require("./adminConfig");
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
    const redacted = (0, redactLessonNote_1.redactLessonNote)(raw);
    if (!(0, redactLessonNote_1.isSafeLessonNote)(redacted)) {
        const alertEmail = await (0, adminConfig_1.readAlertEmailFromSecrets)();
        let emailed = false;
        if (alertEmail) {
            const notify = await (0, notifyTrainingLessonPending_1.notifyTrainingLessonPendingAdmin)({
                alertEmail,
                vendorKey: (0, vendorTrainingMd_1.sanitizeVendorKey)(input.vendorKey),
                reason: "note_empty_or_unsafe",
                importId: input.importId,
                notePreview: redacted || raw.slice(0, 120),
            });
            emailed = notify.emailed;
        }
        return {
            trainingLessonWrote: false,
            trainingLessonPendingAdminReview: true,
            trainingLessonAlertEmailed: emailed,
            reason: "note_empty_or_unsafe",
        };
    }
    try {
        const lesson = await (0, vendorTrainingMd_1.appendVendorTrainingLesson)({
            vendorKey: input.vendorKey,
            correctionNote: redacted,
            atIso: input.atIso,
        });
        if (lesson.wrote) {
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
                    notePreview: redacted,
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
//# sourceMappingURL=saveTrainingLessonCore.js.map