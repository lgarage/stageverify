/** Vendor PIN session — 15 minutes of inactivity before re-prompt. */

export const VENDOR_PIN_SESSION_MS = 15 * 60 * 1000;
const STORAGE_PREFIX = "sv-vendor-pin:";

export interface VendorPinSession {
  deliveryId: string;
  vendorId: string;
  vendorName: string;
  lastActivityAt: number;
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

export function hasPinSession(deliveryId: string): boolean {
  return readRaw(deliveryId) !== null;
}

export function isPinSessionValid(deliveryId: string): boolean {
  const session = readRaw(deliveryId);
  if (!session) return false;
  return Date.now() - session.lastActivityAt < VENDOR_PIN_SESSION_MS;
}

export function getPinSession(deliveryId: string): VendorPinSession | null {
  const session = readRaw(deliveryId);
  if (!session || !isPinSessionValid(deliveryId)) {
    clearPinSession(deliveryId);
    return null;
  }
  return session;
}

export function setPinSession(
  deliveryId: string,
  vendorId: string,
  vendorName: string,
): VendorPinSession {
  const session: VendorPinSession = {
    deliveryId,
    vendorId,
    vendorName,
    lastActivityAt: Date.now(),
  };
  sessionStorage.setItem(storageKey(deliveryId), JSON.stringify(session));
  return session;
}

export function touchPinSession(deliveryId: string): void {
  const session = readRaw(deliveryId);
  if (!session) return;
  session.lastActivityAt = Date.now();
  sessionStorage.setItem(storageKey(deliveryId), JSON.stringify(session));
}

export function clearPinSession(deliveryId: string): void {
  sessionStorage.removeItem(storageKey(deliveryId));
}
