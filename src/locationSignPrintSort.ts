import type { StagingLocation } from "./dispatcher/models";
import {
  sortStagingLocationsForList,
} from "./dispatcher/stagingMapSync";

/** Headline on printed sign for the configured catch-all spot (exact casing). */
export const CATCH_ALL_SIGN_HEADLINE = "Catch-All";

/** Dan label-print order — SSOT in stagingMapSync (D-53). */
export function sortStagingLocationsForLabelPrint(
  locations: StagingLocation[],
  catchAllStagingLocationId: string | undefined,
): StagingLocation[] {
  return sortStagingLocationsForList(locations, {
    catchAllStagingLocationId,
  });
}

/** Active spots plus configured catch-all (even if inactive). Dedupes by id. */
export function buildLabelPrintCandidates(
  allZones: StagingLocation[],
  catchAllStagingLocationId: string | undefined,
  isActive: (loc: StagingLocation) => boolean,
): StagingLocation[] {
  const catchAllId = catchAllStagingLocationId?.trim() || undefined;
  const byId = new Map<string, StagingLocation>();

  for (const zone of allZones) {
    if (isActive(zone)) {
      byId.set(zone.id, zone);
    }
  }

  if (catchAllId) {
    const catchAllZone = allZones.find((z) => z.id === catchAllId);
    if (catchAllZone && !byId.has(catchAllId)) {
      byId.set(catchAllId, catchAllZone);
    }
  }

  return sortStagingLocationsForLabelPrint([...byId.values()], catchAllId);
}

export function isCatchAllLabelRow(
  zone: StagingLocation,
  catchAllStagingLocationId: string | undefined,
): boolean {
  const catchAllId = catchAllStagingLocationId?.trim();
  return Boolean(catchAllId && zone.id === catchAllId);
}
