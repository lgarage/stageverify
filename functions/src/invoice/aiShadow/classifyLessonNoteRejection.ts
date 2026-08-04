/**
 * Stable reject labels for training-note safety — never expose regex to clients (D-59 P7).
 */
import { MAX_LESSON_NOTE_CHARS } from "./constants";
import { isSafeLessonNote, redactLessonNote } from "./redactLessonNote";

export type LessonNoteRejectClass =
  | "empty_note"
  | "note_too_long"
  | "contains_email"
  | "contains_long_number";

export type ClassifyLessonNoteResult = {
  noteRedacted: string;
  safe: boolean;
  rejectClass?: LessonNoteRejectClass;
};

function rejectClassForUnsafe(raw: string, redacted: string): LessonNoteRejectClass {
  if (!raw.trim()) return "empty_note";
  if (raw.trim().length > MAX_LESSON_NOTE_CHARS) return "note_too_long";
  if (/@/.test(redacted)) return "contains_email";
  if (/\b\d{7,}\b/.test(redacted)) return "contains_long_number";
  return "contains_long_number";
}

/** Preview + save gate — same redaction path used on persist. */
export function classifyLessonNoteRejection(note: string): ClassifyLessonNoteResult {
  const raw = typeof note === "string" ? note : "";
  const noteRedacted = redactLessonNote(raw);
  if (isSafeLessonNote(noteRedacted)) {
    return { noteRedacted, safe: true };
  }
  return {
    noteRedacted,
    safe: false,
    rejectClass: rejectClassForUnsafe(raw, noteRedacted),
  };
}
