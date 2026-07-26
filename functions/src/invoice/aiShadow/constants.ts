/** Private GCS bucket for per-vendor invoice training playbooks (CF Admin SDK only). */
export const INVOICE_TRAINING_BUCKET = "stageverify-db-invoice-training";

export const VERTEX_PROJECT = "stageverify-db";
/** Newer Gemini IDs are served from the global endpoint. */
export const VERTEX_LOCATION = "global";

export const MODEL_FLASH_LITE = "gemini-3.5-flash-lite";
export const MODEL_FLASH = "gemini-3.6-flash";

export const MAX_LESSON_NOTE_CHARS = 800;
export const MAX_VENDOR_MD_BYTES = 120_000;
export const MAX_EXTRACT_CHARS_FOR_MODEL = 24_000;
