import type { CSSProperties } from "react";
import type {
  DeliveryOrder,
  ShopStockLocationMapping,
  StagingLocation,
} from "../models";
import { getAllStagingLocationIds } from "../models";
import { formatStagingCodeCanonical } from "../stagingCode";
import {
  resolveSpotColor,
  SPOT_MAP_COLORS,
  SPOT_MAP_FG,
  type SpotMapColor,
} from "../resolveSpotColor";
import type { ZoneOccupancySummaryWithReadiness } from "../zoneOccupancyCompute";

export function collectDeliveryStagingCodes(
  delivery: DeliveryOrder,
  locById: Map<string, StagingLocation>,
): string[] {
  const ids = [
    ...new Set([
      ...getAllStagingLocationIds(delivery),
      ...(delivery.plannedStagingLocationIds ?? []),
    ]),
  ];
  /** Reverse index — some legacy rows stored a spot code instead of Firestore doc id. */
  const locByCodeKey = new Map<string, StagingLocation>();
  for (const loc of locById.values()) {
    const key = formatStagingCodeCanonical(loc.code);
    if (key) locByCodeKey.set(key, loc);
  }
  const codes = ids
    .map((rawId) => {
      const id = typeof rawId === "string" ? rawId.trim() : "";
      if (!id) return undefined;
      const byId = locById.get(id);
      if (byId?.code?.trim()) {
        return formatStagingCodeCanonical(byId.code);
      }
      const byCode = locByCodeKey.get(formatStagingCodeCanonical(id));
      if (byCode?.code?.trim()) {
        return formatStagingCodeCanonical(byCode.code);
      }
      return undefined;
    })
    .filter((code): code is string => Boolean(code?.trim()));
  return [...new Set(codes)].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
  );
}

export function stagingSpotChipStyle(
  color: SpotMapColor,
  size: "default" | "compact" = "default",
): CSSProperties {
  const compact = size === "compact";
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: compact ? 20 : 40,
    height: compact ? 16 : 32,
    padding: compact ? "0 4px" : "0 8px",
    borderRadius: 4,
    backgroundColor: SPOT_MAP_COLORS[color],
    color: SPOT_MAP_FG[color],
    border:
      color === "orange" ? "1px solid #ca8a04" : "1px solid rgba(0,0,0,0.15)",
    fontFamily: "monospace",
    fontWeight: 800,
    fontSize: compact ? 10 : 13,
    letterSpacing: "0.02em",
    boxSizing: "border-box",
    flexShrink: 0,
  };
}

type Props = {
  delivery: DeliveryOrder;
  stagingLocations: StagingLocation[];
  occupancyByZoneCode: Record<string, ZoneOccupancySummaryWithReadiness>;
  shopStockByCode: Record<string, ShopStockLocationMapping>;
  occupancyReady: boolean;
  font: string;
  /** Navigate to Staging Map focused on this spot code (e.g. G4). */
  onNavigateToStagingMap?: (spotCode: string) => void;
};

/** Map-matching spot chips for Delivery Basics — colors track live floor map status. */
export function DrawerStagingLocationChips({
  delivery,
  stagingLocations,
  occupancyByZoneCode,
  shopStockByCode,
  occupancyReady,
  font,
  onNavigateToStagingMap,
}: Props) {
  const locById = new Map(stagingLocations.map((loc) => [loc.id, loc]));
  const codes = collectDeliveryStagingCodes(delivery, locById);

  if (codes.length === 0) {
    return (
      <span
        data-testid="delivery-basics-staging-unassigned"
        style={{ color: "var(--admin-text-muted)", fontStyle: "italic", fontFamily: font }}
      >
        Not Assigned
      </span>
    );
  }

  return (
    <div
      data-testid="delivery-basics-staging-codes"
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "flex-end",
        gap: 6,
      }}
    >
      {codes.map((code) => {
        const color: SpotMapColor = occupancyReady
          ? resolveSpotColor(code, occupancyByZoneCode, shopStockByCode)
          : "orange";
        const statusTitle =
          color === "purple"
            ? "Staged — Ready for pickup"
            : color === "orange"
              ? "Assigned / planned"
              : color === "gray"
                ? "Shop stock"
                : "Available";
        const mapTitle = onNavigateToStagingMap
          ? `${statusTitle} — open on Staging Map`
          : statusTitle;
        const sharedProps = {
          "data-testid": `delivery-basics-staging-chip-${code}`,
          "data-spot-color": color,
          title: mapTitle,
        };
        if (onNavigateToStagingMap) {
          return (
            <button
              key={code}
              type="button"
              {...sharedProps}
              aria-label={`View ${code} on Staging Map`}
              onClick={() => onNavigateToStagingMap(code)}
              style={{
                ...stagingSpotChipStyle(color),
                cursor: "pointer",
                fontFamily: "monospace",
              }}
            >
              {code}
            </button>
          );
        }
        return (
          <span key={code} {...sharedProps} style={stagingSpotChipStyle(color)}>
            {code}
          </span>
        );
      })}
    </div>
  );
}
