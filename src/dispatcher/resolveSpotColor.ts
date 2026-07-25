import type { ShopStockLocationMapping } from "./models";
import { normalizeStagingCodeKey } from "./stagingCode";
import type { ZoneOccupancySummaryWithReadiness } from "./zoneOccupancyCompute";

export type SpotMapColor = "green" | "orange" | "purple" | "gray";

export const SPOT_MAP_COLORS: Record<SpotMapColor, string> = {
  green: "#16a34a",
  orange: "#facc15",
  purple: "#7c3aed",
  gray: "#6b7280",
};

/** Foreground text on status-colored fills (assigned/planned uses black on yellow). */
export const SPOT_MAP_FG: Record<SpotMapColor, string> = {
  green: "#ffffff",
  orange: "#111827",
  purple: "#ffffff",
  gray: "#ffffff",
};

/** Catch-all intake spot on Staging Map — light blue fill, navy label (D-42). */
export const CATCH_ALL_SPOT_BG = "#dbeafe";
export const CATCH_ALL_SPOT_FG = "#0a3161";
export const CATCH_ALL_SPOT_BORDER = "#3b82f6";

/**
 * Color priority: purple (ready) > orange (assigned/planned) > gray (shop stock) > green (free).
 */
export function resolveSpotColor(
  code: string,
  occupancyByZoneCode: Record<string, ZoneOccupancySummaryWithReadiness>,
  shopStockByCode: Record<string, ShopStockLocationMapping>,
): SpotMapColor {
  const key = normalizeStagingCodeKey(code);
  const occ = occupancyByZoneCode[key];
  if (occ?.readyForPickup) return "purple";
  if (occ) return "orange";
  if (shopStockByCode[key]) return "gray";
  return "green";
}
