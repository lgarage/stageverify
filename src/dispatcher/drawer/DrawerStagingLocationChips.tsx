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

function collectDeliveryStagingCodes(
  delivery: DeliveryOrder,
  locById: Map<string, StagingLocation>,
): string[] {
  const ids = [
    ...new Set([
      ...getAllStagingLocationIds(delivery),
      ...(delivery.plannedStagingLocationIds ?? []),
    ]),
  ];
  const codes = ids
    .map((id) => locById.get(id)?.code)
    .filter((code): code is string => Boolean(code?.trim()))
    .map((code) => formatStagingCodeCanonical(code));
  return [...new Set(codes)].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
  );
}

function chipStyle(color: SpotMapColor): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 40,
    height: 32,
    padding: "0 8px",
    borderRadius: 4,
    backgroundColor: SPOT_MAP_COLORS[color],
    color: SPOT_MAP_FG[color],
    border:
      color === "orange" ? "1px solid #ca8a04" : "1px solid rgba(0,0,0,0.15)",
    fontFamily: "monospace",
    fontWeight: 800,
    fontSize: 13,
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
};

/** Map-matching spot chips for Delivery Basics — colors track live floor map status. */
export function DrawerStagingLocationChips({
  delivery,
  stagingLocations,
  occupancyByZoneCode,
  shopStockByCode,
  occupancyReady,
  font,
}: Props) {
  const locById = new Map(stagingLocations.map((loc) => [loc.id, loc]));
  const codes = collectDeliveryStagingCodes(delivery, locById);

  if (codes.length === 0) {
    return (
      <span
        data-testid="delivery-basics-staging-unassigned"
        style={{ color: "#9ca3af", fontStyle: "italic", fontFamily: font }}
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
        return (
          <span
            key={code}
            data-testid={`delivery-basics-staging-chip-${code}`}
            data-spot-color={color}
            style={chipStyle(color)}
            title={
              color === "red"
                ? "Ready for pickup"
                : color === "orange"
                  ? "Assigned / planned"
                  : color === "gray"
                    ? "Shop stock"
                    : "Available"
            }
          >
            {code}
          </span>
        );
      })}
    </div>
  );
}
