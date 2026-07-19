import { useMemo, useState, type CSSProperties } from "react";
import type { DeliveryDetails } from "./dispatcher";
import type { ShopStockLocationMapping } from "./dispatcher/models";
import { firestoreDataService } from "./dispatcher/firestoreService";
import {
  SHOP_MAP_GROUND_LEFT,
  SHOP_MAP_GROUND_TOP,
  SHOP_MAP_SHELF_UNITS,
  allShopMapSpotCodes,
  shelfSpotCode,
} from "./dispatcher/shopMapLayout";
import {
  SPOT_MAP_COLORS,
  SPOT_MAP_FG,
  resolveSpotColor,
  type SpotMapColor,
} from "./dispatcher/resolveSpotColor";
import type { ZoneOccupancySummaryWithReadiness } from "./dispatcher/zoneOccupancyCompute";
import { normalizeStagingCodeKey } from "./dispatcher/stagingCode";
import { resolveDeliveryPoNumber } from "./dispatcher/invoice/invoiceShellDisplayHelpers";

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const NAVY = "#0a3161";

const SHELF_TOP_ROW = ["A", "B", "C", "D", "E", "F"] as const;
const SHELF_BOTTOM_ROW = ["G", "H", "I", "J", "K", "L"] as const;

type HoverInfo =
  | { kind: "free"; code: string }
  | {
      kind: "occupied";
      code: string;
      details: DeliveryDetails | null;
      loading: boolean;
      orderNumber: string;
      vendorName: string;
    }
  | { kind: "shop"; code: string; label: string };

type Props = {
  occupancyByZoneCode: Record<string, ZoneOccupancySummaryWithReadiness>;
  shopStockByCode: Record<string, ShopStockLocationMapping>;
  onOpenDelivery: (deliveryId: string) => void;
};

function groundSpotStyle(color: SpotMapColor): CSSProperties {
  const bg = SPOT_MAP_COLORS[color];
  const fg = SPOT_MAP_FG[color];
  return {
    backgroundColor: bg,
    color: fg,
    border:
      color === "orange"
        ? "1px solid #ca8a04"
        : "1px solid rgba(0,0,0,0.15)",
    borderRadius: 6,
    fontWeight: 800,
    fontSize: 16,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 64,
    minHeight: 64,
    cursor: "pointer",
    fontFamily: FONT,
    userSelect: "none",
    boxShadow: "0 2px 4px rgba(0,0,0,0.12)",
  };
}

function ShelfCubby({
  code,
  color,
  onEnter,
  onLeave,
  onClick,
}: {
  code: string;
  color: SpotMapColor;
  onEnter: () => void;
  onLeave: () => void;
  onClick: () => void;
}) {
  const floorColor = SPOT_MAP_COLORS[color];
  const floorFg = SPOT_MAP_FG[color];
  const shortLabel = code.replace(/^S[12]/, "");

  return (
    <button
      type="button"
      data-testid={`shop-spot-${code}`}
      data-spot-color={color}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        width: 56,
        height: 50,
        padding: 0,
        border: "2px solid #0a0a0a",
        borderRadius: 2,
        backgroundColor: "#2a2a2a",
        cursor: "pointer",
        overflow: "hidden",
        fontFamily: FONT,
        userSelect: "none",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -2px 4px rgba(0,0,0,0.35)",
      }}
    >
      <span
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 800,
          fontSize: 14,
          color: "#f8fafc",
          letterSpacing: 0.2,
        }}
      >
        {shortLabel}
      </span>
      <div
        style={{
          height: "36%",
          minHeight: 16,
          backgroundColor: floorColor,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderTop: "1px solid rgba(0,0,0,0.45)",
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: floorFg,
            opacity: color === "green" ? 0 : 0.95,
          }}
          aria-hidden
        >
          {shortLabel}
        </span>
      </div>
    </button>
  );
}

export function ShopFloorMap({
  occupancyByZoneCode,
  shopStockByCode,
  onOpenDelivery,
}: Props) {
  const [hover, setHover] = useState<HoverInfo | null>(null);

  const unplaced = useMemo(() => {
    const layout = new Set(
      allShopMapSpotCodes().map((c) => normalizeStagingCodeKey(c)),
    );
    return Object.keys(occupancyByZoneCode)
      .filter((k) => !layout.has(normalizeStagingCodeKey(k)))
      .sort();
  }, [occupancyByZoneCode]);

  const colorOf = (code: string) =>
    resolveSpotColor(code, occupancyByZoneCode, shopStockByCode);

  const onEnter = async (code: string) => {
    const key = normalizeStagingCodeKey(code);
    const stock = shopStockByCode[key];
    const occ = occupancyByZoneCode[key];
    if (!occ && !stock) {
      setHover({ kind: "free", code });
      return;
    }
    if (!occ && stock) {
      setHover({ kind: "shop", code, label: stock.stockItemLabel });
      return;
    }
    if (!occ) return;
    setHover({
      kind: "occupied",
      code,
      details: null,
      loading: true,
      orderNumber: occ.orderNumber,
      vendorName: occ.vendorName,
    });
    try {
      const details = await firestoreDataService.getDeliveryDetails(
        occ.deliveryId,
      );
      setHover((prev) =>
        prev && prev.kind === "occupied" && prev.code === code
          ? { ...prev, details, loading: false }
          : prev,
      );
    } catch {
      setHover((prev) =>
        prev && prev.kind === "occupied" && prev.code === code
          ? { ...prev, loading: false }
          : prev,
      );
    }
  };

  const onClickSpot = (code: string) => {
    const occ = occupancyByZoneCode[normalizeStagingCodeKey(code)];
    if (occ) onOpenDelivery(occ.deliveryId);
  };

  return (
    <div
      data-testid="shop-floor-map"
      className="shop-floor-map"
      style={{ fontFamily: FONT, position: "relative" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 8,
            backgroundColor: NAVY,
            color: "#fff",
            fontWeight: 800,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 15,
          }}
        >
          SV
        </div>
        <h2
          style={{
            margin: 0,
            fontSize: 20,
            fontWeight: 800,
            color: NAVY,
            letterSpacing: 0.3,
          }}
        >
          VENDOR DROP-OFF LOCATION GUIDE
        </h2>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: 20,
          background:
            "repeating-linear-gradient(0deg, #f8fafc, #f8fafc 19px, #eef2f7 20px), repeating-linear-gradient(90deg, #f8fafc, #f8fafc 19px, #eef2f7 20px)",
          border: "1px solid #dde1e7",
          borderRadius: 10,
          padding: 28,
          minHeight: 560,
        }}
      >
        {/* Left ground column G1–G4 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {SHOP_MAP_GROUND_LEFT.map((code) => (
            <button
              key={code}
              type="button"
              data-testid={`shop-spot-${code}`}
              data-spot-color={colorOf(code)}
              style={groundSpotStyle(colorOf(code))}
              onMouseEnter={() => void onEnter(code)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onClickSpot(code)}
            >
              {code}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Top ground row G5–G12 */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {SHOP_MAP_GROUND_TOP.map((code) => (
              <button
                key={code}
                type="button"
                data-testid={`shop-spot-${code}`}
                data-spot-color={colorOf(code)}
                style={groundSpotStyle(colorOf(code))}
                onMouseEnter={() => void onEnter(code)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onClickSpot(code)}
              >
                {code}
              </button>
            ))}
          </div>

          {/* Shelves S1 / S2 — CAD-style 2×6 grid */}
          <div style={{ display: "flex", gap: 40, flexWrap: "wrap" }}>
            {SHOP_MAP_SHELF_UNITS.map((unit) => (
              <div key={unit} data-testid={`shop-shelf-${unit}`}>
                <div
                  style={{
                    fontWeight: 800,
                    color: NAVY,
                    marginBottom: 10,
                    fontSize: 16,
                  }}
                >
                  {unit}
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    border: "3px solid #0a0a0a",
                    borderRadius: 4,
                    padding: 10,
                    backgroundColor: "#1a1a1a",
                    boxShadow:
                      "inset 0 2px 6px rgba(0,0,0,0.5), 0 4px 10px rgba(0,0,0,0.18)",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(6, 1fr)",
                      gap: 5,
                    }}
                  >
                    {SHELF_TOP_ROW.map((letter) => {
                      const code = shelfSpotCode(unit, letter);
                      return (
                        <ShelfCubby
                          key={code}
                          code={code}
                          color={colorOf(code)}
                          onEnter={() => void onEnter(code)}
                          onLeave={() => setHover(null)}
                          onClick={() => onClickSpot(code)}
                        />
                      );
                    })}
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(6, 1fr)",
                      gap: 5,
                    }}
                  >
                    {SHELF_BOTTOM_ROW.map((letter) => {
                      const code = shelfSpotCode(unit, letter);
                      return (
                        <ShelfCubby
                          key={code}
                          code={code}
                          color={colorOf(code)}
                          onEnter={() => void onEnter(code)}
                          onLeave={() => setHover(null)}
                          onClick={() => onClickSpot(code)}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {hover && (
        <div
          data-testid="shop-map-hover-card"
          style={{
            position: "absolute",
            right: 16,
            top: 56,
            width: 280,
            backgroundColor: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            padding: "12px 14px",
            zIndex: 5,
            fontSize: 13,
          }}
        >
          {hover.kind === "free" && (
            <>
              <div style={{ fontWeight: 800, color: NAVY }}>{hover.code}</div>
              <div style={{ color: "#16a34a", marginTop: 4 }}>Available</div>
            </>
          )}
          {hover.kind === "shop" && (
            <>
              <div style={{ fontWeight: 800, color: NAVY }}>{hover.code}</div>
              <div style={{ color: "#6b7280", marginTop: 4 }}>Shop stock</div>
              <div style={{ marginTop: 6 }}>{hover.label}</div>
            </>
          )}
          {hover.kind === "occupied" && (
            <>
              <div
                style={{
                  fontSize: 11,
                  color: "#9ca3af",
                  letterSpacing: 0.6,
                  fontWeight: 700,
                  marginBottom: 8,
                }}
              >
                — DELIVERY BASICS
              </div>
              <HoverRow
                label="Job #"
                value={
                  hover.details?.job?.jobNumber ||
                  hover.details?.delivery.orderNumber ||
                  hover.orderNumber
                }
                bold
              />
              <HoverRow
                label="Job Name"
                value={hover.details?.job?.jobName || "—"}
              />
              <HoverRow
                label="Order #"
                value={
                  hover.details?.delivery.orderNumber || hover.orderNumber
                }
                bold
              />
              <HoverRow
                label="Vendor"
                value={
                  hover.details?.vendor.name ||
                  hover.details?.delivery.vendorName ||
                  hover.vendorName
                }
              />
              <HoverRow
                label="PO #"
                value={
                  hover.details
                    ? resolveDeliveryPoNumber(
                        hover.details.delivery.customerPoOrReference,
                        hover.details.purchaseOrder?.poNumber,
                      ) || "—"
                    : "—"
                }
              />
              <HoverRow
                label="Staging"
                value={hover.code}
                italic={!hover.loading}
              />
              {hover.loading && (
                <div style={{ color: "#9ca3af", marginTop: 6, fontSize: 12 }}>
                  Loading…
                </div>
              )}
            </>
          )}
        </div>
      )}

      {unplaced.length > 0 && (
        <div
          data-testid="shop-map-unplaced"
          style={{
            marginTop: 12,
            padding: 10,
            backgroundColor: "#fff7ed",
            border: "1px solid #fed7aa",
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          <strong>Unplaced codes:</strong> {unplaced.join(", ")}
        </div>
      )}

      <div
        data-testid="shop-map-legend"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          marginTop: 16,
          fontSize: 13,
          color: "#374151",
        }}
      >
        {(
          [
            ["green", "Free"],
            ["orange", "Assigned / planned (yellow)"],
            ["red", "Ready for pickup"],
            ["gray", "Shop stock"],
          ] as const
        ).map(([color, label]) => (
          <div
            key={color}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: 3,
                backgroundColor: SPOT_MAP_COLORS[color],
                border:
                  color === "orange" ? "1px solid #ca8a04" : "1px solid rgba(0,0,0,0.12)",
                display: "inline-block",
              }}
            />
            {label}
          </div>
        ))}
      </div>

      <div
        className="shop-map-you-are-here"
        style={{ marginTop: 16, fontWeight: 700, color: NAVY }}
      >
        YOU ARE HERE → (entrance)
      </div>
    </div>
  );
}

function HoverRow({
  label,
  value,
  bold,
  italic,
}: {
  label: string;
  value: string;
  bold?: boolean;
  italic?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 4,
      }}
    >
      <span style={{ color: "#6b7280" }}>{label}</span>
      <span
        style={{
          fontWeight: bold ? 700 : 500,
          fontStyle: italic ? "italic" : "normal",
          color: italic ? "#9ca3af" : "#111827",
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}
