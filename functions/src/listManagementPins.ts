import { onCall } from "firebase-functions/v2/https";
import { requireDispatcherAuth } from "./inboundEmail/dispatcherAuth";
import { listManagementPinsForSettings } from "./managementPinRegistry";

/** Dispatcher lists management PIN identities — never returns hashes. */
export const listManagementPins = onCall(
  { region: "us-central1" },
  async (request) => {
    await requireDispatcherAuth(request);
    const pins = await listManagementPinsForSettings();
    return { pins };
  },
);
