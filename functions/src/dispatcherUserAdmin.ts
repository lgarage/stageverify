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

const DISPATCHER_ROLES_COLLECTION = "dispatcherRoles";

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
      };
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
