import { httpsCallable } from "firebase/functions";
import type {
  ResolveLocationScanPinInput,
  ResolveLocationScanPinResult,
} from "./dispatcher/models";
import { markVendorPinDebug } from "./vendorPinDebugTimeline";
import { functions } from "./firebase";

let vendorLoginCallablesPrewarmed = false;

/** Bind Firebase httpsCallable handles once (no network) before first PIN/list submit. */
export function prewarmVendorLoginCallables(): void {
  if (vendorLoginCallablesPrewarmed) return;
  vendorLoginCallablesPrewarmed = true;
  httpsCallable(functions, "resolveLocationScanPin");
  httpsCallable(functions, "getVendorRunDeliveries");
}

export async function resolveLocationScanPin(
  input: ResolveLocationScanPinInput,
): Promise<ResolveLocationScanPinResult> {
  markVendorPinDebug("PIN_RESOLVE_START");
  try {
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
