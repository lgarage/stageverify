/**
 * Per-uid Invoice Review Chat rate limit — Lane C C1.
 */
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { MAX_REVIEW_CHAT_TURNS_PER_HOUR_PER_UID } from "../aiShadow/constants";
import { REVIEW_CHAT_RATE_LIMIT_COLLECTION } from "./reviewAgentTypes";

const WINDOW_MS = 60 * 60 * 1000;

type RateLimitDoc = {
  uid: string;
  windowStartMs: number;
  count: number;
};

export class ReviewChatRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewChatRateLimitError";
  }
}

/** Throws ReviewChatRateLimitError when over limit. */
export async function checkAndIncrementReviewChatRateLimit(
  db: Firestore,
  uid: string,
): Promise<void> {
  const ref = db.collection(REVIEW_CHAT_RATE_LIMIT_COLLECTION).doc(uid);
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

    if (count >= MAX_REVIEW_CHAT_TURNS_PER_HOUR_PER_UID) {
      throw new ReviewChatRateLimitError(
        `Invoice Review Chat limit reached (${MAX_REVIEW_CHAT_TURNS_PER_HOUR_PER_UID} per hour). Try again later.`,
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
