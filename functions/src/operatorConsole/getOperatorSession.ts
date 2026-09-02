import { onCall } from "firebase-functions/v2/https";
import { isActiveOperator, requireOperatorAuth } from "./operatorAuth";
import { OPERATOR_CALLABLE_CORS } from "./operatorCollections";

export const getOperatorSession = onCall(
  {
    region: "us-central1",
    cors: OPERATOR_CALLABLE_CORS,
  },
  async (request) => {
    if (!request.auth?.uid) {
      return { isOperator: false };
    }
    try {
      await requireOperatorAuth(request);
      return { isOperator: true };
    } catch {
      return { isOperator: false };
    }
  },
);

export async function getOperatorSessionForUid(
  uid: string | undefined,
): Promise<{ isOperator: boolean }> {
  if (!uid) return { isOperator: false };
  const active = await isActiveOperator(uid);
  return { isOperator: active };
}
