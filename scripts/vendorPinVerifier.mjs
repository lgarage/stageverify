import { createHash } from "crypto";

/** Keep in sync with src/vendorPinVerifier.ts */
export const VENDOR_PIN_VERIFY_SALT = "stageverify-vendor-pin-v1";

export function computeVendorPinVerifier(deliveryId, pin) {
  return createHash("sha256")
    .update(`${deliveryId}:${pin}:${VENDOR_PIN_VERIFY_SALT}`)
    .digest("hex");
}
