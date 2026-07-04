/**
 * Dispatcher-only callable auth — any signed-in Firebase user (not vendor PIN session).
 */
import { HttpsError } from "firebase-functions/v2/https";

export function requireDispatcherAuth(request: {
  auth?: { uid?: string };
}): string {
  if (!request.auth?.uid) {
    throw new HttpsError(
      "permission-denied",
      "Sign in as a dispatcher to use this feature.",
    );
  }
  return request.auth.uid;
}

/** Clamp list limit to [1, max] with Math.floor — rejects NaN and non-finite. */
export function clampListLimit(
  raw: unknown,
  defaultLimit: number,
  maxLimit: number,
): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return defaultLimit;
  }
  const floored = Math.floor(raw);
  if (floored < 1) return defaultLimit;
  if (floored > maxLimit) return maxLimit;
  return floored;
}
