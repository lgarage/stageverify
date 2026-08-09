/** Private GCS bucket for per-vendor invoice training playbooks (CF Admin SDK only). */
export const INVOICE_TRAINING_BUCKET = "stageverify-db-invoice-training";

export const VERTEX_PROJECT = "stageverify-db";
/** Newer Gemini IDs are served from the global endpoint. */
export const VERTEX_LOCATION = "global";

export const MODEL_FLASH_LITE = "gemini-3.5-flash-lite";
export const MODEL_FLASH = "gemini-3.6-flash";

export const MAX_LESSON_NOTE_CHARS = 800;
/** D-59 P7 — playbook + ignore-lane notes per uid per rolling hour. */
export const MAX_TRAINING_LESSONS_PER_HOUR_PER_UID = 20;
/** Firestore TTL on trainingNoteAudit.expireAt (console policy). */
export const TRAINING_NOTE_AUDIT_TTL_DAYS = 90;
export const MAX_VENDOR_MD_BYTES = 120_000;
export const MAX_EXTRACT_CHARS_FOR_MODEL = 24_000;

/** Lane C C1 — Invoice Review Chat (read/explain only). */
export const MAX_REVIEW_CHAT_TURNS_PER_HOUR_PER_UID = 40;
export const MAX_REVIEW_CHAT_MESSAGE_CHARS = 2_000;
/** Bound for structured context packet sent to the review-chat model. */
export const MAX_REVIEW_CHAT_CONTEXT_CHARS = 10_000;
export const REVIEW_CHAT_RECENT_TURNS = 6;
export const REVIEW_CHAT_SUMMARY_EVERY_N_TURNS = 6;
export const REVIEW_CHAT_TEXT_WINDOW_CHARS = 420;
export const REVIEW_CHAT_MAX_TEXT_WINDOWS = 4;
export const REVIEW_CHAT_MAX_LINES = 12;
