"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReviewChatRateLimitError = void 0;
exports.checkAndIncrementReviewChatRateLimit = checkAndIncrementReviewChatRateLimit;
const firestore_1 = require("firebase-admin/firestore");
const constants_1 = require("../aiShadow/constants");
const reviewAgentTypes_1 = require("./reviewAgentTypes");
const WINDOW_MS = 60 * 60 * 1000;
class ReviewChatRateLimitError extends Error {
    constructor(message) {
        super(message);
        this.name = "ReviewChatRateLimitError";
    }
}
exports.ReviewChatRateLimitError = ReviewChatRateLimitError;
/** Throws ReviewChatRateLimitError when over limit. */
async function checkAndIncrementReviewChatRateLimit(db, uid) {
    const ref = db.collection(reviewAgentTypes_1.REVIEW_CHAT_RATE_LIMIT_COLLECTION).doc(uid);
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
        if (count >= constants_1.MAX_REVIEW_CHAT_TURNS_PER_HOUR_PER_UID) {
            throw new ReviewChatRateLimitError(`Invoice Review Chat limit reached (${constants_1.MAX_REVIEW_CHAT_TURNS_PER_HOUR_PER_UID} per hour). Try again later.`);
        }
        tx.set(ref, {
            uid,
            windowStartMs,
            count: count + 1,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
    });
}
//# sourceMappingURL=reviewAgentRateLimit.js.map