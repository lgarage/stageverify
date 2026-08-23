import { isLocationActive, type StagingLocation } from "./models";
import {
  isMapSlotPlaceholderStagingLocation,
} from "./stagingMapSync";
import { formatStagingCodeCanonical, normalizeStagingCodeKey } from "./stagingCode";

function layoutKeysForZone(zone: StagingLocation): string[] {
  const keys = new Set<string>();
  const codeKey = normalizeStagingCodeKey(zone.code ?? "");
  if (codeKey) keys.add(codeKey);
  const slot = zone.mapLayoutSlot?.trim();
  if (slot) {
    const slotKey = normalizeStagingCodeKey(slot);
    if (slotKey) keys.add(slotKey);
  }
  return [...keys];
}

function rankZoneForKey(zone: StagingLocation, key: string): number {
  const slotKey = zone.mapLayoutSlot
    ? normalizeStagingCodeKey(zone.mapLayoutSlot)
    : "";
  const codeKey = normalizeStagingCodeKey(zone.code ?? "");
  const activeBonus = isLocationActive(zone) ? 20 : 0;
  if (slotKey === key) return 10 + activeBonus;
  if (codeKey === key) return 5 + activeBonus;
  return activeBonus;
}

function preferZone(
  current: StagingLocation | undefined,
  candidate: StagingLocation,
  key: string,
): StagingLocation {
  if (!current) return candidate;
  if (isMapSlotPlaceholderStagingLocation(current)) return candidate;
  if (isMapSlotPlaceholderStagingLocation(candidate)) return current;
  return rankZoneForKey(candidate, key) > rankZoneForKey(current, key)
    ? candidate
    : current;
}

/** Authoritative staging-location docs only — never map-slot placeholders. */
export function realStagingLocations(
  zones: StagingLocation[],
): StagingLocation[] {
  return zones.filter(
    (zone) => zone.id && !isMapSlotPlaceholderStagingLocation(zone),
  );
}

/**
 * Index layout/code keys → preferred Firestore staging location.
 * Active + mapLayoutSlot match wins over code-only or inactive duplicates.
 */
export function indexZonesByLayoutKey(
  zones: StagingLocation[],
): Record<string, StagingLocation> {
  const index: Record<string, StagingLocation> = {};
  for (const zone of realStagingLocations(zones)) {
    for (const key of layoutKeysForZone(zone)) {
      index[key] = preferZone(index[key], zone, key);
    }
  }
  return index;
}

/**
 * Resolve a visible map layout slot (G2, S1L, S1-L) to the canonical
 * stagingLocations document used by approve/reassign writes.
 */
export function resolveStagingLocationForLayoutSlot(
  zones: StagingLocation[],
  layoutSlot: string,
): StagingLocation | undefined {
  const key = normalizeStagingCodeKey(layoutSlot);
  if (!key) return undefined;
  const indexed = indexZonesByLayoutKey(zones)[key];
  if (indexed) return indexed;
  const canonicalKey = normalizeStagingCodeKey(
    formatStagingCodeCanonical(layoutSlot),
  );
  if (canonicalKey && canonicalKey !== key) {
    return indexZonesByLayoutKey(zones)[canonicalKey];
  }
  return undefined;
}
