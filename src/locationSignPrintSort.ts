import type { StagingLocation } from "./dispatcher/models";
import { normalizeStagingCodeKey } from "./dispatcher/stagingCode";
import {
  filterStagingLocationsOnShopMap,
  sortStagingLocationsForList,
} from "./dispatcher/stagingMapSync";
import {
  CATCH_ALL_ZONE_CODE,
  type ShopMapLayoutExtras,
} from "./dispatcher/shopMapLayout";

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

/** Visible Staging Map slots only (D-52/D-53) — same membership as Settings staging list. */
export function buildLabelPrintCandidates(
  allZones: StagingLocation[],
  catchAllStagingLocationId: string | undefined,
  mapLayoutExtras?: ShopMapLayoutExtras | null,
): StagingLocation[] {
  const catchAllId = catchAllStagingLocationId?.trim() || undefined;
  const mapSpots = filterStagingLocationsOnShopMap(
    allZones,
    mapLayoutExtras ?? {},
  );
  return sortStagingLocationsForLabelPrint(mapSpots, catchAllId);
}

export function isCatchAllLabelRow(
  zone: StagingLocation,
  catchAllStagingLocationId: string | undefined,
): boolean {
  const catchAllId = catchAllStagingLocationId?.trim();
  if (catchAllId && zone.id === catchAllId) return true;
  const slotKey = normalizeStagingCodeKey(zone.mapLayoutSlot ?? zone.code);
  return slotKey === normalizeStagingCodeKey(CATCH_ALL_ZONE_CODE);
}
