import {
  useMemo,
  useState,
  useCallback,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { DeliveryDetails } from "./dispatcher";
import type { ShopStockLocationMapping, StagingLocation } from "./dispatcher/models";
import { firestoreDataService } from "./dispatcher/firestoreService";
import {
  SHOP_MAP_GROUND_LEFT,
  SHOP_MAP_GROUND_TOP,
  SHOP_MAP_GROUND_SPOT_H,
  SHOP_MAP_GROUND_SPOT_W,
  SHOP_MAP_SHELF_LEVELS,
  SHOP_MAP_SHELF_SPOT_H,
  SHOP_MAP_SHELF_SPOT_W,
  SHOP_MAP_SHELF_UNITS,
  allShopMapSpotCodes,
  shelfSpotCode,
} from "./dispatcher/shopMapLayout";
import { formatStagingCodeCanonical } from "./dispatcher/stagingCode";
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
/** Outer S1/S2 frame stroke — internal bay dividers must match exactly. */
const SHELF_FRAME_STROKE = "2px solid #64748b";

type HoverInfo =
  | { kind: "free"; code: string; label?: string }
  | {
      kind: "occupied";
      code: string;
      details: DeliveryDetails | null;
      loading: boolean;
      orderNumber: string;
      vendorName: string;
    }
  | { kind: "shop"; code: string; label: string };

export type MapZoneSavePayload = {
  code: string;
  zoneId?: string;
  patch: Partial<StagingLocation>;
};

type Props = {
  occupancyByZoneCode: Record<string, ZoneOccupancySummaryWithReadiness>;
  shopStockByCode: Record<string, ShopStockLocationMapping>;
  onOpenDelivery: (deliveryId: string) => void;
  /** Dispatcher map edit — rename label and nudge/drag spot position. */
  editMode?: boolean;
  zonesByLayoutSlot?: Record<string, StagingLocation>;
  onSaveZone?: (payload: MapZoneSavePayload) => Promise<void>;
};

const NUDGE_STEP = 8;
const SIZE_STEP = 4;
const MIN_SPOT_SIZE = 24;
const DRAG_CLICK_THRESHOLD_PX = 4;

type EditSessionSnapshot = {
  label: string;
  code: string;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

function isGroundLayoutSlot(layoutSlot: string): boolean {
  return /^G\d+$/i.test(layoutSlot.trim());
}

function defaultSpotSize(layoutSlot: string): { w: number; h: number } {
  return isGroundLayoutSlot(layoutSlot)
    ? { w: SHOP_MAP_GROUND_SPOT_W, h: SHOP_MAP_GROUND_SPOT_H }
    : { w: SHOP_MAP_SHELF_SPOT_W, h: SHOP_MAP_SHELF_SPOT_H };
}

const editInputStyle: CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 4,
  padding: "6px 8px",
  border: "1px solid #d1d5db",
  borderRadius: 4,
  fontFamily: FONT,
  fontSize: 13,
  color: "#111",
  backgroundColor: "#fff",
};

function spotStyle(
  color: SpotMapColor,
  ground: boolean,
  width: number,
  height: number,
): CSSProperties {
  const bg = SPOT_MAP_COLORS[color];
  const fg = SPOT_MAP_FG[color];
  const boxSizing = "border-box" as const;
  if (ground) {
    return {
      backgroundColor: bg,
      color: fg,
      border:
        color === "orange"
          ? "1px solid #ca8a04"
          : "1px solid rgba(0,0,0,0.15)",
      borderRadius: 4,
      fontWeight: 800,
      fontSize: 14,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width,
      height,
      boxSizing,
      flexShrink: 0,
      cursor: "pointer",
      fontFamily: FONT,
      userSelect: "none",
    };
  }
  return {
    backgroundColor: bg,
    color: fg,
    border:
      color === "orange"
        ? "1px solid #ca8a04"
        : "1px solid rgba(0,0,0,0.2)",
    borderRadius: 3,
    fontWeight: 700,
    fontSize: 11,
    padding: "2px 4px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width,
    height,
    boxSizing,
    flexShrink: 0,
    cursor: "pointer",
    fontFamily: FONT,
    userSelect: "none",
  };
}

export function ShopFloorMap({
  occupancyByZoneCode,
  shopStockByCode,
  onOpenDelivery,
  editMode = false,
  zonesByLayoutSlot = {},
  onSaveZone,
}: Props) {
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [selectedLayoutSlot, setSelectedLayoutSlot] = useState<string | null>(
    null,
  );
  const [editLabel, setEditLabel] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editOffsetX, setEditOffsetX] = useState(0);
  const [editOffsetY, setEditOffsetY] = useState(0);
  const [editWidth, setEditWidth] = useState(SHOP_MAP_GROUND_SPOT_W);
  const [editHeight, setEditHeight] = useState(SHOP_MAP_GROUND_SPOT_H);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const editSessionRef = useRef<EditSessionSnapshot | null>(null);
  const dragRef = useRef<{
    layoutSlot: string;
    startX: number;
    startY: number;
    baseOx: number;
    baseOy: number;
    moved: boolean;
  } | null>(null);
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    baseW: number;
    baseH: number;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const zoneForLayoutSlot = useCallback(
    (layoutSlot: string) =>
      zonesByLayoutSlot[normalizeStagingCodeKey(layoutSlot)],
    [zonesByLayoutSlot],
  );

  const displayCodeForSlot = useCallback(
    (layoutSlot: string) => {
      const zone = zoneForLayoutSlot(layoutSlot);
      return zone?.code ?? formatStagingCodeCanonical(layoutSlot);
    },
    [zoneForLayoutSlot],
  );

  const cancelActiveDrag = () => {
    dragRef.current = null;
    resizeRef.current = null;
  };

  const sizeForSpot = useCallback(
    (layoutSlot: string): { width: number; height: number } => {
      const zone = zoneForLayoutSlot(layoutSlot);
      const defaults = defaultSpotSize(layoutSlot);
      const width =
        editMode && selectedLayoutSlot === layoutSlot
          ? editWidth
          : (zone?.mapWidth ?? defaults.w);
      const height =
        editMode && selectedLayoutSlot === layoutSlot
          ? editHeight
          : (zone?.mapHeight ?? defaults.h);
      return { width, height };
    },
    [editMode, editHeight, editWidth, selectedLayoutSlot, zoneForLayoutSlot],
  );

  const selectSpotForEdit = useCallback(
    (layoutSlot: string) => {
      cancelActiveDrag();
      const zone = zoneForLayoutSlot(layoutSlot);
      const label = zone?.label ?? layoutSlot;
      const code = zone?.code ?? formatStagingCodeCanonical(layoutSlot);
      const offsetX = zone?.mapOffsetX ?? 0;
      const offsetY = zone?.mapOffsetY ?? 0;
      const defaults = defaultSpotSize(layoutSlot);
      const width = zone?.mapWidth ?? defaults.w;
      const height = zone?.mapHeight ?? defaults.h;
      setSelectedLayoutSlot(layoutSlot);
      setEditLabel(label);
      setEditCode(code);
      setEditOffsetX(offsetX);
      setEditOffsetY(offsetY);
      setEditWidth(width);
      setEditHeight(height);
      editSessionRef.current = {
        label,
        code,
        offsetX,
        offsetY,
        width,
        height,
      };
      setSaveError(null);
      setHover(null);
    },
    [zoneForLayoutSlot],
  );

  const cancelEditSession = useCallback(() => {
    cancelActiveDrag();
    const snap = editSessionRef.current;
    if (snap) {
      setEditLabel(snap.label);
      setEditCode(snap.code);
      setEditOffsetX(snap.offsetX);
      setEditOffsetY(snap.offsetY);
      setEditWidth(snap.width);
      setEditHeight(snap.height);
    }
    editSessionRef.current = null;
    setSelectedLayoutSlot(null);
    setSaveError(null);
  }, []);

  const persistEdit = async () => {
    if (!selectedLayoutSlot || !onSaveZone || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const zone = zoneForLayoutSlot(selectedLayoutSlot);
      const canonicalCode = formatStagingCodeCanonical(
        editCode.trim() || selectedLayoutSlot,
      );
      await onSaveZone({
        code: selectedLayoutSlot,
        zoneId: zone?.id,
        patch: {
          code: canonicalCode,
          label: editLabel.trim() || selectedLayoutSlot,
          mapOffsetX: editOffsetX,
          mapOffsetY: editOffsetY,
          mapWidth: editWidth,
          mapHeight: editHeight,
        },
      });
      editSessionRef.current = null;
      setSelectedLayoutSlot(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const onSpotPointerDown = (
    e: ReactPointerEvent<HTMLButtonElement>,
    layoutSlot: string,
  ) => {
    if (!editMode) return;
    e.preventDefault();
    const alreadySelected = selectedLayoutSlot === layoutSlot;
    if (!alreadySelected) {
      selectSpotForEdit(layoutSlot);
    } else if (dragRef.current && dragRef.current.layoutSlot !== layoutSlot) {
      cancelActiveDrag();
    }
    const zone = zoneForLayoutSlot(layoutSlot);
    const baseOx = alreadySelected
      ? editOffsetX
      : (zone?.mapOffsetX ?? 0);
    const baseOy = alreadySelected
      ? editOffsetY
      : (zone?.mapOffsetY ?? 0);
    e.currentTarget.setPointerCapture(e.pointerId);
    suppressClickRef.current = false;
    dragRef.current = {
      layoutSlot,
      startX: e.clientX,
      startY: e.clientY,
      baseOx,
      baseOy,
      moved: false,
    };
  };

  const onSpotPointerMove = (
    e: ReactPointerEvent<HTMLButtonElement>,
    layoutSlot: string,
  ) => {
    if (!editMode || !dragRef.current || dragRef.current.layoutSlot !== layoutSlot)
      return;
    const { startX, startY, baseOx, baseOy } = dragRef.current;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (
      !dragRef.current.moved &&
      Math.hypot(dx, dy) >= DRAG_CLICK_THRESHOLD_PX
    ) {
      dragRef.current.moved = true;
    }
    setEditOffsetX(baseOx + Math.round(dx));
    setEditOffsetY(baseOy + Math.round(dy));
  };

  const onSpotPointerUp = (
    e: ReactPointerEvent<HTMLButtonElement>,
    layoutSlot: string,
  ) => {
    if (!editMode || !dragRef.current || dragRef.current.layoutSlot !== layoutSlot)
      return;
    if (dragRef.current.moved) {
      suppressClickRef.current = true;
    }
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
  };

  const nudge = (dx: number, dy: number) => {
    setEditOffsetX((x) => x + dx);
    setEditOffsetY((y) => y + dy);
  };

  const nudgeSize = (dw: number, dh: number) => {
    setEditWidth((w) => Math.max(MIN_SPOT_SIZE, w + dw));
    setEditHeight((h) => Math.max(MIN_SPOT_SIZE, h + dh));
  };

  const onResizeHandlePointerDown = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (!editMode || !selectedLayoutSlot) return;
    e.preventDefault();
    e.stopPropagation();
    cancelActiveDrag();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseW: editWidth,
      baseH: editHeight,
    };
  };

  const onResizeHandlePointerMove = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (!editMode || !resizeRef.current) return;
    const { startX, startY, baseW, baseH } = resizeRef.current;
    const dw = e.clientX - startX;
    const dh = e.clientY - startY;
    setEditWidth(Math.max(MIN_SPOT_SIZE, baseW + Math.round(dw)));
    setEditHeight(Math.max(MIN_SPOT_SIZE, baseH + Math.round(dh)));
  };

  const onResizeHandlePointerUp = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (!resizeRef.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    resizeRef.current = null;
  };

  const spotEditChrome = (layoutSlot: string): CSSProperties =>
    editMode && selectedLayoutSlot === layoutSlot
      ? { outline: "2px dashed #2563eb", outlineOffset: 2 }
      : editMode
        ? { outline: "1px dashed #94a3b8", outlineOffset: 1 }
        : {};

  const offsetForSpot = (layoutSlot: string): CSSProperties => {
    const zone = zoneForLayoutSlot(layoutSlot);
    const ox =
      editMode && selectedLayoutSlot === layoutSlot
        ? editOffsetX
        : (zone?.mapOffsetX ?? 0);
    const oy =
      editMode && selectedLayoutSlot === layoutSlot
        ? editOffsetY
        : (zone?.mapOffsetY ?? 0);
    return { left: ox, top: oy };
  };

  const offsetAttrsForSpot = (layoutSlot: string) => {
    const zone = zoneForLayoutSlot(layoutSlot);
    const ox =
      editMode && selectedLayoutSlot === layoutSlot
        ? editOffsetX
        : (zone?.mapOffsetX ?? 0);
    const oy =
      editMode && selectedLayoutSlot === layoutSlot
        ? editOffsetY
        : (zone?.mapOffsetY ?? 0);
    const { width, height } = sizeForSpot(layoutSlot);
    return { ox, oy, width, height };
  };

  const renderSpotButton = (
    layoutSlot: string,
    ground: boolean,
    absoluteBase?: { left: number; top: number },
    zIndex = 1,
  ) => {
    const { ox, oy, width, height } = offsetAttrsForSpot(layoutSlot);
    const offset = absoluteBase
      ? { left: absoluteBase.left + ox, top: absoluteBase.top + oy }
      : offsetForSpot(layoutSlot);
    const selected = editMode && selectedLayoutSlot === layoutSlot;
    return (
      <>
        <button
          type="button"
          data-testid={`shop-spot-${layoutSlot}`}
          data-spot-color={colorOf(layoutSlot)}
          data-map-offset-x={ox}
          data-map-offset-y={oy}
          data-map-width={width}
          data-map-height={height}
          style={{
            ...spotStyle(colorOf(layoutSlot), ground, width, height),
            position: "absolute",
            zIndex,
            ...offset,
            ...spotEditChrome(layoutSlot),
          }}
          onMouseEnter={() => !editMode && void onEnter(layoutSlot)}
          onMouseLeave={() => !editMode && setHover(null)}
          onClick={() => onClickSpot(layoutSlot)}
          onPointerDown={(e) => onSpotPointerDown(e, layoutSlot)}
          onPointerMove={(e) => onSpotPointerMove(e, layoutSlot)}
          onPointerUp={(e) => onSpotPointerUp(e, layoutSlot)}
        >
          {displayCodeForSlot(layoutSlot)}
        </button>
        {selected && (
          <span
            data-testid="shop-map-resize-handle"
            role="presentation"
            onPointerDown={onResizeHandlePointerDown}
            onPointerMove={onResizeHandlePointerMove}
            onPointerUp={onResizeHandlePointerUp}
            style={{
              position: "absolute",
              left: (absoluteBase?.left ?? 0) + ox + width - 6,
              top: (absoluteBase?.top ?? 0) + oy + height - 6,
              width: 12,
              height: 12,
              borderRadius: 2,
              backgroundColor: "#2563eb",
              border: "2px solid #fff",
              boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
              cursor: "nwse-resize",
              zIndex: 4,
            }}
          />
        )}
      </>
    );
  };

  const groundSlotStyle = (layoutSlot: string): CSSProperties => {
    const defaults = defaultSpotSize(layoutSlot);
    return {
      position: "relative",
      width: defaults.w,
      height: defaults.h,
      flexShrink: 0,
    };
  };

  const unplaced = useMemo(() => {
    const layout = new Set(
      allShopMapSpotCodes().map((c) => normalizeStagingCodeKey(c)),
    );
    return Object.keys(occupancyByZoneCode)
      .filter((k) => !layout.has(normalizeStagingCodeKey(k)))
      .sort();
  }, [occupancyByZoneCode]);

  const colorOf = (layoutSlot: string) =>
    resolveSpotColor(
      displayCodeForSlot(layoutSlot),
      occupancyByZoneCode,
      shopStockByCode,
    );

  const onEnter = async (layoutSlot: string) => {
    const displayCode = displayCodeForSlot(layoutSlot);
    const key = normalizeStagingCodeKey(displayCode);
    const stock = shopStockByCode[key];
    const occ = occupancyByZoneCode[key];
    if (!occ && !stock) {
      const zone = zoneForLayoutSlot(layoutSlot);
      setHover({ kind: "free", code: displayCode, label: zone?.label });
      return;
    }
    if (!occ && stock) {
      setHover({ kind: "shop", code: displayCode, label: stock.stockItemLabel });
      return;
    }
    if (!occ) return;
    setHover({
      kind: "occupied",
      code: displayCode,
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
        prev && prev.kind === "occupied" && prev.code === displayCode
          ? { ...prev, details, loading: false }
          : prev,
      );
    } catch {
      setHover((prev) =>
        prev && prev.kind === "occupied" && prev.code === displayCode
          ? { ...prev, loading: false }
          : prev,
      );
    }
  };

  const onClickSpot = (layoutSlot: string) => {
    if (editMode) {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      selectSpotForEdit(layoutSlot);
      return;
    }
    const displayCode = displayCodeForSlot(layoutSlot);
    const occ = occupancyByZoneCode[normalizeStagingCodeKey(displayCode)];
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
          marginBottom: 12,
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            backgroundColor: NAVY,
            color: "#fff",
            fontWeight: 800,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
          }}
        >
          SV
        </div>
        <h2
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 800,
            color: NAVY,
            letterSpacing: 0.3,
          }}
        >
          VENDOR DROP-OFF LOCATION GUIDE
        </h2>
        {editMode && (
          <span
            data-testid="shop-map-edit-mode-banner"
            style={{
              marginLeft: "auto",
              fontSize: 12,
              fontWeight: 700,
              color: "#1d4ed8",
              backgroundColor: "#dbeafe",
              padding: "4px 10px",
              borderRadius: 6,
            }}
          >
            Edit mode — click a spot to rename, drag to move, or resize
          </span>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: 16,
          background:
            "repeating-linear-gradient(0deg, #f8fafc, #f8fafc 19px, #eef2f7 20px), repeating-linear-gradient(90deg, #f8fafc, #f8fafc 19px, #eef2f7 20px)",
          border: "1px solid #dde1e7",
          borderRadius: 10,
          padding: 20,
          minHeight: 420,
        }}
      >
        {/* Left ground column G1–G4 — fixed slots; spots absolute within slot */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {SHOP_MAP_GROUND_LEFT.map((layoutSlot) => (
            <div
              key={layoutSlot}
              data-testid={`shop-ground-slot-${layoutSlot}`}
              style={groundSlotStyle(layoutSlot)}
            >
              {renderSpotButton(layoutSlot, true)}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Top ground row G5–G12 */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {SHOP_MAP_GROUND_TOP.map((layoutSlot) => (
              <div
                key={layoutSlot}
                data-testid={`shop-ground-slot-${layoutSlot}`}
                style={groundSlotStyle(layoutSlot)}
              >
                {renderSpotButton(layoutSlot, true)}
              </div>
            ))}
          </div>

          {/* Shelves S1 / S2 — flush 6-bay columns; moderate aisle; shift into open floor */}
          <div
            data-testid="shop-shelf-row"
            style={{
              display: "flex",
              gap: 60,
              flexWrap: "wrap",
              alignItems: "flex-end",
              /* previous aisle was 120; shift pair right by gap/2 (=60) into open floor */
              marginLeft: 60,
            }}
          >
            {SHOP_MAP_SHELF_UNITS.map((unit) => (
              <div key={unit} data-testid={`shop-shelf-${unit}`}>
                <div
                  style={{
                    fontWeight: 800,
                    color: NAVY,
                    marginBottom: 6,
                    fontSize: 14,
                    textAlign: "center",
                    width: 52,
                  }}
                >
                  {unit}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "stretch",
                  }}
                >
                  {/* Continuous tall column: 6 flush squares, shared borders, zero gap */}
                  <div
                    data-testid={`shop-shelf-${unit}-bays`}
                    style={{
                      display: "flex",
                      flexDirection: "column-reverse",
                      gap: 0,
                      border: SHELF_FRAME_STROKE,
                      backgroundColor: "#fff",
                      boxSizing: "border-box",
                    }}
                  >
                    {SHOP_MAP_SHELF_LEVELS.map(([a], levelIndex) => (
                      <div
                        key={`${unit}-${a}`}
                        data-testid={`shop-shelf-${unit}-level-${a}`}
                        style={{
                          width: 52,
                          height: 52,
                          boxSizing: "border-box",
                          backgroundColor: "#fff",
                          /*
                           * column-reverse: visual bottom→top is A…F. borderTop on A–E draws
                           * each seam (incl. A/G↔B/H). Skip F (last) so the top bay doesn't
                           * double the outer frame stroke.
                           */
                          borderTop:
                            levelIndex === SHOP_MAP_SHELF_LEVELS.length - 1
                              ? "none"
                              : SHELF_FRAME_STROKE,
                        }}
                      />
                    ))}
                  </div>
                  {/* Staggered spot chips per level, aligned to flush bays */}
                  <div
                    data-testid={`shop-shelf-${unit}-spots`}
                    style={{
                      display: "flex",
                      flexDirection: "column-reverse",
                      gap: 0,
                      marginLeft: 6,
                    }}
                  >
                    {SHOP_MAP_SHELF_LEVELS.map(([a, b]) => {
                      const codeA = shelfSpotCode(unit, a);
                      const codeB = shelfSpotCode(unit, b);
                      return (
                        <div
                          key={`${unit}-spots-${a}`}
                          style={{
                            position: "relative",
                            width: 84,
                            height: 52,
                            flexShrink: 0,
                          }}
                        >
                          {renderSpotButton(codeA, false, { left: 0, top: 2 }, 1)}
                          {renderSpotButton(codeB, false, { left: 34, top: 18 }, 2)}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {editMode && selectedLayoutSlot && (
        <div
          data-testid="shop-map-edit-panel"
          style={{
            position: "absolute",
            right: 16,
            top: 56,
            width: 300,
            backgroundColor: "#fff",
            border: "2px solid #2563eb",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            padding: "14px 16px",
            zIndex: 6,
            fontSize: 13,
          }}
        >
          <div style={{ fontWeight: 800, color: NAVY, marginBottom: 10 }}>
            Edit {selectedLayoutSlot}
          </div>
          <label style={{ display: "block", marginBottom: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#6b7280" }}>
              Display name
            </span>
            <input
              data-testid="shop-map-edit-label"
              type="text"
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              style={editInputStyle}
            />
          </label>
          <label style={{ display: "block", marginBottom: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#6b7280" }}>
              Spot code
            </span>
            <input
              data-testid="shop-map-edit-code"
              type="text"
              value={editCode}
              onChange={(e) => setEditCode(e.target.value)}
              style={editInputStyle}
            />
            <span style={{ fontSize: 10, color: "#b45309", marginTop: 4, display: "block" }}>
              Changing code updates QR/sign URLs — prefer display name when possible.
            </span>
          </label>
          <div style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#6b7280" }}>
              Position nudge
            </span>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 4,
                marginTop: 6,
                maxWidth: 120,
              }}
            >
              <span />
              <button
                type="button"
                data-testid="shop-map-nudge-up"
                onClick={() => nudge(0, -NUDGE_STEP)}
                style={nudgeBtnStyle}
              >
                ↑
              </button>
              <span />
              <button
                type="button"
                data-testid="shop-map-nudge-left"
                onClick={() => nudge(-NUDGE_STEP, 0)}
                style={nudgeBtnStyle}
              >
                ←
              </button>
              <button
                type="button"
                data-testid="shop-map-nudge-reset"
                onClick={() => {
                  setEditOffsetX(0);
                  setEditOffsetY(0);
                  if (selectedLayoutSlot) {
                    const defaults = defaultSpotSize(selectedLayoutSlot);
                    setEditWidth(defaults.w);
                    setEditHeight(defaults.h);
                  }
                }}
                style={nudgeBtnStyle}
                title="Reset offset"
              >
                ·
              </button>
              <button
                type="button"
                data-testid="shop-map-nudge-right"
                onClick={() => nudge(NUDGE_STEP, 0)}
                style={nudgeBtnStyle}
              >
                →
              </button>
              <span />
              <button
                type="button"
                data-testid="shop-map-nudge-down"
                onClick={() => nudge(0, NUDGE_STEP)}
                style={nudgeBtnStyle}
              >
                ↓
              </button>
              <span />
            </div>
            <span style={{ fontSize: 11, color: "#6b7280" }}>
              Offset: {editOffsetX}px, {editOffsetY}px — or drag the spot
            </span>
          </div>
          <div style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#6b7280" }}>
              Size (px)
            </span>
            {(["width", "height"] as const).map((dim) => {
              const isW = dim === "width";
              const value = isW ? editWidth : editHeight;
              const setValue = isW ? setEditWidth : setEditHeight;
              const minusId = isW ? "shop-map-size-w-minus" : "shop-map-size-h-minus";
              const plusId = isW ? "shop-map-size-w-plus" : "shop-map-size-h-plus";
              const inputId = isW ? "shop-map-edit-width" : "shop-map-edit-height";
              return (
                <div
                  key={dim}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    marginTop: 6,
                  }}
                >
                  <span style={{ fontSize: 11, color: "#6b7280", width: 14 }}>
                    {isW ? "W" : "H"}
                  </span>
                  <button
                    type="button"
                    data-testid={minusId}
                    onClick={() => nudgeSize(isW ? -SIZE_STEP : 0, isW ? 0 : -SIZE_STEP)}
                    style={nudgeBtnStyle}
                  >
                    −
                  </button>
                  <input
                    data-testid={inputId}
                    type="number"
                    min={MIN_SPOT_SIZE}
                    value={value}
                    onChange={(e) =>
                      setValue(
                        Math.max(MIN_SPOT_SIZE, Number(e.target.value) || MIN_SPOT_SIZE),
                      )
                    }
                    style={{ ...editInputStyle, marginTop: 0, width: 56 }}
                  />
                  <button
                    type="button"
                    data-testid={plusId}
                    onClick={() => nudgeSize(isW ? SIZE_STEP : 0, isW ? 0 : SIZE_STEP)}
                    style={nudgeBtnStyle}
                  >
                    +
                  </button>
                </div>
              );
            })}
            <span style={{ fontSize: 11, color: "#6b7280", display: "block", marginTop: 4 }}>
              {editWidth}×{editHeight}px — or drag the blue corner handle
            </span>
          </div>
          {saveError && (
            <div style={{ color: "#991b1b", fontSize: 12, marginBottom: 8 }}>
              {saveError}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              data-testid="shop-map-edit-save"
              disabled={saving || !onSaveZone}
              onClick={() => void persistEdit()}
              style={{
                flex: 1,
                padding: "8px 12px",
                borderRadius: 4,
                border: "none",
                backgroundColor: NAVY,
                color: "#fff",
                fontWeight: 700,
                cursor: saving ? "wait" : "pointer",
                fontFamily: FONT,
              }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              data-testid="shop-map-edit-cancel"
              onClick={cancelEditSession}
              style={{
                padding: "8px 12px",
                borderRadius: 4,
                border: "1px solid #d1d5db",
                backgroundColor: "#fff",
                color: "#111",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: FONT,
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!editMode && hover && (
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
              {hover.label && hover.label !== hover.code && (
                <div style={{ color: "#374151", marginTop: 2 }}>{hover.label}</div>
              )}
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
          gap: 14,
          marginTop: 14,
          fontSize: 12,
          color: "#374151",
        }}
      >
        {(
          [
            ["green", "Available"],
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
                width: 14,
                height: 14,
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

const nudgeBtnStyle: CSSProperties = {
  padding: "4px 8px",
  border: "1px solid #d1d5db",
  borderRadius: 4,
  backgroundColor: "#f9fafb",
  cursor: "pointer",
  fontFamily: FONT,
  fontWeight: 700,
};

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
