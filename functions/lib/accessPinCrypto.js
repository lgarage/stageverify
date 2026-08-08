"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.accessPinEncryptionKey = void 0;
exports.resolveAccessPinEncryptionKey = resolveAccessPinEncryptionKey;
exports.encryptPinForStorage = encryptPinForStorage;
exports.decryptPinFromStorage = decryptPinFromStorage;
/**
 * AES-GCM encryption for revealable access PINs (CF-only).
 *
 * Production secret (Firebase Functions — never commit):
 *   ACCESS_PIN_ENCRYPTION_KEY — base64 encoding of exactly 32 raw bytes.
 *
 * Local/emulator tests may set process.env.ACCESS_PIN_ENCRYPTION_KEY when the
 * Functions secret is unavailable (test helper only).
 */
const crypto_1 = require("crypto");
const params_1 = require("firebase-functions/params");
exports.accessPinEncryptionKey = (0, params_1.defineSecret)("ACCESS_PIN_ENCRYPTION_KEY");
const KEY_VERSION = 1;
const IV_BYTES = 12;
function decodeKeyMaterial(raw) {
    const trimmed = raw.trim();
    if (!trimmed) {
        throw new Error("ACCESS_PIN_ENCRYPTION_KEY is empty.");
    }
    const key = Buffer.from(trimmed, "base64");
    if (key.byteLength !== 32) {
        throw new Error(`ACCESS_PIN_ENCRYPTION_KEY must decode to 32 bytes (got ${key.byteLength}).`);
    }
    return key;
}
/** Resolve 32-byte key from bound secret or emulator/test env fallback. */
function resolveAccessPinEncryptionKey() {
    let raw;
    try {
        raw = exports.accessPinEncryptionKey.value();
    }
    catch {
        raw = undefined;
    }
    const allowEnvKey = process.env.FUNCTIONS_EMULATOR === "true" ||
        process.env.ACCESS_PIN_ALLOW_ENV_KEY === "1";
    if (!raw?.trim() && allowEnvKey) {
        raw = process.env.ACCESS_PIN_ENCRYPTION_KEY;
    }
    if (!raw?.trim()) {
        throw new Error("ACCESS_PIN_ENCRYPTION_KEY is not configured.");
    }
    return decodeKeyMaterial(raw);
}
function encryptPinForStorage(pin) {
    const key = resolveAccessPinEncryptionKey();
    const iv = (0, crypto_1.randomBytes)(IV_BYTES);
    const cipher = (0, crypto_1.createCipheriv)("aes-256-gcm", key, iv);
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
function decryptPinFromStorage(encrypted) {
    if (encrypted.alg !== "AES-GCM") {
        throw new Error("Unsupported PIN encryption algorithm.");
    }
    const key = resolveAccessPinEncryptionKey();
    const iv = Buffer.from(encrypted.iv, "hex");
    const ciphertext = Buffer.from(encrypted.ciphertext, "hex");
    const tag = Buffer.from(encrypted.tag, "hex");
    const decipher = (0, crypto_1.createDecipheriv)("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plain.toString("utf8");
}
//# sourceMappingURL=accessPinCrypto.js.map