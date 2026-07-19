import { useMemo, useState, type CSSProperties } from "react";
import type { DeliveryDetails } from "./dispatcher";
import type { ShopStockLocationMapping } from "./dispatcher/models";
import { firestoreDataService } from "./dispatcher/firestoreService";
import {
  SHOP_MAP_GROUND_LEFT,
  SHOP_MAP_GROUND_TOP,
  SHOP_MAP_SHELF_LEVELS,
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

/** CAD-style cubby: black frame, dark cavity, colored floor slab, readable label. */
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
        position: "relative",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        width: 58,
        height: 52,
        padding: 0,
        border: "2px solid #0a0a0a",
        borderRadius: 1,
        backgroundColor: "#1f1f1f",
        cursor: "pointer",
        overflow: "hidden",
        fontFamily: FONT,
        userSelect: "none",
        boxShadow:
          "inset 4px 0 6px rgba(0,0,0,0.45), inset -4px 0 6px rgba(0,0,0,0.45), inset 0 2px 0 rgba(255,255,255,0.08), 0 3px 6px rgba(0,0,0,0.25)",
        transform: "perspective(140px) rotateX(4deg)",
        transformOrigin: "center bottom",
      }}
    >
      <span
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 800,
          fontSize: 15,
          color: "#f1f5f9",
          letterSpacing: 0.3,
          textShadow: "0 1px 2px rgba(0,0,0,0.6)",
        }}
      >
        {shortLabel}
      </span>
      <div
        style={{
          height: "38%",
          minHeight: 18,
          backgroundColor: floorColor,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderTop: "2px solid rgba(0,0,0,0.55)",
          boxShadow: "inset 0 3px 6px rgba(0,0,0,0.2)",
        }}
      >
        <span
          style={{
            fontSize: 11,
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

function VerticalShelfUnit({
  unit,
  colorOf,
  onEnter,
  onLeave,
  onClickSpot,
}: {
  unit: (typeof SHOP_MAP_SHELF_UNITS)[number];
  colorOf: (code: string) => SpotMapColor;
  onEnter: (code: string) => void;
  onLeave: () => void;
  onClickSpot: (code: string) => void;
}) {
  const levelRowHeight = 56;

  return (
    <div
      data-testid={`shop-shelf-${unit}`}
      style={{ display: "flex", alignItems: "flex-end", gap: 10 }}
    >
      {/* Pair labels beside unit — bottom→top A+G … F+L */}
      <div
        data-testid={`shop-shelf-${unit}-labels`}
        style={{
          display: "flex",
          flexDirection: "column-reverse",
          gap: 6,
          paddingBottom: 4,
        }}
      >
        {SHOP_MAP_SHELF_LEVELS.map(([a, b]) => (
          <div
            key={`${unit}-${a}${b}`}
            style={{
              height: levelRowHeight,
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              fontWeight: 800,
              fontSize: 13,
              color: "#475569",
              letterSpacing: 0.2,
              minWidth: 36,
            }}
          >
            {a}+{b}
          </div>
        ))}
      </div>

      <div>
        <div
          style={{
            fontWeight: 800,
            color: NAVY,
            marginBottom: 10,
            fontSize: 17,
            textAlign: "center",
          }}
        >
          {unit}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column-reverse",
            gap: 6,
            border: "4px solid #0a0a0a",
            borderRadius: 3,
            padding: 8,
            backgroundColor: "#0f0f0f",
            boxShadow:
              "inset 0 3px 8px rgba(0,0,0,0.55), 4px 6px 14px rgba(0,0,0,0.22)",
            perspective: "900px",
          }}
        >
          {SHOP_MAP_SHELF_LEVELS.map(([a, b]) => {
            const codeA = shelfSpotCode(unit, a);
            const codeB = shelfSpotCode(unit, b);
            return (
              <div
                key={`${unit}-level-${a}${b}`}
                style={{
                  display: "flex",
                  gap: 6,
                  minHeight: levelRowHeight,
                  alignItems: "flex-end",
                }}
              >
                <ShelfCubby
                  code={codeA}
                  color={colorOf(codeA)}
                  onEnter={() => onEnter(codeA)}
                  onLeave={onLeave}
                  onClick={() => onClickSpot(codeA)}
                />
                <ShelfCubby
                  code={codeB}
                  color={colorOf(codeB)}
                  onEnter={() => onEnter(codeB)}
                  onLeave={onLeave}
                  onClick={() => onClickSpot(codeB)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
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
        {/* Left ground column G1–G4 (bottom→top on floor plan) */}
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
          {/* Top ground row G5–G12 — L-shape leg */}
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

          {/* Shelves S1 / S2 — vertical units (floor-plan orientation) */}
          <div
            style={{
              display: "flex",
              gap: 48,
              flexWrap: "wrap",
              alignItems: "flex-end",
              justifyContent: "center",
              paddingTop: 8,
            }}
          >
            {SHOP_MAP_SHELF_UNITS.map((unit) => (
              <VerticalShelfUnit
                key={unit}
                unit={unit}
                colorOf={colorOf}
                onEnter={(code) => void onEnter(code)}
                onLeave={() => setHover(null)}
                onClickSpot={onClickSpot}
              />
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
                  color === "orange"
                    ? "1px solid #ca8a04"
                    : "1px solid rgba(0,0,0,0.12)",
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
