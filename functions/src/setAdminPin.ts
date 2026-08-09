/**
 * Self-targeted Admin PIN set/reset (hash-only).
 * Caller must already be an active Admin (bootstrap promotion is a separate callable).
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { asAdminPin, setOwnAdminPin } from "./adminPinSecret";
import {
  writePinAccessAudit,
  writePinAccessAuditBestEffort,
} from "./accessPinSecretsShared";
import {
  readDispatcherRoleDoc,
  requireAdminAuth,
} from "./inboundEmail/dispatcherAuth";

interface SetAdminPinRequest {
  adminPin?: string;
}

export const setAdminPin = onCall(
  { region: "us-central1" },
  async (request) => {
    let uid: string;
    try {
      uid = await requireAdminAuth(request);
    } catch (err) {
      if (err instanceof HttpsError && request.auth?.uid) {
        await writePinAccessAuditBestEffort({
          action: "admin_pin_set_denied",
          targetType: "dispatcher",
          targetId: request.auth.uid,
          actorUid: request.auth.uid,
        });
      }
      throw err;
    }

    const data = (request.data ?? {}) as SetAdminPinRequest;
    const pin = asAdminPin(data.adminPin);
    if (!pin) {
      await writePinAccessAuditBestEffort({
        action: "admin_pin_set_denied",
        targetType: "dispatcher",
        targetId: uid,
        actorUid: uid,
      });
      throw new HttpsError(
        "invalid-argument",
        "Admin PIN must be exactly 6 digits.",
      );
    }

    const roleDoc = await readDispatcherRoleDoc(uid);
    const fullName =
      typeof roleDoc?.fullName === "string" ? roleDoc.fullName : undefined;

    await setOwnAdminPin(uid, pin);

    await writePinAccessAudit({
      action: "admin_pin_set",
      targetType: "dispatcher",
      targetId: uid,
      actorUid: uid,
      actorFullName: fullName,
    });

    return { success: true };
  },
);
