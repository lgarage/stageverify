import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { hashPinForStorage } from "../../pinHashing";
import { pinMatches } from "../../pinMatching";

export const ADMIN_SECRETS_COLLECTION = "invoiceTrainingAdminSecrets";
export const ADMIN_SECRETS_DOC = "config";
export const MIN_ADMIN_PASSWORD_LEN = 8;
export const MAX_ADMIN_PASSWORD_LEN = 128;

function getDb() {
  return admin.firestore();
}

export function asAlertEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

export function asAdminPassword(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length < MIN_ADMIN_PASSWORD_LEN) return null;
  if (value.length > MAX_ADMIN_PASSWORD_LEN) return null;
  return value;
}

type AdminSecretsDoc = {
  passwordHash?: string;
  alertEmail?: string;
  failedAttempts?: number;
  lockUntilMs?: number;
};

async function readAdminSecrets(): Promise<AdminSecretsDoc> {
  const snap = await getDb()
    .collection(ADMIN_SECRETS_COLLECTION)
    .doc(ADMIN_SECRETS_DOC)
    .get();
  return (snap.data() as AdminSecretsDoc | undefined) ?? {};
}

/** Alert email lives in CF-only secrets — never public appSettings. */
export async function readAlertEmailFromSecrets(): Promise<string | null> {
  const secrets = await readAdminSecrets();
  return asAlertEmail(secrets.alertEmail);
}

export async function isAdminPasswordConfigured(): Promise<boolean> {
  const secrets = await readAdminSecrets();
  return typeof secrets.passwordHash === "string" && secrets.passwordHash.includes(":");
}

export async function isAdminFullyConfigured(): Promise<{
  alertEmailConfigured: boolean;
  passwordConfigured: boolean;
  alertEmail: string | null;
}> {
  const alertEmail = await readAlertEmailFromSecrets();
  const passwordConfigured = await isAdminPasswordConfigured();
  return {
    alertEmailConfigured: Boolean(alertEmail),
    passwordConfigured,
    alertEmail,
  };
}

export async function storeAdminConfig(input: {
  alertEmail: string;
  password: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const passwordHash = hashPinForStorage(input.password);
  await getDb()
    .collection(ADMIN_SECRETS_COLLECTION)
    .doc(ADMIN_SECRETS_DOC)
    .set(
      {
        passwordHash,
        alertEmail: input.alertEmail,
        failedAttempts: 0,
        lockUntilMs: 0,
        updatedAt: now,
      },
      { merge: true },
    );
  await getDb()
    .collection("appSettings")
    .doc("config")
    .set(
      {
        invoiceTrainingAdminPasswordConfigured: true,
        invoiceTrainingAlertEmailConfigured: true,
        // Never keep plaintext alert email on public-readable appSettings.
        invoiceTrainingAlertEmail: FieldValue.delete(),
        updatedAt: now,
      },
      { merge: true },
    );
}

const MAX_ADMIN_PASSWORD_ATTEMPTS = 8;
const ADMIN_LOCK_MS = 15 * 60 * 1000;

export class AdminPasswordLockedError extends Error {
  constructor() {
    super("Admin password locked after too many attempts. Try again in 15 minutes.");
    this.name = "AdminPasswordLockedError";
  }
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  const secrets = await readAdminSecrets();
  const nowMs = Date.now();
  if (typeof secrets.lockUntilMs === "number" && secrets.lockUntilMs > nowMs) {
    throw new AdminPasswordLockedError();
  }
  const passwordHash = secrets.passwordHash;
  if (!passwordHash) return false;
  const ok = pinMatches({ pinHash: passwordHash }, password);
  if (ok) {
    await getDb()
      .collection(ADMIN_SECRETS_COLLECTION)
      .doc(ADMIN_SECRETS_DOC)
      .set({ failedAttempts: 0, lockUntilMs: 0 }, { merge: true });
    return true;
  }
  const failed = (secrets.failedAttempts ?? 0) + 1;
  const patch: AdminSecretsDoc = { failedAttempts: failed };
  if (failed >= MAX_ADMIN_PASSWORD_ATTEMPTS) {
    patch.lockUntilMs = nowMs + ADMIN_LOCK_MS;
    patch.failedAttempts = 0;
  }
  await getDb()
    .collection(ADMIN_SECRETS_COLLECTION)
    .doc(ADMIN_SECRETS_DOC)
    .set(patch, { merge: true });
  return false;
}

export function vendorKeyFromImportDoc(importDoc: {
  detectedVendorName?: string;
  parserFormatId?: string;
}): string {
  if (
    typeof importDoc.detectedVendorName === "string" &&
    importDoc.detectedVendorName.trim()
  ) {
    return importDoc.detectedVendorName.trim();
  }
  if (importDoc.parserFormatId === "johnstone") return "johnstone";
  return "unknown-vendor";
}
