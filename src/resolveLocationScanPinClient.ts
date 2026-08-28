import type {
  ResolveLocationScanPinInput,
  ResolveLocationScanPinResult,
} from "./dispatcher/models";
import { callCallable } from "./phase2CallableClients";
import { markVendorPinDebug } from "./vendorPinDebugTimeline";

export async function resolveLocationScanPin(
  input: ResolveLocationScanPinInput,
): Promise<ResolveLocationScanPinResult> {
  markVendorPinDebug("PIN_RESOLVE_START");
  try {
    const result = await callCallable<ResolveLocationScanPinResult>(
      "resolveLocationScanPin",
      { ...input },
    );
    markVendorPinDebug("PIN_RESOLVE_DONE");
    return result;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "resolveLocationScanPin failed";
    markVendorPinDebug("ERROR:PIN_RESOLVE", message);
    throw err;
  }
}
