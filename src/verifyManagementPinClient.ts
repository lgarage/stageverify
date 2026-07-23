import { getFunctions, httpsCallable } from "firebase/functions";
import type {
  VerifyManagementPinInput,
  VerifyManagementPinResult,
} from "./dispatcher/models";

export async function verifyManagementPin(
  input: VerifyManagementPinInput,
): Promise<VerifyManagementPinResult> {
  const functions = getFunctions();
  const callable = httpsCallable(functions, "verifyManagementPin");
  const response = await callable(input);
  return response.data as VerifyManagementPinResult;
}
