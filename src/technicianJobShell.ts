/** Lightweight job preview stashed before pickup navigation — display only, not authoritative. */

const SHELL_KEY_PREFIX = "stageverify_tech_job_shell_";
const SHELL_TTL_MS = 5 * 60_000;

export interface TechnicianJobShell {
  jobId: string;
  jobName: string;
  stagingLocationCodes: string[];
  deliveryCount: number;
  readyForPickupCount: number;
  stashedAt: number;
}

function storageKey(jobId: string): string {
  return `${SHELL_KEY_PREFIX}${jobId}`;
}

export function stashTechnicianJobShell(
  shell: Omit<TechnicianJobShell, "stashedAt">,
): void {
  try {
    const payload: TechnicianJobShell = {
      ...shell,
      stashedAt: Date.now(),
    };
    sessionStorage.setItem(storageKey(shell.jobId), JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export function readTechnicianJobShell(jobId: string): TechnicianJobShell | null {
  try {
    const raw = sessionStorage.getItem(storageKey(jobId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TechnicianJobShell;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.jobId !== jobId ||
      typeof parsed.stashedAt !== "number"
    ) {
      return null;
    }
    if (Date.now() - parsed.stashedAt > SHELL_TTL_MS) {
      sessionStorage.removeItem(storageKey(jobId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearTechnicianJobShell(jobId: string): void {
  try {
    sessionStorage.removeItem(storageKey(jobId));
  } catch {
    // ignore
  }
}
