import type { ShopStockLocationMapping } from "./models";
import {
  resolveSpotColor,
  type SpotMapColor,
} from "./resolveSpotColor";
import { stagingSpotChipStyle } from "./drawer/DrawerStagingLocationChips";
import type { ZoneOccupancySummaryWithReadiness } from "./zoneOccupancyCompute";

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

/** List table: never show green (available) — treat as assigned/planned orange. */
export function listDisplaySpotColor(color: SpotMapColor): SpotMapColor {
  return color === "green" ? "orange" : color;
}

type Props = {
  codes: string[];
  occupancyByZoneCode: Record<string, ZoneOccupancySummaryWithReadiness>;
  shopStockByCode: Record<string, ShopStockLocationMapping>;
  occupancyReady: boolean;
  deliveryId: string;
  /** Will-Call vendor pickup — shop staging not used. */
  stagingNotApplicable?: boolean;
  /**
   * Vendor Drop-Off with no assigned/planned spot — do not look like a normal
   * empty cell; surface incomplete staging assignment.
   */
  needsStagingAssignment?: boolean;
};

export function DeliveryListStagingChips({
  codes,
  occupancyByZoneCode,
  shopStockByCode,
  occupancyReady,
  deliveryId,
  stagingNotApplicable = false,
  needsStagingAssignment = false,
}: Props) {
  if (stagingNotApplicable) {
    return (
      <span
        data-testid={`delivery-list-staging-na-${deliveryId}`}
        style={{ color: "var(--admin-text-muted)", fontFamily: FONT }}
      >
        —
      </span>
    );
  }

  if (codes.length === 0) {
    if (needsStagingAssignment) {
      return (
        <span
          data-testid={`delivery-list-staging-needed-${deliveryId}`}
          title="Vendor Drop-Off requires a StageVerify staging location"
          style={{
            display: "inline-block",
            padding: "2px 8px",
            borderRadius: 999,
            backgroundColor: "var(--admin-warning-bg)",
            color: "var(--admin-warning-text)",
            border: "1px solid var(--admin-warning-border)",
            fontSize: 11,
            fontWeight: 700,
            fontFamily: FONT,
            whiteSpace: "nowrap",
          }}
        >
          Needs staging
        </span>
      );
    }
    return (
      <span
        data-testid={`delivery-list-staging-unassigned-${deliveryId}`}
        style={{ color: "var(--admin-text-muted)", fontFamily: FONT }}
      >
        —
      </span>
    );
  }

  return (
    <div
      data-testid={`delivery-list-staging-codes-${deliveryId}`}
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 3,
        maxWidth: 160,
      }}
    >
      {codes.map((code) => {
        const resolved: SpotMapColor = occupancyReady
          ? resolveSpotColor(code, occupancyByZoneCode, shopStockByCode)
          : "orange";
        const color = listDisplaySpotColor(resolved);
        const statusTitle =
          color === "purple"
            ? "Staged — Ready for pickup"
            : color === "orange"
              ? "Assigned / planned"
              : color === "gray"
                ? "Shop stock"
                : "Assigned / planned";
        return (
          <span
            key={code}
            data-testid={`delivery-list-staging-chip-${deliveryId}-${code}`}
            data-spot-color={color}
            title={statusTitle}
            style={stagingSpotChipStyle(color, "compact")}
          >
            {code}
          </span>
        );
      })}
    </div>
  );
}
