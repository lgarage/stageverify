/**
 * AES-GCM encryption for revealable access PINs (CF-only).
 *
 * Production secret (Firebase Functions — never commit):
 *   ACCESS_PIN_ENCRYPTION_KEY — base64 encoding of exactly 32 raw bytes.
 *
 * Local/emulator tests may set process.env.ACCESS_PIN_ENCRYPTION_KEY when the
 * Functions secret is unavailable (test helper only).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { defineSecret } from "firebase-functions/params";

export const accessPinEncryptionKey = defineSecret("ACCESS_PIN_ENCRYPTION_KEY");

const KEY_VERSION = 1;
const IV_BYTES = 12;

/** Hex-encoded iv, ciphertext, tag (AES-256-GCM). */
export type PinEncrypted = {
  alg: "AES-GCM";
  iv: string;
  ciphertext: string;
  tag: string;
  keyVersion: number;
};

function decodeKeyMaterial(raw: string): Buffer {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("ACCESS_PIN_ENCRYPTION_KEY is empty.");
  }
  const key = Buffer.from(trimmed, "base64");
  if (key.byteLength !== 32) {
    throw new Error(
      `ACCESS_PIN_ENCRYPTION_KEY must decode to 32 bytes (got ${key.byteLength}).`,
    );
  }
  return key;
}

/** Resolve 32-byte key from bound secret or test env fallback. */
export function resolveAccessPinEncryptionKey(): Buffer {
  let raw: string | undefined;
  try {
    raw = accessPinEncryptionKey.value();
  } catch {
    raw = undefined;
  }
  if (!raw?.trim()) {
    raw = process.env.ACCESS_PIN_ENCRYPTION_KEY;
  }
  if (!raw?.trim()) {
    throw new Error("ACCESS_PIN_ENCRYPTION_KEY is not configured.");
  }
  return decodeKeyMaterial(raw);
}

export function encryptPinForStorage(pin: string): PinEncrypted {
  const key = resolveAccessPinEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(pin, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    alg: "AES-GCM",
    iv: iv.toString("hex"),
    ciphertext: ciphertext.toString("hex"),
    tag: tag.toString("hex"),
    keyVersion: KEY_VERSION,
  };
}

export function decryptPinFromStorage(encrypted: PinEncrypted): string {
  if (encrypted.alg !== "AES-GCM") {
    throw new Error("Unsupported PIN encryption algorithm.");
  }
  const key = resolveAccessPinEncryptionKey();
  const iv = Buffer.from(encrypted.iv, "hex");
  const ciphertext = Buffer.from(encrypted.ciphertext, "hex");
  const tag = Buffer.from(encrypted.tag, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString("utf8");
}
