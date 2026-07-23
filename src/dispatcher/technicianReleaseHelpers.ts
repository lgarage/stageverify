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

export interface ReleasedToEntry {
  technicianId: string;
  name: string;
}

/** jobId → released technicians for that day (sorted by name). */
export function buildJobReleasedToEntries(
  releases: TechnicianDayRelease[],
  technicians: Technician[],
): Map<string, ReleasedToEntry[]> {
  const techById = new Map(technicians.map((t) => [t.id, t]));
  const jobToEntries = new Map<string, ReleasedToEntry[]>();

  for (const release of releases) {
    const tech = techById.get(release.technicianId);
    const name = tech?.name ?? release.technicianId;
    for (const jobId of release.jobIds ?? []) {
      const list = jobToEntries.get(jobId) ?? [];
      if (!list.some((e) => e.technicianId === release.technicianId)) {
        list.push({ technicianId: release.technicianId, name });
      }
      jobToEntries.set(jobId, list);
    }
  }

  const result = new Map<string, ReleasedToEntry[]>();
  for (const [jobId, entries] of jobToEntries) {
    result.set(
      jobId,
      [...entries].sort((a, b) => a.name.localeCompare(b.name)),
    );
  }
  return result;
}

/** jobId → comma-separated technician names released for that day. */
export function buildJobReleasedToMap(
  releases: TechnicianDayRelease[],
  technicians: Technician[],
): Map<string, string> {
  const entries = buildJobReleasedToEntries(releases, technicians);
  const result = new Map<string, string>();
  for (const [jobId, list] of entries) {
    result.set(jobId, list.map((e) => e.name).join(", "));
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

export async function loadTodayJobReleasedToEntries(
  technicians: Technician[],
): Promise<Map<string, ReleasedToEntry[]>> {
  const releaseDate = todayReleaseDateUtc();
  const releases = await listTechnicianDayReleasesForDate(releaseDate);
  return buildJobReleasedToEntries(releases, technicians);
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

/** Move today's release from previous tech(s) to a new technician. */
export async function reassignJobToTechnicianForToday(
  jobId: string,
  newTechnicianId: string,
  previousTechnicianIds: string[],
): Promise<{ releaseDate: string; jobIds: string[] }> {
  const releaseDate = todayReleaseDateUtc();
  const releases = await listTechnicianDayReleasesForDate(releaseDate);

  for (const techId of previousTechnicianIds) {
    const release = releases.find((r) => r.technicianId === techId);
    const currentJobIds = release?.jobIds ?? [];
    const nextJobIds = currentJobIds.filter((id) => id !== jobId);
    await releaseJobsToTechnicianClient({
      technicianId: techId,
      jobIds: nextJobIds,
      releaseDate,
      replace: true,
    });
  }

  return releaseJobToTechnicianForToday(newTechnicianId, jobId);
}

/** Names of techs with this job in today's release list. */
export function releasedTechnicianNamesForJob(
  jobId: string,
  releases: TechnicianDayRelease[],
  technicians: Technician[],
): string {
  return buildJobReleasedToMap(releases, technicians).get(jobId) ?? "";
}
