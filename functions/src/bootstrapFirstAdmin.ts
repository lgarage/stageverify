/**
 * Atomic first-Admin bootstrap — Manager-only, zero-Admin window only.
 * Uses Firestore transaction on lock + roles + admin secret so two Managers
 * cannot both succeed.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  ACCESS_CONTROL_LOCKS_COLLECTION,
  ACCESS_PIN_SECRETS_COLLECTION,
  FIRST_ADMIN_BOOTSTRAP_LOCK_ID,
  getDb,
  writePinAccessAudit,
} from "./accessPinSecretsShared";
import {
  adminPinSecretDocId,
  asAdminPin,
  buildAdminPinSecretDoc,
} from "./adminPinSecret";
import {
  rolePatch,
  validateHumanFullName,
  resolveDispatcherAccessRole,
  type DispatcherRoleFields,
} from "./humanAccessIdentity";
import { requireManagerAuth } from "./inboundEmail/dispatcherAuth";

const DISPATCHER_ROLES_COLLECTION = "dispatcherRoles";

export type FirstAdminBootstrapLockDoc = {
  claimed: true;
  adminUid: string;
  adminFullName: string;
  claimedByUid: string;
  claimedAt: string;
};

export type BootstrapFirstAdminResult = {
  success: true;
  uid: string;
  fullName: string;
  role: "admin";
};

function countActiveAdminsInDocs(
  docs: Array<{ data: () => Record<string, unknown> }>,
): number {
  let count = 0;
  for (const doc of docs) {
    const data = doc.data() as DispatcherRoleFields;
    if (data.removed === true) continue;
    if (data.active === false) continue;
    if (resolveDispatcherAccessRole(data) === "admin") count += 1;
  }
  return count;
}

/**
 * Core transactional bootstrap — exported for emulator concurrency tests.
 * Binds target uid + fullName + role=admin + Admin PIN atomically with lock.
 */
export async function runBootstrapFirstAdminTransaction(input: {
  callerUid: string;
  targetUid: string;
  fullName: string;
  adminPin: unknown;
}): Promise<BootstrapFirstAdminResult> {
  const pin = asAdminPin(input.adminPin);
  if (!pin) {
    throw new HttpsError(
      "invalid-argument",
      "Admin PIN must be exactly 6 digits.",
    );
  }
  const fullName = validateHumanFullName(input.fullName);
  const targetUid = input.targetUid.trim();
  if (!targetUid) {
    throw new HttpsError("invalid-argument", "Target uid is required.");
  }

  const db = getDb();
  const lockRef = db
    .collection(ACCESS_CONTROL_LOCKS_COLLECTION)
    .doc(FIRST_ADMIN_BOOTSTRAP_LOCK_ID);
  const roleRef = db.collection(DISPATCHER_ROLES_COLLECTION).doc(targetUid);
  const secretRef = db
    .collection(ACCESS_PIN_SECRETS_COLLECTION)
    .doc(adminPinSecretDocId(targetUid));
  const now = new Date().toISOString();
  const secretDoc = buildAdminPinSecretDoc(targetUid, pin, now);

  await db.runTransaction(async (tx) => {
    const lockSnap = await tx.get(lockRef);
    if (lockSnap.exists) {
      throw new HttpsError(
        "failed-precondition",
        "First Admin has already been bootstrapped.",
      );
    }

    const rolesSnap = await tx.get(db.collection(DISPATCHER_ROLES_COLLECTION));
    if (countActiveAdminsInDocs(rolesSnap.docs) > 0) {
      throw new HttpsError(
        "failed-precondition",
        "An active Admin already exists. Use Admin authorization to grant Admin.",
      );
    }

    const roleSnap = await tx.get(roleRef);
    if (!roleSnap.exists) {
      throw new HttpsError("not-found", "Target access identity not found.");
    }
    const existing = roleSnap.data() as DispatcherRoleFields;
    if (existing.removed === true) {
      throw new HttpsError("failed-precondition", "Account already removed.");
    }
    if (existing.active === false) {
      throw new HttpsError(
        "failed-precondition",
        "Target account must be active to become the first Admin.",
      );
    }

    const lockDoc: FirstAdminBootstrapLockDoc = {
      claimed: true,
      adminUid: targetUid,
      adminFullName: fullName,
      claimedByUid: input.callerUid,
      claimedAt: now,
    };

    tx.set(lockRef, lockDoc);
    tx.set(
      roleRef,
      {
        ...rolePatch("admin", {
          fullName,
          active: true,
          updatedAt: now,
          bootstrappedAsAdminAt: now,
          bootstrappedAsAdminBy: input.callerUid,
        }),
      },
      { merge: true },
    );
    tx.set(secretRef, secretDoc);
  });

  return {
    success: true,
    uid: targetUid,
    fullName,
    role: "admin",
  };
}

interface BootstrapFirstAdminRequest {
  uid?: string;
  fullName?: string;
  adminPin?: string;
}

/**
 * Manager bootstraps the first named Admin while zero active Admins exist.
 * Not a permanent Manager→Admin escalation path — lock + active-Admin count
 * permanently close this window after the first success.
 */
export const bootstrapFirstAdmin = onCall(
  { region: "us-central1" },
  async (request) => {
    const callerUid = await requireManagerAuth(request);
    const data = (request.data ?? {}) as BootstrapFirstAdminRequest;
    const targetUid =
      typeof data.uid === "string" && data.uid.trim()
        ? data.uid.trim()
        : callerUid;

    const result = await runBootstrapFirstAdminTransaction({
      callerUid,
      targetUid,
      fullName: data.fullName as string,
      adminPin: data.adminPin,
    });

    const callerSnap = await getDb()
      .collection(DISPATCHER_ROLES_COLLECTION)
      .doc(callerUid)
      .get();
    const callerData = callerSnap.data() as DispatcherRoleFields | undefined;
    const actorFullName =
      typeof callerData?.fullName === "string"
        ? callerData.fullName
        : undefined;

    await writePinAccessAudit({
      action: "admin_bootstrap",
      targetType: "dispatcher",
      targetId: result.uid,
      actorUid: callerUid,
      actorFullName,
    });
    await writePinAccessAudit({
      action: "admin_created",
      targetType: "dispatcher",
      targetId: result.uid,
      actorUid: callerUid,
      actorFullName,
    });
    await writePinAccessAudit({
      action: "admin_pin_set",
      targetType: "dispatcher",
      targetId: result.uid,
      actorUid: callerUid,
      actorFullName,
    });

    return result;
  },
);
