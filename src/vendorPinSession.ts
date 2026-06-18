/** Vendor PIN session — server token + client inactivity tracking. */

export const VENDOR_PIN_SESSION_MS = 15 * 60 * 1000;
const STORAGE_PREFIX = "sv-vendor-pin:";

export interface VendorPinSession {
  deliveryId: string;
  vendorId: string;
  vendorName: string;
  lastActivityAt: number;
  /** Opaque token from verifyVendorPin CF. */
  sessionToken?: string;
  /** ISO expiry from server session doc. */
  expiresAt?: string;
}

function storageKey(deliveryId: string): string {
  return `${STORAGE_PREFIX}${deliveryId}`;
}

function readRaw(deliveryId: string): VendorPinSession | null {
  try {
    const raw = sessionStorage.getItem(storageKey(deliveryId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VendorPinSession;
    if (
      typeof parsed.deliveryId !== "string" ||
      typeof parsed.vendorId !== "string" ||
      typeof parsed.vendorName !== "string" ||
      typeof parsed.lastActivityAt !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function serverSessionExpired(session: VendorPinSession): boolean {
  if (!session.expiresAt) return false;
  const expiresMs = Date.parse(session.expiresAt);
  if (!Number.isFinite(expiresMs)) return true;
  return Date.now() >= expiresMs;
}

function clientInactivityExpired(session: VendorPinSession): boolean {
  return Date.now() - session.lastActivityAt >= VENDOR_PIN_SESSION_MS;
}

export function hasPinSession(deliveryId: string): boolean {
  return readRaw(deliveryId) !== null;
}

export function isPinSessionValid(deliveryId: string): boolean {
  const session = readRaw(deliveryId);
  if (!session) return false;
  if (serverSessionExpired(session) || clientInactivityExpired(session)) {
    clearPinSession(deliveryId);
    return false;
  }
  return true;
}

export function getPinSession(deliveryId: string): VendorPinSession | null {
  const session = readRaw(deliveryId);
  if (!session || !isPinSessionValid(deliveryId)) {
    clearPinSession(deliveryId);
    return null;
  }
  return session;
}

export function getVendorSessionToken(deliveryId: string): string | null {
  const session = getPinSession(deliveryId);
  return session?.sessionToken ?? null;
}

export function setPinSession(
  deliveryId: string,
  vendorId: string,
  vendorName: string,
  serverSession?: { sessionToken: string; expiresAt: string },
): VendorPinSession {
  const session: VendorPinSession = {
    deliveryId,
    vendorId,
    vendorName,
    lastActivityAt: Date.now(),
    sessionToken: serverSession?.sessionToken,
    expiresAt: serverSession?.expiresAt,
  };
  sessionStorage.setItem(storageKey(deliveryId), JSON.stringify(session));
  return session;
}

export function touchPinSession(deliveryId: string): void {
  const session = readRaw(deliveryId);
  if (!session || serverSessionExpired(session)) {
    clearPinSession(deliveryId);
    return;
  }
  session.lastActivityAt = Date.now();
  sessionStorage.setItem(storageKey(deliveryId), JSON.stringify(session));
}

export function clearPinSession(deliveryId: string): void {
  sessionStorage.removeItem(storageKey(deliveryId));
}
