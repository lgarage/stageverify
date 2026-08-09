import { onCall, HttpsError } from "firebase-functions/v2/https";
import { createAdminAccessSession } from "./adminAccessSession";
import { verifyOwnAdminPinForSession } from "./adminPinSecret";
import {
  parseAccessPinTargetType,
  writePinAccessAudit,
  writePinAccessAuditBestEffort,
} from "./accessPinSecretsShared";
import { assertAccessPinTargetExists } from "./accessPinTargetHelpers";
import {
  readDispatcherRoleDoc,
  requireAdminAuth,
} from "./inboundEmail/dispatcherAuth";

interface StartAdminAccessSessionRequest {
  targetType?: string;
  targetId?: string;
  /** Caller's own 6-digit Admin PIN — authorizing credential, never logged. */
  adminPin?: string;
}

/** Active Admin + own Admin PIN mints a row-scoped admin access session (5 min TTL). */
export const startAdminAccessSession = onCall(
  { region: "us-central1" },
  async (request) => {
    const data = (request.data ?? {}) as StartAdminAccessSessionRequest;
    const targetType = parseAccessPinTargetType(data.targetType);
    const targetId =
      typeof data.targetId === "string" ? data.targetId.trim() : "";

    if (!targetType || !targetId) {
      throw new HttpsError("invalid-argument", "Invalid PIN access target.");
    }

    let uid: string;
    try {
      uid = await requireAdminAuth(request);
    } catch (err) {
      if (
        err instanceof HttpsError &&
        err.code === "permission-denied" &&
        request.auth?.uid
      ) {
        await writePinAccessAuditBestEffort({
          action: "admin_access_denied",
          targetType,
          targetId,
          actorUid: request.auth.uid,
        });
      }
      throw err;
    }

    const roleDoc = await readDispatcherRoleDoc(uid);
    const actorFullName =
      typeof roleDoc?.fullName === "string" ? roleDoc.fullName : undefined;

    const pinOk = await verifyOwnAdminPinForSession(uid, data.adminPin);
    if (!pinOk) {
      await writePinAccessAudit({
        action: "admin_access_denied",
        targetType,
        targetId,
        actorUid: uid,
        actorFullName,
      });
      throw new HttpsError(
        "permission-denied",
        "Invalid Admin PIN.",
      );
    }

    await assertAccessPinTargetExists(targetType, targetId);

    const session = await createAdminAccessSession({
      managerUid: uid,
      targetType,
      targetId,
    });

    await writePinAccessAudit({
      action: "admin_access_granted",
      targetType,
      targetId,
      actorUid: uid,
      actorFullName,
    });

    return {
      sessionToken: session.sessionToken,
      expiresAt: session.expiresAt,
    };
  },
);
