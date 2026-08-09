import type { TechnicianReleasedJobSummary } from "./dispatcher/models";

const CACHE_KEY_PREFIX = "stageverify_tech_released_jobs_";
/** Display-only cache — never used to authorize writes. */
const TTL_MS = 30_000;

export interface ReleasedJobsCacheEntry {
  jobs: TechnicianReleasedJobSummary[];
  technicianName: string;
  releaseDate: string;
  cachedAt: number;
}

export function releasedJobsCacheKey(
  technicianId: string,
  sessionToken: string,
): string {
  return `${technicianId}:${sessionToken}`;
}

function storageKey(technicianId: string, sessionToken: string): string {
  return `${CACHE_KEY_PREFIX}${releasedJobsCacheKey(technicianId, sessionToken)}`;
}

export function readReleasedJobsCache(
  technicianId: string,
  sessionToken: string,
): ReleasedJobsCacheEntry | null {
  try {
    const raw = sessionStorage.getItem(storageKey(technicianId, sessionToken));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ReleasedJobsCacheEntry;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray(parsed.jobs) ||
      typeof parsed.cachedAt !== "number"
    ) {
      return null;
    }
    if (Date.now() - parsed.cachedAt > TTL_MS) {
      sessionStorage.removeItem(storageKey(technicianId, sessionToken));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeReleasedJobsCache(
  technicianId: string,
  sessionToken: string,
  entry: {
    jobs: TechnicianReleasedJobSummary[];
    technicianName: string;
    releaseDate: string;
  },
): void {
  try {
    const payload: ReleasedJobsCacheEntry = {
      ...entry,
      cachedAt: Date.now(),
    };
    sessionStorage.setItem(
      storageKey(technicianId, sessionToken),
      JSON.stringify(payload),
    );
  } catch {
    // sessionStorage full or unavailable — ignore
  }
}

export function clearReleasedJobsCache(
  technicianId: string,
  sessionToken: string,
): void {
  try {
    sessionStorage.removeItem(storageKey(technicianId, sessionToken));
  } catch {
    // ignore
  }
}
