import { onCall, HttpsError } from "firebase-functions/v2/https";
import { revokeAdminAccessSessionByToken } from "./adminAccessSession";
import {
  parseAccessPinTargetType,
  writePinAccessAudit,
} from "./accessPinSecretsShared";
import { requireManagerAuth } from "./inboundEmail/dispatcherAuth";

interface RevokeAdminAccessSessionRequest {
  sessionToken?: string;
  targetType?: string;
  targetId?: string;
}

/** Idempotent revoke — audit only when session actually revoked. */
export const revokeAdminAccessSession = onCall(
  { region: "us-central1" },
  async (request) => {
    const uid = await requireManagerAuth(request);
    const data = (request.data ?? {}) as RevokeAdminAccessSessionRequest;
    const sessionToken =
      typeof data.sessionToken === "string" ? data.sessionToken.trim() : "";
    const targetType = parseAccessPinTargetType(data.targetType);
    const targetId =
      typeof data.targetId === "string" ? data.targetId.trim() : "";

    if (!sessionToken) {
      throw new HttpsError("invalid-argument", "sessionToken is required.");
    }

    const didRevoke = await revokeAdminAccessSessionByToken(sessionToken);

    if (didRevoke && targetType && targetId) {
      await writePinAccessAudit({
        action: "admin_access_revoked",
        targetType,
        targetId,
        actorUid: uid,
      });
    }

    return { success: true, revoked: didRevoke };
  },
);
