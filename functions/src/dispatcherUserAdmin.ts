/**
 * Manager-only dispatcher account provisioning (D-60).
 * Admin SDK creates Auth users + dispatcherRoles docs — no client writes.
 */
import * as admin from "firebase-admin";
import { randomBytes } from "crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  requireManagerAuth,
} from "./inboundEmail/dispatcherAuth";
import { writePinAccessAudit } from "./accessPinSecretsShared";

const DISPATCHER_ROLES_COLLECTION = "dispatcherRoles";

/** Hard-blocked from permanent removal (ops / primary test identities). */
const PROTECTED_DISPATCHER_EMAILS = new Set([
  "daday1974@gmail.com",
  "test@stageverify.dev", // pragma: allowlist secret — ops allowlist, not a credential
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

export interface DispatcherAccountSummary {
  uid: string;
  email: string | null;
  active: boolean;
  manager: boolean;
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
      const data = roleDoc.data() as {
        active?: boolean;
        manager?: boolean;
        email?: string;
        updatedAt?: string;
        removed?: boolean;
      };
      if (data.removed === true) continue;
      let email: string | null = data.email ?? null;
      if (!email) {
        try {
          const user = await admin.auth().getUser(roleDoc.id);
          email = user.email ?? null;
        } catch {
          email = null;
        }
      }
      dispatchers.push({
        uid: roleDoc.id,
        email,
        active: data.active !== false,
        manager: data.manager === true,
        updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
      });
    }

    dispatchers.sort((a, b) =>
      (a.email ?? a.uid).localeCompare(b.email ?? b.uid),
    );
    return { dispatchers };
  },
);

interface ProvisionDispatcherRequest {
  email?: string;
  temporaryPassword?: string;
  manager?: boolean;
}

/** Manager creates Firebase Auth user + dispatcherRoles doc. */
export const provisionDispatcher = onCall(
  { region: "us-central1" },
  async (request) => {
    await requireManagerAuth(request);
    const data = (request.data ?? {}) as ProvisionDispatcherRequest;
    const email = normalizeEmail(data.email);
    const grantManager = data.manager === true;
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
          active: true,
          email,
          manager: grantManager,
          updatedAt: now,
          createdAt: now,
          createdBy: request.auth?.uid ?? null,
        },
        { merge: true },
      );

    return {
      success: true,
      uid,
      email,
      temporaryPassword: tempPassword,
      manager: grantManager,
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

    const roleData = roleSnap.data() as {
      active?: boolean;
      email?: string;
      removed?: boolean;
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

    await writePinAccessAudit({
      action: "dispatcher_removed",
      targetType: "dispatcher",
      targetId: targetUid,
      actorUid: callerUid,
    });

    return { success: true, uid: targetUid };
  },
);
