/**
 * Manager/Admin dispatcher account provisioning (D-60).
 * Admin SDK creates Auth users + dispatcherRoles docs — no client writes.
 */
import * as admin from "firebase-admin";
import { randomBytes } from "crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  hasAdminRole,
  requireManagerAuth,
  resolveDispatcherAccessRole,
  type DispatcherAccessRole,
  type DispatcherRoleFields,
} from "./inboundEmail/dispatcherAuth";
import {
  clearOwnAdminPin,
  setOwnAdminPin,
  asAdminPin,
} from "./adminPinSecret";
import {
  assertNotLastActiveAdmin,
  countActiveAdmins,
  parseDispatcherAccessRole,
  rolePatch,
  validateHumanFullName,
} from "./humanAccessIdentity";
import { writePinAccessAudit } from "./accessPinSecretsShared";

const DISPATCHER_ROLES_COLLECTION = "dispatcherRoles";

/** Hard-blocked from permanent removal (ops / primary test identities). */
const PROTECTED_DISPATCHER_EMAILS = new Set([
  "daday1974@gmail.com",
  "[REDACTED]", // pragma: allowlist secret — ops allowlist, not a credential
]);

function getDb() {
  return admin.firestore();
}

function normalizeEmail(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new HttpsError("invalid-argument", "Email is required.");
  }
  const email = raw.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError("invalid-argument", "Please enter a valid email address.");
  }
  return email;
}

function generateTemporaryPassword(): string {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i += 1) {
    out += chars[bytes[i]! % chars.length];
  }
  return out;
}

async function actorFullName(uid: string): Promise<string | undefined> {
  const snap = await getDb()
    .collection(DISPATCHER_ROLES_COLLECTION)
    .doc(uid)
    .get();
  const data = snap.data() as DispatcherRoleFields | undefined;
  return typeof data?.fullName === "string" ? data.fullName : undefined;
}

/**
 * Escalating to Admin requires an active Admin caller, OR zero-Admin bootstrap
 * by an active Manager (first Admin only).
 */
async function assertCanGrantAdminRole(callerUid: string): Promise<void> {
  if (await hasAdminRole(callerUid)) return;
  const activeAdmins = await countActiveAdmins();
  if (activeAdmins === 0) {
    // Zero-Admin bootstrap: any Manager (including legacy manager flag) may create first Admin.
    return;
  }
  throw new HttpsError(
    "permission-denied",
    "Only an Admin can grant the Admin role.",
  );
}

export interface DispatcherAccountSummary {
  uid: string;
  email: string | null;
  fullName: string | null;
  active: boolean;
  manager: boolean;
  role: DispatcherAccessRole;
  updatedAt: string | null;
}

/** Manager lists all dispatcher role registry entries. */
export const listDispatchers = onCall(
  { region: "us-central1" },
  async (request) => {
    await requireManagerAuth(request);
    const snap = await getDb().collection(DISPATCHER_ROLES_COLLECTION).get();
    const dispatchers: DispatcherAccountSummary[] = [];

    for (const roleDoc of snap.docs) {
      const data = roleDoc.data() as DispatcherRoleFields & {
        updatedAt?: string;
      };
      if (data.removed === true) continue;
      let email: string | null =
        typeof data.email === "string" ? data.email : null;
      if (!email) {
        try {
          const user = await admin.auth().getUser(roleDoc.id);
          email = user.email ?? null;
        } catch {
          email = null;
        }
      }
      const role = resolveDispatcherAccessRole(data);
      dispatchers.push({
        uid: roleDoc.id,
        email,
        fullName: typeof data.fullName === "string" ? data.fullName : null,
        active: data.active !== false,
        manager: role === "admin" || role === "manager",
        role,
        updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
      });
    }

    dispatchers.sort((a, b) => {
      const aKey = (a.fullName ?? a.email ?? a.uid).toLowerCase();
      const bKey = (b.fullName ?? b.email ?? b.uid).toLowerCase();
      return aKey.localeCompare(bKey);
    });
    return { dispatchers };
  },
);

interface ProvisionDispatcherRequest {
  email?: string;
  temporaryPassword?: string;
  /** @deprecated prefer role */
  manager?: boolean;
  role?: string;
  fullName?: string;
  /** Required when role === admin — exactly 6 digits. */
  adminPin?: string;
}

/** Manager creates Firebase Auth user + dispatcherRoles doc. */
export const provisionDispatcher = onCall(
  { region: "us-central1" },
  async (request) => {
    const callerUid = await requireManagerAuth(request);
    const data = (request.data ?? {}) as ProvisionDispatcherRequest;
    const email = normalizeEmail(data.email);
    const fullName = validateHumanFullName(data.fullName);

    let role = parseDispatcherAccessRole(data.role);
    if (!role) {
      role = data.manager === true ? "manager" : "dispatcher";
    }

    if (role === "admin") {
      await assertCanGrantAdminRole(callerUid);
      if (!asAdminPin(data.adminPin)) {
        throw new HttpsError(
          "invalid-argument",
          "Admin PIN must be exactly 6 digits.",
        );
      }
    }

    const tempPassword =
      typeof data.temporaryPassword === "string" &&
      data.temporaryPassword.length >= 8
        ? data.temporaryPassword
        : generateTemporaryPassword();

    let uid: string;
    try {
      const created = await admin.auth().createUser({
        email,
        password: tempPassword,
        emailVerified: false,
        displayName: fullName,
      });
      uid = created.uid;
    } catch (err: unknown) {
      const code =
        err instanceof Error && "code" in err
          ? String((err as { code: string }).code)
          : "";
      if (code === "auth/email-already-exists") {
        throw new HttpsError(
          "failed-precondition",
          "An account with that email could not be created. Contact support if unexpected.",
        );
      }
      throw new HttpsError(
        "internal",
        "Could not create dispatcher account. Please try again.",
      );
    }

    const now = new Date().toISOString();
    await getDb()
      .collection(DISPATCHER_ROLES_COLLECTION)
      .doc(uid)
      .set(
        {
          ...rolePatch(role, {
            active: true,
            email,
            fullName,
            updatedAt: now,
            createdAt: now,
            createdBy: callerUid,
          }),
        },
        { merge: true },
      );

    if (role === "admin") {
      await setOwnAdminPin(uid, data.adminPin);
      const callerName = await actorFullName(callerUid);
      await writePinAccessAudit({
        action: "admin_created",
        targetType: "dispatcher",
        targetId: uid,
        actorUid: callerUid,
        actorFullName: callerName,
      });
      await writePinAccessAudit({
        action: "admin_pin_set",
        targetType: "dispatcher",
        targetId: uid,
        actorUid: callerUid,
        actorFullName: callerName,
      });
    }

    return {
      success: true,
      uid,
      email,
      fullName,
      temporaryPassword: tempPassword,
      manager: role === "admin" || role === "manager",
      role,
    };
  },
);

interface UpdateDispatcherAccessRequest {
  uid?: string;
  fullName?: string;
  role?: string;
  adminPin?: string;
}

/**
 * Update named identity fields / role on an existing Auth human (same uid).
 * Manager→Admin preserves identity; Admin→Manager strips Admin PIN secret.
 */
export const updateDispatcherAccess = onCall(
  { region: "us-central1" },
  async (request) => {
    const callerUid = await requireManagerAuth(request);
    const data = (request.data ?? {}) as UpdateDispatcherAccessRequest;
    const targetUid =
      typeof data.uid === "string" ? data.uid.trim() : "";
    if (!targetUid) {
      throw new HttpsError("invalid-argument", "Dispatcher uid is required.");
    }

    const roleRef = getDb().collection(DISPATCHER_ROLES_COLLECTION).doc(targetUid);
    const roleSnap = await roleRef.get();
    if (!roleSnap.exists) {
      throw new HttpsError("not-found", "Dispatcher account not found.");
    }
    const existing = roleSnap.data() as DispatcherRoleFields;
    if (existing.removed === true) {
      throw new HttpsError("failed-precondition", "Account already removed.");
    }

    const prevRole = resolveDispatcherAccessRole(existing);
    const nextRole = parseDispatcherAccessRole(data.role) ?? prevRole;
    const patch: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
      updatedBy: callerUid,
    };

    if (data.fullName !== undefined) {
      patch.fullName = validateHumanFullName(data.fullName);
    }

    if (nextRole !== prevRole) {
      if (nextRole === "admin") {
        await assertCanGrantAdminRole(callerUid);
        if (!asAdminPin(data.adminPin)) {
          throw new HttpsError(
            "invalid-argument",
            "Admin PIN must be exactly 6 digits when granting Admin.",
          );
        }
      }
      if (prevRole === "admin" && nextRole !== "admin") {
        await assertNotLastActiveAdmin(targetUid, existing);
        // Only Admins may demote Admins (except self-bootstrap edge: last admin blocked above).
        if (!(await hasAdminRole(callerUid))) {
          throw new HttpsError(
            "permission-denied",
            "Only an Admin can change an Admin's role.",
          );
        }
      }
      Object.assign(patch, rolePatch(nextRole));
    }

    await roleRef.set(patch, { merge: true });

    const callerName = await actorFullName(callerUid);

    if (prevRole !== "admin" && nextRole === "admin") {
      await setOwnAdminPin(targetUid, data.adminPin);
      await writePinAccessAudit({
        action: "role_changed_to_admin",
        targetType: "dispatcher",
        targetId: targetUid,
        actorUid: callerUid,
        actorFullName: callerName,
      });
      await writePinAccessAudit({
        action: "admin_pin_set",
        targetType: "dispatcher",
        targetId: targetUid,
        actorUid: callerUid,
        actorFullName: callerName,
      });
    }

    if (prevRole === "admin" && nextRole !== "admin") {
      await clearOwnAdminPin(targetUid);
      await writePinAccessAudit({
        action: "role_changed_from_admin",
        targetType: "dispatcher",
        targetId: targetUid,
        actorUid: callerUid,
        actorFullName: callerName,
      });
    }

    return {
      success: true,
      uid: targetUid,
      role: nextRole,
      fullName:
        typeof patch.fullName === "string"
          ? patch.fullName
          : (existing.fullName ?? null),
    };
  },
);

interface DeactivateDispatcherRequest {
  uid?: string;
}

/** Manager deactivates a dispatcher (role + Auth disable). */
export const deactivateDispatcher = onCall(
  { region: "us-central1" },
  async (request) => {
    const callerUid = await requireManagerAuth(request);
    const uid = (request.data as DeactivateDispatcherRequest | undefined)?.uid;
    if (typeof uid !== "string" || !uid.trim()) {
      throw new HttpsError("invalid-argument", "Dispatcher uid is required.");
    }
    if (uid === callerUid) {
      throw new HttpsError(
        "failed-precondition",
        "You cannot deactivate your own dispatcher account.",
      );
    }

    const roleRef = getDb().collection(DISPATCHER_ROLES_COLLECTION).doc(uid);
    const roleSnap = await roleRef.get();
    if (!roleSnap.exists) {
      throw new HttpsError("not-found", "Dispatcher account not found.");
    }
    const roleData = roleSnap.data() as DispatcherRoleFields;
    await assertNotLastActiveAdmin(uid, roleData);

    // Align with demotion policy: only Admins may deactivate Admins.
    if (
      resolveDispatcherAccessRole(roleData) === "admin" &&
      !(await hasAdminRole(callerUid))
    ) {
      throw new HttpsError(
        "permission-denied",
        "Only an Admin can deactivate an Admin account.",
      );
    }

    await roleRef.set(
      {
        active: false,
        updatedAt: new Date().toISOString(),
        deactivatedBy: callerUid,
      },
      { merge: true },
    );

    try {
      await admin.auth().updateUser(uid, { disabled: true });
    } catch (err: unknown) {
      const code =
        err instanceof Error && "code" in err
          ? String((err as { code: string }).code)
          : "";
      if (code !== "auth/user-not-found") {
        throw new HttpsError(
          "internal",
          "Role deactivated but Auth disable failed. Retry or contact support.",
        );
      }
    }

    if (resolveDispatcherAccessRole(roleData) === "admin") {
      const callerName = await actorFullName(callerUid);
      await writePinAccessAudit({
        action: "admin_deactivated",
        targetType: "dispatcher",
        targetId: uid,
        actorUid: callerUid,
        actorFullName: callerName,
      });
    }

    return { success: true };
  },
);

interface RemoveDispatcherRequest {
  uid?: string;
}

/**
 * Manager permanently removes an already-inactive dispatcher access identity.
 * Deletes Firebase Auth user; tombstones dispatcherRoles (preserves history);
 * writes pinAccessAudit dispatcher_removed. Never client-writable.
 */
export const removeDispatcher = onCall(
  { region: "us-central1" },
  async (request) => {
    const callerUid = await requireManagerAuth(request);
    const uid = (request.data as RemoveDispatcherRequest | undefined)?.uid;
    if (typeof uid !== "string" || !uid.trim()) {
      throw new HttpsError("invalid-argument", "Dispatcher uid is required.");
    }
    const targetUid = uid.trim();

    const roleRef = getDb().collection(DISPATCHER_ROLES_COLLECTION).doc(targetUid);
    const roleSnap = await roleRef.get();
    if (!roleSnap.exists) {
      throw new HttpsError("not-found", "Dispatcher account not found.");
    }

    const roleData = roleSnap.data() as DispatcherRoleFields & {
      email?: string;
    };

    const roleEmail =
      typeof roleData.email === "string"
        ? roleData.email.trim().toLowerCase()
        : "";
    let authEmail = "";
    try {
      const authUser = await admin.auth().getUser(targetUid);
      authEmail =
        typeof authUser.email === "string"
          ? authUser.email.trim().toLowerCase()
          : "";
    } catch (err: unknown) {
      const code =
        err instanceof Error && "code" in err
          ? String((err as { code: string }).code)
          : "";
      if (code !== "auth/user-not-found") {
        throw new HttpsError(
          "internal",
          "Could not resolve Auth identity for removal checks.",
        );
      }
    }
    if (
      (roleEmail && PROTECTED_DISPATCHER_EMAILS.has(roleEmail)) ||
      (authEmail && PROTECTED_DISPATCHER_EMAILS.has(authEmail))
    ) {
      throw new HttpsError(
        "failed-precondition",
        "This account cannot be removed.",
      );
    }

    if (targetUid === callerUid) {
      throw new HttpsError(
        "failed-precondition",
        "You cannot remove your own dispatcher account.",
      );
    }

    if (roleData.removed === true) {
      throw new HttpsError(
        "failed-precondition",
        "Account already removed.",
      );
    }

    if (roleData.active !== false) {
      throw new HttpsError(
        "failed-precondition",
        "Deactivate this account before removing it.",
      );
    }

    try {
      await admin.auth().deleteUser(targetUid);
    } catch (err: unknown) {
      const code =
        err instanceof Error && "code" in err
          ? String((err as { code: string }).code)
          : "";
      if (code !== "auth/user-not-found") {
        throw new HttpsError(
          "internal",
          "Auth identity could not be removed. Retry or contact support.",
        );
      }
    }

    const now = new Date().toISOString();
    await roleRef.set(
      {
        active: false,
        removed: true,
        removedAt: now,
        removedBy: callerUid,
        updatedAt: now,
      },
      { merge: true },
    );

    await clearOwnAdminPin(targetUid).catch(() => undefined);

    await writePinAccessAudit({
      action: "dispatcher_removed",
      targetType: "dispatcher",
      targetId: targetUid,
      actorUid: callerUid,
    });

    return { success: true, uid: targetUid };
  },
);
