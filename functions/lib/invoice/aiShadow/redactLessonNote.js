"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redactLessonNote = redactLessonNote;
exports.isSafeLessonNote = isSafeLessonNote;
const constants_1 = require("./constants");
const BLOCKED_PATTERNS = [
    /\b\d{6,}\b/g, // long numeric ids (invoice/order-ish)
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g,
    /\b(?:PO|P\/O|S\/O|SO|INV)[#:\s-]*[A-Z0-9-]{4,}\b/gi,
    /\b\d{1,5}\s+[A-Za-z0-9.'\-\s]{2,40}(?:Street|St|Avenue|Ave|Road|Rd|Blvd|Drive|Dr|Lane|Ln)\b/gi,
];
/** Generalized lesson text only — strips invoice-identifying patterns. */
function redactLessonNote(raw) {
    let text = raw.replace(/\r\n/g, "\n").trim();
    if (!text)
        return "";
    for (const re of BLOCKED_PATTERNS) {
        text = text.replace(re, "[redacted]");
    }
    text = text.replace(/\s+/g, " ").trim();
    if (text.length > constants_1.MAX_LESSON_NOTE_CHARS) {
        text = text.slice(0, constants_1.MAX_LESSON_NOTE_CHARS).trimEnd();
    }
    return text;
}
function isSafeLessonNote(note) {
    if (!note.trim())
        return false;
    if (note.length > constants_1.MAX_LESSON_NOTE_CHARS)
        return false;
    // Reject if still looks like a concrete invoice number after redact pass
    if (/\b\d{7,}\b/.test(note))
        return false;
    if (/@/.test(note))
        return false;
    return true;
}
//# sourceMappingURL=redactLessonNote.js.map