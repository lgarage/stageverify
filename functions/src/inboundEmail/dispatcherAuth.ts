/**
 * Dispatcher-only callable auth — signed-in Firebase user with dispatcher role.
 */
import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";

const DISPATCHER_ROLES_COLLECTION = "dispatcherRoles";

function getDb() {
  return admin.firestore();
}

async function hasDispatcherRole(uid: string): Promise<boolean> {
  const roleSnap = await getDb().collection(DISPATCHER_ROLES_COLLECTION).doc(uid).get();
  if (roleSnap.exists) {
    const active = (roleSnap.data() as { active?: boolean }).active;
    return active !== false;
  }
  try {
    const user = await admin.auth().getUser(uid);
    return user.customClaims?.dispatcher === true;
  } catch {
    return false;
  }
}

export async function requireDispatcherAuth(request: {
  auth?: { uid?: string };
}): Promise<string> {
  if (!request.auth?.uid) {
    throw new HttpsError(
      "permission-denied",
      "Sign in as a dispatcher to use this feature.",
    );
  }
  const uid = request.auth.uid;
  if (!(await hasDispatcherRole(uid))) {
    throw new HttpsError(
      "permission-denied",
      "Dispatcher role required for this feature.",
    );
  }
  return uid;
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
