import type { ManagementPinPermissions } from "./dispatcher/models";

const MANAGEMENT_PIN_SESSION_KEY = "stageverify_management_pin_session";

export type NormalizedManagementPinPermissions =
  Required<ManagementPinPermissions>;

export function normalizeManagementPinPermissions(
  permissions?: ManagementPinPermissions | null,
): NormalizedManagementPinPermissions {
  return {
    enterPortalAnyQr: permissions?.enterPortalAnyQr !== false,
    catchAllCheckIn: permissions?.catchAllCheckIn !== false,
    viewWaitingParts: permissions?.viewWaitingParts !== false,
    markOrFlagParcel: permissions?.markOrFlagParcel !== false,
  };
}

export interface ManagementPinSessionRecord {
  sessionToken: string;
  expiresAt: string;
  sessionMinutes: number;
  lastActivityAt: number;
  scannedStagingLocationCode?: string;
  pinId?: string;
  /** UX cache — CF re-reads registry for enforcement. */
  permissions?: NormalizedManagementPinPermissions;
}

function readRecord(): ManagementPinSessionRecord | null {
  try {
    const raw = sessionStorage.getItem(MANAGEMENT_PIN_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ManagementPinSessionRecord;
    return parsed?.sessionToken ? parsed : null;
  } catch {
    return null;
  }
}

function writeRecord(record: ManagementPinSessionRecord | null): void {
  if (!record) {
    sessionStorage.removeItem(MANAGEMENT_PIN_SESSION_KEY);
    return;
  }
  sessionStorage.setItem(MANAGEMENT_PIN_SESSION_KEY, JSON.stringify(record));
}

export function setManagementPinSession(opts: {
  sessionToken: string;
  expiresAt: string;
  sessionMinutes: number;
  scannedStagingLocationCode?: string;
  pinId?: string;
  permissions?: ManagementPinPermissions;
}): void {
  writeRecord({
    sessionToken: opts.sessionToken,
    expiresAt: opts.expiresAt,
    sessionMinutes: opts.sessionMinutes,
    lastActivityAt: Date.now(),
    scannedStagingLocationCode: opts.scannedStagingLocationCode,
    pinId: opts.pinId,
    permissions: normalizeManagementPinPermissions(opts.permissions),
  });
}

export function getManagementPinSession(): ManagementPinSessionRecord | null {
  const record = readRecord();
  if (!record) return null;
  if (!isManagementPinSessionValid()) {
    clearManagementPinSession();
    return null;
  }
  return record;
}

export function getManagementSessionToken(): string | null {
  return getManagementPinSession()?.sessionToken ?? null;
}

export function getManagementSessionPermissions(): NormalizedManagementPinPermissions | null {
  const session = getManagementPinSession();
  if (!session) return null;
  return normalizeManagementPinPermissions(session.permissions);
}

export function isManagementPinSessionValid(): boolean {
  const record = readRecord();
  if (!record?.sessionToken || !record.expiresAt) return false;
  const expiresMs = Date.parse(record.expiresAt);
  if (!Number.isFinite(expiresMs) || Date.now() >= expiresMs) return false;
  const inactivityMs = record.sessionMinutes * 60 * 1000;
  if (Date.now() - record.lastActivityAt > inactivityMs) return false;
  return true;
}

export function touchManagementPinSession(): void {
  const record = readRecord();
  if (!record) return;
  writeRecord({ ...record, lastActivityAt: Date.now() });
}

export function clearManagementPinSession(): void {
  writeRecord(null);
}
