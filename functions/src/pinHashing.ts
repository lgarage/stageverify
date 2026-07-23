import { randomBytes, scryptSync } from "crypto";

/** Store as `salt:hex` on pinHash / managementPinHash fields. */
export function hashPinForStorage(pin: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pin, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}
