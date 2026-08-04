/**
 * Per-uid training-lesson rate limit (playbook + ignore notes) — D-59 P7.
 */
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { MAX_TRAINING_LESSONS_PER_HOUR_PER_UID } from "./constants";

export const TRAINING_LESSON_RATE_LIMIT_COLLECTION = "trainingLessonRateLimits";

const WINDOW_MS = 60 * 60 * 1000;

type RateLimitDoc = {
  uid: string;
  windowStartMs: number;
  count: number;
};

export class TrainingLessonRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrainingLessonRateLimitError";
  }
}

/** Throws TrainingLessonRateLimitError when over limit. */
export async function checkAndIncrementTrainingLessonRateLimit(
  db: Firestore,
  uid: string,
): Promise<void> {
  const ref = db.collection(TRAINING_LESSON_RATE_LIMIT_COLLECTION).doc(uid);
  const nowMs = Date.now();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? (snap.data() as RateLimitDoc) : null;
    let windowStartMs = data?.windowStartMs ?? nowMs;
    let count = data?.count ?? 0;

    if (nowMs - windowStartMs >= WINDOW_MS) {
      windowStartMs = nowMs;
      count = 0;
    }

    if (count >= MAX_TRAINING_LESSONS_PER_HOUR_PER_UID) {
      throw new TrainingLessonRateLimitError(
        `Training note limit reached (${MAX_TRAINING_LESSONS_PER_HOUR_PER_UID} per hour). Try again later.`,
      );
    }

    tx.set(ref, {
      uid,
      windowStartMs,
      count: count + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}
