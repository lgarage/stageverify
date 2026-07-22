import { getFunctions, httpsCallable } from "firebase/functions";
import type {
  VerifyTechnicianPinInput,
  VerifyTechnicianPinResult,
} from "./dispatcher/models";

export async function verifyTechnicianPin(
  input: VerifyTechnicianPinInput,
): Promise<VerifyTechnicianPinResult> {
  const functions = getFunctions();
  const callable = httpsCallable(functions, "verifyTechnicianPin");
  const response = await callable(input);
  return response.data as VerifyTechnicianPinResult;
}
