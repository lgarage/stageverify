/**
 * Shared lesson append + safety-reject email for Approve and Save lesson paths.
 */
import type { Firestore } from "firebase-admin/firestore";
import * as admin from "firebase-admin";
import {
  appendVendorTrainingLesson,
  sanitizeVendorKey,
} from "./vendorTrainingMd";
import { classifyLessonNoteRejection } from "./classifyLessonNoteRejection";
import { notifyTrainingLessonPendingAdmin } from "./notifyTrainingLessonPending";
import { readAlertEmailFromSecrets } from "./adminConfig";
import {
  checkAndIncrementTrainingLessonRateLimit,
  TrainingLessonRateLimitError,
} from "./trainingLessonRateLimit";
import { writeTrainingNoteAudit } from "./trainingNoteAudit";

export type SaveTrainingLessonResult = {
  trainingLessonWrote: boolean;
  trainingLessonPendingAdminReview: boolean;
  trainingLessonAlertEmailed: boolean;
  reason?: string;
};

function getDb(): Firestore {
  return admin.firestore();
}

export async function saveTrainingLessonCore(input: {
  uid: string;
  vendorKey: string;
  correctionNoteRaw: string;
  importId?: string;
  atIso: string;
  db?: Firestore;
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
  const { noteRedacted, safe, rejectClass } = classifyLessonNoteRejection(raw);
  if (!safe) {
    const alertEmail = await readAlertEmailFromSecrets();
    let emailed = false;
    if (alertEmail) {
      const notify = await notifyTrainingLessonPendingAdmin({
        alertEmail,
        vendorKey: sanitizeVendorKey(input.vendorKey),
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
    await checkAndIncrementTrainingLessonRateLimit(db, uid);
  } catch (err) {
    if (err instanceof TrainingLessonRateLimitError) {
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
    const lesson = await appendVendorTrainingLesson({
      vendorKey: input.vendorKey,
      correctionNote: noteRedacted,
      atIso: input.atIso,
    });
    if (lesson.wrote) {
      if (input.importId?.trim()) {
        try {
          await writeTrainingNoteAudit(db, {
            uid,
            importId: input.importId,
            vendorKey: sanitizeVendorKey(input.vendorKey),
            noteRaw: raw,
            noteRedacted,
            lane: "playbook",
          });
        } catch (auditErr) {
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
      const alertEmail = await readAlertEmailFromSecrets();
      let emailed = false;
      if (alertEmail) {
        const notify = await notifyTrainingLessonPendingAdmin({
          alertEmail,
          vendorKey: sanitizeVendorKey(input.vendorKey),
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

/** Ignore-lane note audit + rate limit when a teach note accompanies confirm (D-59 P7). */
export async function recordIgnoreLaneTrainingNote(input: {
  uid: string;
  importId: string;
  vendorKey: string;
  noteRaw: string;
  db?: Firestore;
}): Promise<{ recorded: boolean; reason?: string }> {
  const raw = input.noteRaw.trim();
  if (!raw) return { recorded: false, reason: "empty" };
  if (raw.length > 800) return { recorded: false, reason: "note_too_long" };

  const uid = input.uid.trim();
  if (!uid) return { recorded: false, reason: "missing_uid" };

  const db = input.db ?? getDb();
  const { noteRedacted, safe, rejectClass } = classifyLessonNoteRejection(raw);
  if (!safe) {
    return { recorded: false, reason: rejectClass ?? "note_empty_or_unsafe" };
  }

  try {
    await checkAndIncrementTrainingLessonRateLimit(db, uid);
  } catch (err) {
    if (err instanceof TrainingLessonRateLimitError) {
      return { recorded: false, reason: "rate_limited" };
    }
    throw err;
  }

  await writeTrainingNoteAudit(db, {
    uid,
    importId: input.importId,
    vendorKey: sanitizeVendorKey(input.vendorKey),
    noteRaw: raw,
    noteRedacted,
    lane: "ignore",
  });
  return { recorded: true };
}
