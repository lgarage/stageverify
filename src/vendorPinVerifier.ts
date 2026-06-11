/** Shared with scripts/vendorPinVerifier.mjs — keep salt in sync. */
export const VENDOR_PIN_VERIFY_SALT = "stageverify-vendor-pin-v1";

export function vendorPinVerifierPayload(
  deliveryId: string,
  pin: string,
): string {
  return `${deliveryId}:${pin}:${VENDOR_PIN_VERIFY_SALT}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function computeVendorPinVerifier(
  deliveryId: string,
  pin: string,
): Promise<string> {
  return sha256Hex(vendorPinVerifierPayload(deliveryId, pin));
}
