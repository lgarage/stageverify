import { getFunctions, httpsCallable } from "firebase/functions";
import type {
  ResolveLocationScanPinInput,
  ResolveLocationScanPinResult,
} from "./dispatcher/models";
import { markVendorPinDebug } from "./vendorPinDebugTimeline";

export async function resolveLocationScanPin(
  input: ResolveLocationScanPinInput,
): Promise<ResolveLocationScanPinResult> {
  markVendorPinDebug("PIN_RESOLVE_START");
  try {
    const functions = getFunctions();
    const callable = httpsCallable(functions, "resolveLocationScanPin");
    const response = await callable(input);
    markVendorPinDebug("PIN_RESOLVE_DONE");
    return response.data as ResolveLocationScanPinResult;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "resolveLocationScanPin failed";
    markVendorPinDebug("ERROR:PIN_RESOLVE", message);
    throw err;
  }
}
