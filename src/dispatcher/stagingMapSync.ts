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

/** D-53 — kind: -1=catch-all, 0=ground G*, 1=shelf S*, 2=other */
type LayoutSlotSortRank = {
  kind: number;
  primary: number;
  secondary: number;
};

function layoutSlotSortRank(layoutSlot: string): LayoutSlotSortRank {
  const key = normalizeStagingCodeKey(layoutSlot);
  if (key === normalizeStagingCodeKey(CATCH_ALL_ZONE_CODE)) {
    return { kind: -1, primary: 0, secondary: 0 };
  }
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

/**
 * SSOT display order for map layout slots (D-53): Catch-all → G1… → S1-* … S2-* …
 * @see PROJECT_STATUS/DECISIONS.md D-53
 */
export function compareStagingMapLayoutSlots(a: string, b: string): number {
  const rankA = layoutSlotSortRank(a);
  const rankB = layoutSlotSortRank(b);
  if (rankA.kind !== rankB.kind) return rankA.kind - rankB.kind;
  if (rankA.primary !== rankB.primary) return rankA.primary - rankB.primary;
  if (rankA.secondary !== rankB.secondary) return rankA.secondary - rankB.secondary;
  return formatStagingCodeCanonical(a).localeCompare(
    formatStagingCodeCanonical(b),
    undefined,
    { numeric: true },
  );
}

export type StagingLocationListSortOptions = {
  /** Configured catch-all zone id — that row sorts first when set (label-print picker). */
  catchAllStagingLocationId?: string;
};

/**
 * SSOT display order for staging location rows (D-53).
 * Catch-all first (by configured id and/or CA layout slot), then ground, then shelf.
 */
export function compareStagingLocationsForList(
  a: StagingLocation,
  b: StagingLocation,
  options?: StagingLocationListSortOptions,
): number {
  const catchAllId = options?.catchAllStagingLocationId?.trim();
  if (catchAllId) {
    if (a.id === catchAllId && b.id !== catchAllId) return -1;
    if (b.id === catchAllId && a.id !== catchAllId) return 1;
  }
  const slotA = a.mapLayoutSlot ?? a.code;
  const slotB = b.mapLayoutSlot ?? b.code;
  return compareStagingMapLayoutSlots(slotA, slotB);
}

export function sortStagingMapListRows(rows: StagingMapListRow[]): StagingMapListRow[] {
  return [...rows].sort((a, b) =>
    compareStagingMapLayoutSlots(a.layoutSlot, b.layoutSlot),
  );
}

export function sortStagingLocationsForList(
  locations: StagingLocation[],
  options?: StagingLocationListSortOptions,
): StagingLocation[] {
  return [...locations].sort((a, b) =>
    compareStagingLocationsForList(a, b, options),
  );
}

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
  return sortStagingMapListRows(result);
}

/** @deprecated Prefer stagingListRowsForShopMap — spots-only list (unique by map slot). */
export function filterStagingLocationsOnShopMap(
  zones: StagingLocation[],
  extras?: ShopMapLayoutExtras | null,
): StagingLocation[] {
  return stagingListRowsForShopMap(zones, extras).map((row) => row.spot);
}
