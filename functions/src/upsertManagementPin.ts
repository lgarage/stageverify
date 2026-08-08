import { onCall, HttpsError } from "firebase-functions/v2/https";
import { accessPinEncryptionKey } from "./accessPinCrypto";
import {
  upsertManagementPinDoc,
  type ManagementPinPermissions,
} from "./managementPinRegistry";
import { authorizeManagementPinWrite } from "./managementPinWriteAuth";

interface UpsertManagementPinRequest {
  id?: string;
  label?: string;
  pin?: string;
  active?: boolean;
  permissions?: ManagementPinPermissions;
  sessionToken?: string;
}

/** Dispatcher metadata / manager-gated PIN writes for management PIN + capability matrix. */
export const upsertManagementPin = onCall(
  {
    region: "us-central1",
    secrets: [accessPinEncryptionKey],
  },
  async (request) => {
    const data = (request.data ?? {}) as UpsertManagementPinRequest;
    const auth = await authorizeManagementPinWrite(request, {
      id: data.id,
      label: data.label,
      pin: data.pin,
      active: data.active,
      permissions: data.permissions,
      sessionToken: data.sessionToken,
    });

    try {
      const result = await upsertManagementPinDoc({
        id: data.id,
        label: data.label,
        pin: data.pin,
        active: data.active,
        permissions: data.permissions,
        sessionConsumption: auth.sessionConsumption,
        actorUid: auth.actorUid,
      });
      return { success: true, id: result.id };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError(
        "internal",
        err instanceof Error ? err.message : "Failed to save management PIN.",
      );
    }
  },
);
