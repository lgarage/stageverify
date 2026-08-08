import { onCall, HttpsError } from "firebase-functions/v2/https";
import { createAdminAccessSession } from "./adminAccessSession";
import {
  parseAccessPinTargetType,
  writePinAccessAudit,
  writePinAccessAuditBestEffort,
} from "./accessPinSecretsShared";
import { assertAccessPinTargetExists } from "./accessPinTargetHelpers";
import { requireManagerAuth } from "./inboundEmail/dispatcherAuth";

interface StartAdminAccessSessionRequest {
  targetType?: string;
  targetId?: string;
}

/** Manager mints a row-scoped admin access session (5 min TTL). */
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
      uid = await requireManagerAuth(request);
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
    });

    return {
      sessionToken: session.sessionToken,
      expiresAt: session.expiresAt,
    };
  },
);
