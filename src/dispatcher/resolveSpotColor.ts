import type { ShopStockLocationMapping } from "./models";
import { normalizeStagingCodeKey } from "./stagingCode";
import type { ZoneOccupancySummaryWithReadiness } from "./zoneOccupancyCompute";

export type SpotMapColor = "green" | "orange" | "red" | "gray";

export const SPOT_MAP_COLORS: Record<SpotMapColor, string> = {
  green: "#16a34a",
  orange: "#facc15",
  red: "#dc2626",
  gray: "#6b7280",
};

/** Foreground text on status-colored fills (assigned/planned uses black on yellow). */
export const SPOT_MAP_FG: Record<SpotMapColor, string> = {
  green: "#ffffff",
  orange: "#111827",
  red: "#ffffff",
  gray: "#ffffff",
};

/**
 * Color priority: red (ready) > orange (assigned/planned) > gray (shop stock) > green (free).
 */
export function resolveSpotColor(
  code: string,
  occupancyByZoneCode: Record<string, ZoneOccupancySummaryWithReadiness>,
  shopStockByCode: Record<string, ShopStockLocationMapping>,
): SpotMapColor {
  const key = normalizeStagingCodeKey(code);
  const occ = occupancyByZoneCode[key];
  if (occ?.readyForPickup) return "red";
  if (occ) return "orange";
  if (shopStockByCode[key]) return "gray";
  return "green";
}
