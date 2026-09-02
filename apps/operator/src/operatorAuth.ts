import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

export type OperatorSession = {
  isOperator: boolean;
};

export async function fetchOperatorSession(): Promise<OperatorSession> {
  const callable = httpsCallable<Record<string, never>, OperatorSession>(
    functions,
    "getOperatorSession",
  );
  const result = await callable({});
  return result.data;
}
