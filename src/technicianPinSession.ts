const TECHNICIAN_PIN_SESSION_KEY = "stageverify_technician_pin_session";

export interface TechnicianPinSessionRecord {
  technicianId: string;
  technicianName: string;
  sessionToken: string;
  expiresAt: string;
  sessionMinutes: number;
  lastActivityAt: number;
  scannedStagingLocationCode?: string;
}

function readAll(): Record<string, TechnicianPinSessionRecord> {
  try {
    const raw = sessionStorage.getItem(TECHNICIAN_PIN_SESSION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, TechnicianPinSessionRecord>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(data: Record<string, TechnicianPinSessionRecord>): void {
  sessionStorage.setItem(TECHNICIAN_PIN_SESSION_KEY, JSON.stringify(data));
}

export function setTechnicianPinSession(
  technicianId: string,
  technicianName: string,
  opts: {
    sessionToken: string;
    expiresAt: string;
    sessionMinutes: number;
    scannedStagingLocationCode?: string;
  },
): void {
  const all = readAll();
  all[technicianId] = {
    technicianId,
    technicianName,
    sessionToken: opts.sessionToken,
    expiresAt: opts.expiresAt,
    sessionMinutes: opts.sessionMinutes,
    lastActivityAt: Date.now(),
    scannedStagingLocationCode: opts.scannedStagingLocationCode,
  };
  writeAll(all);
}

export function getTechnicianPinSession(
  technicianId: string,
): TechnicianPinSessionRecord | null {
  const record = readAll()[technicianId];
  if (!record) return null;
  if (!isTechnicianPinSessionValid(technicianId)) {
    clearTechnicianPinSession(technicianId);
    return null;
  }
  return record;
}

export function getTechnicianSessionToken(technicianId: string): string | null {
  return getTechnicianPinSession(technicianId)?.sessionToken ?? null;
}

export function isTechnicianPinSessionValid(technicianId: string): boolean {
  const record = readAll()[technicianId];
  if (!record?.sessionToken || !record.expiresAt) return false;
  const expiresMs = Date.parse(record.expiresAt);
  if (!Number.isFinite(expiresMs) || Date.now() >= expiresMs) return false;
  const inactivityMs = record.sessionMinutes * 60 * 1000;
  if (Date.now() - record.lastActivityAt > inactivityMs) return false;
  return true;
}

export function touchTechnicianPinSession(technicianId: string): void {
  const all = readAll();
  const record = all[technicianId];
  if (!record) return;
  all[technicianId] = { ...record, lastActivityAt: Date.now() };
  writeAll(all);
}

export function clearTechnicianPinSession(technicianId: string): void {
  const all = readAll();
  delete all[technicianId];
  writeAll(all);
}

/** Active technician session (most recently touched valid session). */
export function getActiveTechnicianSession(): TechnicianPinSessionRecord | null {
  const all = readAll();
  let best: TechnicianPinSessionRecord | null = null;
  for (const record of Object.values(all)) {
    if (!isTechnicianPinSessionValid(record.technicianId)) continue;
    if (!best || record.lastActivityAt > best.lastActivityAt) {
      best = record;
    }
  }
  return best;
}

export function bindTechnicianSessionToJob(jobId: string): void {
  const active = getActiveTechnicianSession();
  if (!active) return;
  sessionStorage.setItem(
    `stageverify_tech_job_session_${jobId}`,
    active.technicianId,
  );
}

export function getTechnicianSessionForJob(
  jobId: string,
): TechnicianPinSessionRecord | null {
  const techId = sessionStorage.getItem(`stageverify_tech_job_session_${jobId}`);
  if (!techId) return getActiveTechnicianSession();
  return getTechnicianPinSession(techId);
}
