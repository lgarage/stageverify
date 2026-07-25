import type { StagingLocation } from "./dispatcher/models";
import { normalizeStagingCodeKey } from "./dispatcher/stagingCode";

/** Headline on printed sign for the configured catch-all spot (exact casing). */
export const CATCH_ALL_SIGN_HEADLINE = "Catch-All";

/** Dan label-print order: Catch-all → G1–G12 → S1-* → S2-* → … */
export function sortStagingLocationsForLabelPrint(
  locations: StagingLocation[],
  catchAllStagingLocationId: string | undefined,
): StagingLocation[] {
  const catchAllId = catchAllStagingLocationId?.trim() || undefined;
  const copy = [...locations];
  copy.sort((a, b) => compareLabelPrintOrder(a, b, catchAllId));
  return copy;
}

function compareLabelPrintOrder(
  a: StagingLocation,
  b: StagingLocation,
  catchAllId: string | undefined,
): number {
  if (catchAllId) {
    if (a.id === catchAllId && b.id !== catchAllId) return -1;
    if (b.id === catchAllId && a.id !== catchAllId) return 1;
  }

  const rankA = codeSortRank(a.code);
  const rankB = codeSortRank(b.code);
  if (rankA.kind !== rankB.kind) return rankA.kind - rankB.kind;
  if (rankA.primary !== rankB.primary) return rankA.primary - rankB.primary;
  if (rankA.secondary !== rankB.secondary) return rankA.secondary - rankB.secondary;
  return a.code.localeCompare(b.code, undefined, { numeric: true });
}

type CodeSortRank = {
  kind: number;
  primary: number;
  secondary: number;
};

/** kind: 0=ground G, 1=shelf S, 2=other */
function codeSortRank(code: string): CodeSortRank {
  const key = normalizeStagingCodeKey(code);
  const ground = /^G(\d+)$/.exec(key);
  if (ground) {
    return { kind: 0, primary: Number(ground[1]), secondary: 0 };
  }
  const shelf = /^S(\d+)([A-Z])$/.exec(key);
  if (shelf) {
    return {
      kind: 1,
      primary: Number(shelf[1]),
      secondary: shelf[2].charCodeAt(0) - 65,
    };
  }
  return { kind: 2, primary: 0, secondary: 0 };
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
