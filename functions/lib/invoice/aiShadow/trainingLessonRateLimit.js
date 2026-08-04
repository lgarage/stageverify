"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrainingLessonRateLimitError = exports.TRAINING_LESSON_RATE_LIMIT_COLLECTION = void 0;
exports.checkAndIncrementTrainingLessonRateLimit = checkAndIncrementTrainingLessonRateLimit;
const firestore_1 = require("firebase-admin/firestore");
const constants_1 = require("./constants");
exports.TRAINING_LESSON_RATE_LIMIT_COLLECTION = "trainingLessonRateLimits";
const WINDOW_MS = 60 * 60 * 1000;
class TrainingLessonRateLimitError extends Error {
    constructor(message) {
        super(message);
        this.name = "TrainingLessonRateLimitError";
    }
}
exports.TrainingLessonRateLimitError = TrainingLessonRateLimitError;
/** Throws TrainingLessonRateLimitError when over limit. */
async function checkAndIncrementTrainingLessonRateLimit(db, uid) {
    const ref = db.collection(exports.TRAINING_LESSON_RATE_LIMIT_COLLECTION).doc(uid);
    const nowMs = Date.now();
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.exists ? snap.data() : null;
        let windowStartMs = data?.windowStartMs ?? nowMs;
        let count = data?.count ?? 0;
        if (nowMs - windowStartMs >= WINDOW_MS) {
            windowStartMs = nowMs;
            count = 0;
        }
        if (count >= constants_1.MAX_TRAINING_LESSONS_PER_HOUR_PER_UID) {
            throw new TrainingLessonRateLimitError(`Training note limit reached (${constants_1.MAX_TRAINING_LESSONS_PER_HOUR_PER_UID} per hour). Try again later.`);
        }
        tx.set(ref, {
            uid,
            windowStartMs,
            count: count + 1,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
    });
}
//# sourceMappingURL=trainingLessonRateLimit.js.map