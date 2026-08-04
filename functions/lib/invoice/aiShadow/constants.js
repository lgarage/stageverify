"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_EXTRACT_CHARS_FOR_MODEL = exports.MAX_VENDOR_MD_BYTES = exports.TRAINING_NOTE_AUDIT_TTL_DAYS = exports.MAX_TRAINING_LESSONS_PER_HOUR_PER_UID = exports.MAX_LESSON_NOTE_CHARS = exports.MODEL_FLASH = exports.MODEL_FLASH_LITE = exports.VERTEX_LOCATION = exports.VERTEX_PROJECT = exports.INVOICE_TRAINING_BUCKET = void 0;
/** Private GCS bucket for per-vendor invoice training playbooks (CF Admin SDK only). */
exports.INVOICE_TRAINING_BUCKET = "stageverify-db-invoice-training";
exports.VERTEX_PROJECT = "stageverify-db";
/** Newer Gemini IDs are served from the global endpoint. */
exports.VERTEX_LOCATION = "global";
exports.MODEL_FLASH_LITE = "gemini-3.5-flash-lite";
exports.MODEL_FLASH = "gemini-3.6-flash";
exports.MAX_LESSON_NOTE_CHARS = 800;
/** D-59 P7 — playbook + ignore-lane notes per uid per rolling hour. */
exports.MAX_TRAINING_LESSONS_PER_HOUR_PER_UID = 20;
/** Firestore TTL on trainingNoteAudit.expireAt (console policy). */
exports.TRAINING_NOTE_AUDIT_TTL_DAYS = 90;
exports.MAX_VENDOR_MD_BYTES = 120_000;
exports.MAX_EXTRACT_CHARS_FOR_MODEL = 24_000;
//# sourceMappingURL=constants.js.map