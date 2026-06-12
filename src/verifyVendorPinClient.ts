import type {
  VerifyVendorPinInput,
  VerifyVendorPinResult,
} from "./dispatcher/models";
import { restGetDelivery } from "./firestoreRest";
import {
  computeVendorPinVerifier,
  vendorPinVerifierPayload,
  sha256Hex,
} from "./vendorPinVerifier";

const VERIFY_VENDOR_PIN_URL =
  "https://us-central1-stageverify-db.cloudfunctions.net/verifyVendorPin";

const VERIFY_TIMEOUT_MS = 20_000;

type CallableBody = {
  result?: VerifyVendorPinResult;
  error?: { message?: string; status?: string };
};

async function verifyVendorPinFetch(
  input: VerifyVendorPinInput,
): Promise<VerifyVendorPinResult> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    const response = await fetch(VERIFY_VENDOR_PIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: input }),
      signal: controller.signal,
    });

    let body: CallableBody;
    try {
      body = (await response.json()) as CallableBody;
    } catch {
      throw new Error("Unable to verify PIN. Try again.");
    }

    if (body.error) {
      throw new Error(body.error.message ?? "Unable to verify PIN. Try again.");
    }
    if (body.result) {
      return body.result;
    }
    throw new Error("Unable to verify PIN. Try again.");
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(
        "PIN verify timed out. Check your connection and try again.",
      );
    }
    if (err instanceof Error) throw err;
    throw new Error("Unable to verify PIN. Try again.");
  } finally {
    window.clearTimeout(timer);
  }
}

/** Public-read fallback when the Cloud Function is slow or unreachable (e.g. iOS Safari). */
async function verifyVendorPinLocal(
  input: VerifyVendorPinInput,
): Promise<VerifyVendorPinResult | null> {
  const delivery = await restGetDelivery(input.deliveryId);
  if (!delivery) {
    return { success: false, message: "Invalid code." };
  }

  if (!delivery.vendorPinVerifier) {
    return null;
  }

  const actual = await sha256Hex(
    vendorPinVerifierPayload(input.deliveryId, input.pin),
  );
  if (actual !== delivery.vendorPinVerifier) {
    return { success: false, message: "Invalid code." };
  }

  return {
    success: true,
    vendorId: delivery.vendorId,
    vendorName: delivery.vendorName?.trim() || "Vendor",
    deliveryId: input.deliveryId,
  };
}

export async function verifyVendorPin(
  input: VerifyVendorPinInput,
): Promise<VerifyVendorPinResult> {
  try {
    return await verifyVendorPinFetch(input);
  } catch (fetchErr) {
    const local = await verifyVendorPinLocal(input);
    if (local) return local;
    if (fetchErr instanceof Error) throw fetchErr;
    throw new Error("Unable to verify PIN. Check your connection and try again.");
  }
}

/** For dispatcher seeding / tests — same digest written to delivery docs. */
export { computeVendorPinVerifier };
