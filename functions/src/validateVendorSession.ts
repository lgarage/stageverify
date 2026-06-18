import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  asDeliveryId,
  asSessionToken,
  assertVendorSessionValid,
} from "./vendorSessionValidation";

interface ValidateVendorSessionRequest {
  sessionToken?: string;
  deliveryId?: string;
}

export const validateVendorSession = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const data = (request.data ?? {}) as ValidateVendorSessionRequest;
    const sessionToken = asSessionToken(data.sessionToken);
    const deliveryId = asDeliveryId(data.deliveryId);

    if (!sessionToken || !deliveryId) {
      throw new HttpsError("invalid-argument", "Invalid session.");
    }

    const session = await assertVendorSessionValid(sessionToken, deliveryId);
    return {
      valid: true,
      deliveryId: session.deliveryId,
      vendorId: session.vendorId,
      vendorName: session.vendorName,
      expiresAt: session.expiresAt,
    };
  },
);
