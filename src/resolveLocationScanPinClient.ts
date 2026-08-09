import { getFunctions, httpsCallable } from "firebase/functions";
import type {
  ResolveLocationScanPinInput,
  ResolveLocationScanPinResult,
} from "./dispatcher/models";

export async function resolveLocationScanPin(
  input: ResolveLocationScanPinInput,
): Promise<ResolveLocationScanPinResult> {
  const functions = getFunctions();
  const callable = httpsCallable(functions, "resolveLocationScanPin");
  const response = await callable(input);
  return response.data as ResolveLocationScanPinResult;
}
