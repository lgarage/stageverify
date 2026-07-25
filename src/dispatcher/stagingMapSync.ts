import type { StagingLocation } from "./models";
import { normalizeStagingCodeKey } from "./stagingCode";
import {
  allShopMapSpotCodes,
  CATCH_ALL_ZONE_CODE,
  normalizeShopMapLayoutExtras,
  resolveCatchAllMarker,
  resolveShopMapLayout,
  type ShopMapLayoutExtras,
} from "./shopMapLayout";

/** Layout slot keys currently rendered on the Staging Map (ground + shelf chips + catch-all when persisted). */
export function visibleShopMapLayoutSlotKeys(
  extras?: ShopMapLayoutExtras | null,
): string[] {
  const normalized = normalizeShopMapLayoutExtras(extras);
  const layout = resolveShopMapLayout(normalized);
  const slots = [...allShopMapSpotCodes(layout)];
  if (resolveCatchAllMarker(normalized)) {
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

/** Settings staging list = one row per map slot that has a matching zone (map is SSOT for membership). */
export function filterStagingLocationsOnShopMap(
  zones: StagingLocation[],
  extras?: ShopMapLayoutExtras | null,
): StagingLocation[] {
  const seen = new Set<string>();
  const result: StagingLocation[] = [];
  for (const slot of visibleShopMapLayoutSlotKeys(extras)) {
    const zone = zoneForMapLayoutSlot(zones, slot);
    if (zone && !seen.has(zone.id)) {
      seen.add(zone.id);
      result.push(zone);
    }
  }
  return result;
}
