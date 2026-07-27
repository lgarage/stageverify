/**
 * Shared lesson append + safety-reject email for Approve and Save lesson paths.
 */
import {
  appendVendorTrainingLesson,
  sanitizeVendorKey,
} from "./vendorTrainingMd";
import { isSafeLessonNote, redactLessonNote } from "./redactLessonNote";
import { notifyTrainingLessonPendingAdmin } from "./notifyTrainingLessonPending";
import { readAlertEmailFromSecrets } from "./adminConfig";

export type SaveTrainingLessonResult = {
  trainingLessonWrote: boolean;
  trainingLessonPendingAdminReview: boolean;
  trainingLessonAlertEmailed: boolean;
  reason?: string;
};

export async function saveTrainingLessonCore(input: {
  vendorKey: string;
  correctionNoteRaw: string;
  importId?: string;
  atIso: string;
}): Promise<SaveTrainingLessonResult> {
  const raw = input.correctionNoteRaw.trim();
  if (!raw) {
    return {
      trainingLessonWrote: false,
      trainingLessonPendingAdminReview: false,
      trainingLessonAlertEmailed: false,
      reason: "empty",
    };
  }

  const redacted = redactLessonNote(raw);
  if (!isSafeLessonNote(redacted)) {
    const alertEmail = await readAlertEmailFromSecrets();
    let emailed = false;
    if (alertEmail) {
      const notify = await notifyTrainingLessonPendingAdmin({
        alertEmail,
        vendorKey: sanitizeVendorKey(input.vendorKey),
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
    const lesson = await appendVendorTrainingLesson({
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
      const alertEmail = await readAlertEmailFromSecrets();
      let emailed = false;
      if (alertEmail) {
        const notify = await notifyTrainingLessonPendingAdmin({
          alertEmail,
          vendorKey: sanitizeVendorKey(input.vendorKey),
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
  } catch (err) {
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
