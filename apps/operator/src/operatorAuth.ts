import { httpsCallable } from "firebase/functions";
import { assertSafeBackend } from "./api/assertSafeBackend";
import { functions } from "./firebase";

export type OperatorSession = {
  isOperator: boolean;
};

export async function fetchOperatorSession(): Promise<OperatorSession> {
  assertSafeBackend();
  const callable = httpsCallable<Record<string, never>, OperatorSession>(
    functions,
    "getOperatorSession",
  );
  const result = await callable({});
  return result.data;
}
