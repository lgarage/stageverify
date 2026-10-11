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

export async function seedExpiredVendorSession(db, deliveryId) {
  const token = vendorSessionTokenFor(deliveryId);
  await setDoc(doc(db, "vendorSessions", token), {
    id: token,
    deliveryId,
    vendorId: "vendor-test",
    vendorName: "Test Vendor",
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  });
  return token;
}

export function vendorScopedSessionTokenFor(vendorId) {
  return createHash("sha256").update(`test-vendor-scope:${vendorId}`).digest("hex");
}

export async function seedVendorScopedSession(db, vendorId) {
  const token = vendorScopedSessionTokenFor(vendorId);
  await setDoc(doc(db, "vendorSessions", token), {
    id: token,
    deliveryId: "",
    vendorId,
    vendorName: "Test Vendor",
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    sessionScope: "vendor",
  });
  return token;
}

export function recalcPayload(deliveryOrderId) {
  return {
    deliveryOrderId,
    sessionToken: vendorSessionTokenFor(deliveryOrderId),
  };
}
