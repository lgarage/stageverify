"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyLessonNoteRejection = classifyLessonNoteRejection;
/**
 * Stable reject labels for training-note safety — never expose regex to clients (D-59 P7).
 */
const constants_1 = require("./constants");
const redactLessonNote_1 = require("./redactLessonNote");
function rejectClassForUnsafe(raw, redacted) {
    if (!raw.trim())
        return "empty_note";
    if (raw.trim().length > constants_1.MAX_LESSON_NOTE_CHARS)
        return "note_too_long";
    if (/@/.test(redacted))
        return "contains_email";
    if (/\b\d{7,}\b/.test(redacted))
        return "contains_long_number";
    return "contains_long_number";
}
/** Preview + save gate — same redaction path used on persist. */
function classifyLessonNoteRejection(note) {
    const raw = typeof note === "string" ? note : "";
    const noteRedacted = (0, redactLessonNote_1.redactLessonNote)(raw);
    if ((0, redactLessonNote_1.isSafeLessonNote)(noteRedacted)) {
        return { noteRedacted, safe: true };
    }
    return {
        noteRedacted,
        safe: false,
        rejectClass: rejectClassForUnsafe(raw, noteRedacted),
    };
}
//# sourceMappingURL=classifyLessonNoteRejection.js.map