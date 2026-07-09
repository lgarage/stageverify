import { scryptSync, timingSafeEqual } from "crypto";

export interface PinCarrier {
  pinCode?: string;
  pinHash?: string;
}

export function asFourDigitPin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}$/.test(trimmed)) return null;
  return trimmed;
}

function hashPin(pin: string, salt: string): string {
  return scryptSync(pin, salt, 32).toString("hex");
}

/** Matches plain pinCode or scrypt pinHash (`salt:hex`). */
export function pinMatches(carrier: PinCarrier, pin: string): boolean {
  if (typeof carrier.pinCode === "string" && carrier.pinCode.length > 0) {
    return carrier.pinCode === pin;
  }
  if (typeof carrier.pinHash === "string" && carrier.pinHash.includes(":")) {
    const [salt, expected] = carrier.pinHash.split(":");
    if (!salt || !expected) return false;
    const actual = hashPin(pin, salt);
    try {
      return timingSafeEqual(
        Buffer.from(actual, "hex"),
        Buffer.from(expected, "hex"),
      );
    } catch {
      return false;
    }
  }
  return false;
}
