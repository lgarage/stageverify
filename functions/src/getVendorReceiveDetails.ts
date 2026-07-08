import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  asDeliveryId,
  asSessionToken,
  assertVendorSessionValid,
} from "./vendorSessionValidation";
import { hydratePublicDeliveryDetails } from "./deliveryDetailsResponse";
import * as admin from "firebase-admin";

function getDb() {
  return admin.firestore();
}

interface GetVendorReceiveDetailsRequest {
  deliveryId?: string;
  sessionToken?: string;
}

export const getVendorReceiveDetails = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const data = (request.data ?? {}) as GetVendorReceiveDetailsRequest;
    const deliveryId = asDeliveryId(data.deliveryId);
    const sessionToken = asSessionToken(data.sessionToken);

    if (!deliveryId || !sessionToken) {
      throw new HttpsError("invalid-argument", "Invalid session.");
    }

    await assertVendorSessionValid(sessionToken, deliveryId);
    const details = await hydratePublicDeliveryDetails(getDb(), deliveryId);
    if (!details) {
      throw new HttpsError("not-found", "Delivery not found.");
    }
    return details;
  },
);
