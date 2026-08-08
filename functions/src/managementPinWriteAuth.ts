import { HttpsError } from "firebase-functions/v2/https";
import {
  parseAdminAccessSessionToken,
  validateAdminAccessSession,
} from "./adminAccessSession";
import { targetHasExistingAccessPin } from "./accessPinTargetHelpers";
import type { UpsertManagementPinInput } from "./managementPinRegistry";
import { requireDispatcherAuth, requireManagerAuth } from "./inboundEmail/dispatcherAuth";

export interface ManagementPinSessionConsumption {
  sessionId: string;
  raw: string;
}

export interface ManagementPinWriteAuthResult {
  actorUid: string;
  sessionConsumption: ManagementPinSessionConsumption | null;
}

function asPinIdForAuth(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(trimmed)) return null;
  return trimmed;
}

/** Callable auth for management PIN writes — mirrors setAccessPin pin-path rules. */
export async function authorizeManagementPinWrite(
  request: { auth?: { uid?: string } },
  input: UpsertManagementPinInput & {
    sessionToken?: string;
    /** setManagementPin back-compat always targets `default`. */
    fixedTargetId?: string;
  },
): Promise<ManagementPinWriteAuthResult> {
  const pinProvided = input.pin !== undefined;
  const sessionToken =
    typeof input.sessionToken === "string" ? input.sessionToken.trim() : "";

  if (!pinProvided) {
    const actorUid = await requireDispatcherAuth(request);
    return { actorUid, sessionConsumption: null };
  }

  const actorUid = await requireManagerAuth(request);
  const targetId =
    input.fixedTargetId ??
    asPinIdForAuth(input.id) ??
    null;
  const hasExisting = targetId
    ? await targetHasExistingAccessPin("management", targetId)
    : false;

  if (!hasExisting) {
    return { actorUid, sessionConsumption: null };
  }

  if (!targetId) {
    throw new HttpsError("internal", "Invalid management PIN target.");
  }

  if (!sessionToken) {
    throw new HttpsError(
      "permission-denied",
      "Admin access session required to change an existing PIN.",
    );
  }

  const sessionCheck = await validateAdminAccessSession({
    sessionToken,
    managerUid: actorUid,
    targetType: "management",
    targetId,
  });
  if (!sessionCheck.ok) {
    throw new HttpsError(
      "permission-denied",
      "Admin access session invalid or expired.",
    );
  }

  const parsedSession = parseAdminAccessSessionToken(sessionToken);
  if (!parsedSession) {
    throw new HttpsError(
      "permission-denied",
      "Admin access session invalid or expired.",
    );
  }

  return {
    actorUid,
    sessionConsumption: {
      sessionId: parsedSession.sessionId,
      raw: parsedSession.raw,
    },
  };
}
