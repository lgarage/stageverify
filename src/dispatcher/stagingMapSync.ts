import type { StagingLocation } from "./models";
import { formatStagingCodeCanonical, normalizeStagingCodeKey } from "./stagingCode";
import {
  allShopMapSpotCodes,
  CATCH_ALL_ZONE_CODE,
  defaultLabelForSpotCode,
  inferSpotZoneType,
  normalizeShopMapLayoutExtras,
  resolveCatchAllMarker,
  resolveShopMapLayout,
  type ShopMapLayoutExtras,
} from "./shopMapLayout";

/** Prefix for Settings rows backed by a map slot without a Firestore zone doc yet. */
export const MAP_SLOT_PLACEHOLDER_ID_PREFIX = "map-slot:";

/** Layout slot keys currently rendered on the Staging Map (ground + shelf chips + catch-all when persisted). */
export function visibleShopMapLayoutSlotKeys(
  extras?: ShopMapLayoutExtras | null,
  zones?: StagingLocation[],
): string[] {
  const normalized = normalizeShopMapLayoutExtras(extras);
  const layout = resolveShopMapLayout(normalized);
  const slots = [...allShopMapSpotCodes(layout)];
  const marker = resolveCatchAllMarker(normalized);
  if (
    marker &&
    (!zones || zoneForMapLayoutSlot(zones, CATCH_ALL_ZONE_CODE) !== undefined)
  ) {
    slots.push(CATCH_ALL_ZONE_CODE);
  }
  return slots;
}

export function zoneForMapLayoutSlot(
  zones: StagingLocation[],
  layoutSlot: string,
): StagingLocation | undefined {
  const key = normalizeStagingCodeKey(layoutSlot);
  return zones.find((z) => {
    const slotKey = normalizeStagingCodeKey(z.mapLayoutSlot ?? z.code);
    const codeKey = normalizeStagingCodeKey(z.code);
    return slotKey === key || codeKey === key;
  });
}

export function mapSlotPlaceholderId(layoutSlot: string): string {
  return `${MAP_SLOT_PLACEHOLDER_ID_PREFIX}${normalizeStagingCodeKey(layoutSlot)}`;
}

export function isMapSlotPlaceholderStagingLocation(
  loc: StagingLocation,
): boolean {
  return loc.id.startsWith(MAP_SLOT_PLACEHOLDER_ID_PREFIX);
}

function labelForMapLayoutSlot(layoutSlot: string): string {
  if (
    normalizeStagingCodeKey(layoutSlot) ===
    normalizeStagingCodeKey(CATCH_ALL_ZONE_CODE)
  ) {
    return "Catch-all";
  }
  return defaultLabelForSpotCode(layoutSlot);
}

function typeForMapLayoutSlot(layoutSlot: string): StagingLocation["type"] {
  if (
    normalizeStagingCodeKey(layoutSlot) ===
    normalizeStagingCodeKey(CATCH_ALL_ZONE_CODE)
  ) {
    return "other";
  }
  return inferSpotZoneType(formatStagingCodeCanonical(layoutSlot));
}

/** Row for a visible map slot when no zone doc exists yet (map is SSOT for membership). */
export function placeholderStagingLocationForMapSlot(
  layoutSlot: string,
): StagingLocation {
  const mapLayoutSlot = formatStagingCodeCanonical(layoutSlot);
  const code =
    normalizeStagingCodeKey(layoutSlot) ===
    normalizeStagingCodeKey(CATCH_ALL_ZONE_CODE)
      ? CATCH_ALL_ZONE_CODE
      : mapLayoutSlot;
  return {
    id: mapSlotPlaceholderId(layoutSlot),
    code,
    label: labelForMapLayoutSlot(layoutSlot),
    type: typeForMapLayoutSlot(layoutSlot),
    status: "Planned",
    mapLayoutSlot,
  };
}

export type StagingMapListRow = {
  /** Map layout slot key (authoritative row identity). */
  layoutSlot: string;
  spot: StagingLocation;
};

/** Settings staging list = one row per visible map slot; zone docs hydrate metadata when present. */
export function stagingListRowsForShopMap(
  zones: StagingLocation[],
  extras?: ShopMapLayoutExtras | null,
): StagingMapListRow[] {
  const result: StagingMapListRow[] = [];
  const usedZoneIds = new Set<string>();
  for (const layoutSlot of visibleShopMapLayoutSlotKeys(extras, zones)) {
    const zone = zoneForMapLayoutSlot(zones, layoutSlot);
    let spot: StagingLocation;
    if (zone && !usedZoneIds.has(zone.id)) {
      usedZoneIds.add(zone.id);
      spot = {
        ...zone,
        mapLayoutSlot: formatStagingCodeCanonical(layoutSlot),
      };
    } else {
      spot = placeholderStagingLocationForMapSlot(layoutSlot);
    }
    result.push({ layoutSlot, spot });
  }
  return result;
}

/** @deprecated Prefer stagingListRowsForShopMap — spots-only list (unique by map slot). */
export function filterStagingLocationsOnShopMap(
  zones: StagingLocation[],
  extras?: ShopMapLayoutExtras | null,
): StagingLocation[] {
  return stagingListRowsForShopMap(zones, extras).map((row) => row.spot);
}
