import type { Technician, TechnicianDayRelease } from "./models";
import {
  listTechnicianDayReleasesForDate,
} from "./firestoreService";
import { releaseJobsToTechnicianClient } from "../phase2CallableClients";

/** UTC date YYYY-MM-DD — matches CF `todayReleaseDateUtc`. */
export function todayReleaseDateUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function technicianCanUseDoor(tech: Technician): boolean {
  return tech.active !== false && tech.permissions?.doorScan !== false;
}

export function technicianCanReceiveReleases(tech: Technician): boolean {
  return tech.active !== false && tech.permissions?.receiveReleases !== false;
}

/** jobId → comma-separated technician names released for that day. */
export function buildJobReleasedToMap(
  releases: TechnicianDayRelease[],
  technicians: Technician[],
): Map<string, string> {
  const techById = new Map(technicians.map((t) => [t.id, t.name]));
  const jobToNames = new Map<string, string[]>();

  for (const release of releases) {
    const name = techById.get(release.technicianId) ?? release.technicianId;
    for (const jobId of release.jobIds ?? []) {
      const list = jobToNames.get(jobId) ?? [];
      if (!list.includes(name)) list.push(name);
      jobToNames.set(jobId, list);
    }
  }

  const result = new Map<string, string>();
  for (const [jobId, names] of jobToNames) {
    result.set(jobId, [...names].sort((a, b) => a.localeCompare(b)).join(", "));
  }
  return result;
}

export async function loadTodayJobReleasedToMap(
  technicians: Technician[],
): Promise<Map<string, string>> {
  const releaseDate = todayReleaseDateUtc();
  const releases = await listTechnicianDayReleasesForDate(releaseDate);
  return buildJobReleasedToMap(releases, technicians);
}

/** Merge job into technician's day-release doc (CF unions by default). */
export async function releaseJobToTechnicianForToday(
  technicianId: string,
  jobId: string,
): Promise<{ releaseDate: string; jobIds: string[] }> {
  const releaseDate = todayReleaseDateUtc();
  const result = await releaseJobsToTechnicianClient({
    technicianId,
    jobIds: [jobId],
    releaseDate,
  });
  return result;
}

/** Names of techs with this job in today's release list. */
export function releasedTechnicianNamesForJob(
  jobId: string,
  releases: TechnicianDayRelease[],
  technicians: Technician[],
): string {
  return buildJobReleasedToMap(releases, technicians).get(jobId) ?? "";
}
