/**
 * Shared vendor session helpers for CF emulator tests.
 */

import { createHash } from "crypto";
import { doc, setDoc } from "firebase/firestore";

export function vendorSessionTokenFor(deliveryId) {
  return createHash("sha256").update(`test-session:${deliveryId}`).digest("hex");
}

export async function seedVendorSession(db, deliveryId) {
  const token = vendorSessionTokenFor(deliveryId);
  await setDoc(doc(db, "vendorSessions", token), {
    id: token,
    deliveryId,
    vendorId: "vendor-test",
    vendorName: "Test Vendor",
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  return token;
}

export function recalcPayload(deliveryOrderId) {
  return {
    deliveryOrderId,
    sessionToken: vendorSessionTokenFor(deliveryOrderId),
  };
}
