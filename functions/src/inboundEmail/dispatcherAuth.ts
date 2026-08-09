/**
 * Dispatcher-only callable auth — signed-in Firebase user with dispatcher role.
 */
import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";

const DISPATCHER_ROLES_COLLECTION = "dispatcherRoles";

function getDb() {
  return admin.firestore();
}

export type DispatcherAccessRole = "admin" | "manager" | "dispatcher";

export type DispatcherRoleFields = {
  active?: boolean;
  manager?: boolean;
  /** SSOT for Auth human privilege tier. */
  role?: DispatcherAccessRole | string;
  fullName?: string;
  email?: string;
  removed?: boolean;
};

export async function readDispatcherRoleDoc(
  uid: string,
): Promise<DispatcherRoleFields | null> {
  const roleSnap = await getDb()
    .collection(DISPATCHER_ROLES_COLLECTION)
    .doc(uid)
    .get();
  if (!roleSnap.exists) return null;
  return roleSnap.data() as DispatcherRoleFields;
}

/** Resolve canonical role from role field + legacy manager boolean. */
export function resolveDispatcherAccessRole(
  data: DispatcherRoleFields | null | undefined,
): DispatcherAccessRole {
  if (!data) return "dispatcher";
  if (data.role === "admin") return "admin";
  if (data.role === "manager") return "manager";
  if (data.role === "dispatcher") return "dispatcher";
  // Legacy: manager flag only
  if (data.manager === true) return "manager";
  return "dispatcher";
}

export function managerFlagForRole(role: DispatcherAccessRole): boolean {
  return role === "admin" || role === "manager";
}

async function hasDispatcherRole(uid: string): Promise<boolean> {
  const role = await readDispatcherRoleDoc(uid);
  if (role) {
    return role.active !== false;
  }
  try {
    const user = await admin.auth().getUser(uid);
    return user.customClaims?.dispatcher === true;
  } catch {
    return false;
  }
}

/** D-59 P2: manager flag on dispatcherRoles/{uid} — no customClaims.manager.
 * Admin also satisfies manager-level ops (synced manager flag + role SSOT). */
export async function hasManagerRole(uid: string): Promise<boolean> {
  const role = await readDispatcherRoleDoc(uid);
  if (!role || role.active === false || role.removed === true) return false;
  const accessRole = resolveDispatcherAccessRole(role);
  return managerFlagForRole(accessRole) || role.manager === true;
}

/** Active named Admin — role SSOT only (not manager flag alone). */
export async function hasAdminRole(uid: string): Promise<boolean> {
  const role = await readDispatcherRoleDoc(uid);
  if (!role || role.active === false || role.removed === true) return false;
  return resolveDispatcherAccessRole(role) === "admin";
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

/** D-59 P2: signed-in dispatcher with manager === true on dispatcherRoles doc. */
export async function requireManagerAuth(request: {
  auth?: { uid?: string };
}): Promise<string> {
  const uid = await requireDispatcherAuth(request);
  if (!(await hasManagerRole(uid))) {
    throw new HttpsError(
      "permission-denied",
      "Manager role required for this action.",
    );
  }
  return uid;
}

/** Signed-in active Admin (named person) — required for privileged PIN reveal. */
export async function requireAdminAuth(request: {
  auth?: { uid?: string };
}): Promise<string> {
  const uid = await requireDispatcherAuth(request);
  if (!(await hasAdminRole(uid))) {
    throw new HttpsError(
      "permission-denied",
      "Admin role required for this action.",
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
