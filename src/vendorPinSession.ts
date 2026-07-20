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
  /** Client inactivity window (minutes) from appSettings at PIN time. */
  sessionMinutes?: number;
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

function serverSessionExpired(session: {
  expiresAt?: string;
}): boolean {
  if (!session.expiresAt) return false;
  const expiresMs = Date.parse(session.expiresAt);
  if (!Number.isFinite(expiresMs)) return true;
  return Date.now() >= expiresMs;
}

function clientInactivityExpired(session: {
  lastActivityAt: number;
  sessionMinutes?: number;
}): boolean {
  const minutes = session.sessionMinutes ?? VENDOR_PIN_SESSION_MS / 60_000;
  return Date.now() - session.lastActivityAt >= minutes * 60_000;
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

const JOB_STORAGE_PREFIX = "sv-job-pin:";

export interface JobPinSession {
  jobId: string;
  vendorId: string;
  vendorName: string;
  lastActivityAt: number;
  sessionToken?: string;
  expiresAt?: string;
  sessionMinutes?: number;
  scannedStagingLocationCode?: string;
}

function jobStorageKey(jobId: string): string {
  return `${JOB_STORAGE_PREFIX}${jobId}`;
}

function readJobRaw(jobId: string): JobPinSession | null {
  try {
    const raw = sessionStorage.getItem(jobStorageKey(jobId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as JobPinSession;
    if (
      typeof parsed.jobId !== "string" ||
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

export function isJobPinSessionValid(jobId: string): boolean {
  const session = readJobRaw(jobId);
  if (!session) return false;
  if (serverSessionExpired(session) || clientInactivityExpired(session)) {
    clearJobPinSession(jobId);
    return false;
  }
  return true;
}

export function getJobPinSession(jobId: string): JobPinSession | null {
  const session = readJobRaw(jobId);
  if (!session || !isJobPinSessionValid(jobId)) {
    clearJobPinSession(jobId);
    return null;
  }
  return session;
}

export function getJobSessionToken(jobId: string): string | null {
  return getJobPinSession(jobId)?.sessionToken ?? null;
}

export function setJobPinSession(
  jobId: string,
  vendorId: string,
  vendorName: string,
  options?: {
    sessionToken?: string;
    expiresAt?: string;
    sessionMinutes?: number;
    scannedStagingLocationCode?: string;
  },
): JobPinSession {
  const session: JobPinSession = {
    jobId,
    vendorId,
    vendorName,
    lastActivityAt: Date.now(),
    sessionToken: options?.sessionToken,
    expiresAt: options?.expiresAt,
    sessionMinutes: options?.sessionMinutes,
    scannedStagingLocationCode: options?.scannedStagingLocationCode,
  };
  sessionStorage.setItem(jobStorageKey(jobId), JSON.stringify(session));
  return session;
}

export function touchJobPinSession(jobId: string): void {
  const session = readJobRaw(jobId);
  if (!session || serverSessionExpired(session)) {
    clearJobPinSession(jobId);
    return;
  }
  session.lastActivityAt = Date.now();
  sessionStorage.setItem(jobStorageKey(jobId), JSON.stringify(session));
}

export function clearJobPinSession(jobId: string): void {
  sessionStorage.removeItem(jobStorageKey(jobId));
}

/** Copy job session token onto a delivery for legacy vendor CF clients. */
export function bridgeJobSessionToDelivery(
  jobId: string,
  deliveryId: string,
): boolean {
  const jobSession = getJobPinSession(jobId);
  if (!jobSession?.sessionToken) return false;
  setPinSession(deliveryId, jobSession.vendorId, jobSession.vendorName, {
    sessionToken: jobSession.sessionToken,
    expiresAt: jobSession.expiresAt,
    sessionMinutes: jobSession.sessionMinutes,
  });
  return true;
}

export function setPinSession(
  deliveryId: string,
  vendorId: string,
  vendorName: string,
  options?: {
    sessionToken?: string;
    expiresAt?: string;
    sessionMinutes?: number;
  },
): VendorPinSession {
  const session: VendorPinSession = {
    deliveryId,
    vendorId,
    vendorName,
    lastActivityAt: Date.now(),
    sessionToken: options?.sessionToken,
    expiresAt: options?.expiresAt,
    sessionMinutes: options?.sessionMinutes,
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

const VENDOR_RUN_STORAGE_PREFIX = "sv-vendor-run-pin:";

export interface VendorRunPinSession {
  vendorId: string;
  vendorName: string;
  anchorDeliveryId: string;
  lastActivityAt: number;
  sessionToken?: string;
  expiresAt?: string;
  sessionMinutes?: number;
  scannedStagingLocationCode?: string;
}

function vendorRunStorageKey(vendorId: string): string {
  return `${VENDOR_RUN_STORAGE_PREFIX}${vendorId}`;
}

function readVendorRunRaw(vendorId: string): VendorRunPinSession | null {
  try {
    const raw = sessionStorage.getItem(vendorRunStorageKey(vendorId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VendorRunPinSession;
    if (
      typeof parsed.vendorId !== "string" ||
      typeof parsed.vendorName !== "string" ||
      typeof parsed.anchorDeliveryId !== "string" ||
      typeof parsed.lastActivityAt !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function isVendorRunPinSessionValid(vendorId: string): boolean {
  const session = readVendorRunRaw(vendorId);
  if (!session) return false;
  if (serverSessionExpired(session) || clientInactivityExpired(session)) {
    clearVendorRunPinSession(vendorId);
    return false;
  }
  return true;
}

export function getVendorRunPinSession(
  vendorId: string,
): VendorRunPinSession | null {
  const session = readVendorRunRaw(vendorId);
  if (!session || !isVendorRunPinSessionValid(vendorId)) {
    clearVendorRunPinSession(vendorId);
    return null;
  }
  return session;
}

export function getVendorRunSessionToken(vendorId: string): string | null {
  return getVendorRunPinSession(vendorId)?.sessionToken ?? null;
}

export function setVendorRunPinSession(
  vendorId: string,
  vendorName: string,
  anchorDeliveryId: string,
  options?: {
    sessionToken?: string;
    expiresAt?: string;
    sessionMinutes?: number;
    scannedStagingLocationCode?: string;
  },
): VendorRunPinSession {
  const session: VendorRunPinSession = {
    vendorId,
    vendorName,
    anchorDeliveryId,
    lastActivityAt: Date.now(),
    sessionToken: options?.sessionToken,
    expiresAt: options?.expiresAt,
    sessionMinutes: options?.sessionMinutes,
    scannedStagingLocationCode: options?.scannedStagingLocationCode,
  };
  sessionStorage.setItem(vendorRunStorageKey(vendorId), JSON.stringify(session));
  return session;
}

export function touchVendorRunPinSession(vendorId: string): void {
  const session = readVendorRunRaw(vendorId);
  if (!session || serverSessionExpired(session)) {
    clearVendorRunPinSession(vendorId);
    return;
  }
  session.lastActivityAt = Date.now();
  sessionStorage.setItem(vendorRunStorageKey(vendorId), JSON.stringify(session));
}

export function clearVendorRunPinSession(vendorId: string): void {
  sessionStorage.removeItem(vendorRunStorageKey(vendorId));
}

/** Bridge vendor-run session token onto a delivery for legacy vendor CF clients. */
export function bridgeVendorRunSessionToDelivery(
  vendorId: string,
  deliveryId: string,
): boolean {
  const runSession = getVendorRunPinSession(vendorId);
  if (!runSession?.sessionToken) return false;
  setPinSession(deliveryId, runSession.vendorId, runSession.vendorName, {
    sessionToken: runSession.sessionToken,
    expiresAt: runSession.expiresAt,
    sessionMinutes: runSession.sessionMinutes,
  });
  return true;
}
