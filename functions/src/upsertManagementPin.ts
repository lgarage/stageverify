import { onCall, HttpsError } from "firebase-functions/v2/https";
import { requireDispatcherAuth } from "./inboundEmail/dispatcherAuth";
import {
  upsertManagementPinDoc,
  type ManagementPinPermissions,
} from "./managementPinRegistry";

interface UpsertManagementPinRequest {
  id?: string;
  label?: string;
  pin?: string;
  active?: boolean;
  permissions?: ManagementPinPermissions;
}

/** Dispatcher create/update management PIN + capability matrix. */
export const upsertManagementPin = onCall(
  { region: "us-central1" },
  async (request) => {
    await requireDispatcherAuth(request);
    const data = (request.data ?? {}) as UpsertManagementPinRequest;
    try {
      const result = await upsertManagementPinDoc({
        id: data.id,
        label: data.label,
        pin: data.pin,
        active: data.active,
        permissions: data.permissions,
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
