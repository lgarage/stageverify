import { onCall, HttpsError } from "firebase-functions/v2/https";
import { requireDispatcherAuth } from "./inboundEmail/dispatcherAuth";
import { deactivateManagementPinDoc } from "./managementPinRegistry";

interface DeactivateManagementPinRequest {
  id?: string;
}

/** Dispatcher deactivates a management PIN (sessions re-check and deny). */
export const deactivateManagementPin = onCall(
  { region: "us-central1" },
  async (request) => {
    await requireDispatcherAuth(request);
    const id = (request.data as DeactivateManagementPinRequest | undefined)?.id;
    if (typeof id !== "string" || !id.trim()) {
      throw new HttpsError("invalid-argument", "PIN id is required.");
    }
    await deactivateManagementPinDoc(id);
    return { success: true };
  },
);
