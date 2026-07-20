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
  SHOP_MAP_SHELF_LEVELS,
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
const DRAG_CLICK_THRESHOLD_PX = 4;

type EditSessionSnapshot = {
  label: string;
  code: string;
  offsetX: number;
  offsetY: number;
};

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

function spotStyle(color: SpotMapColor, ground: boolean): CSSProperties {
  const bg = SPOT_MAP_COLORS[color];
  const fg = SPOT_MAP_FG[color];
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
      minWidth: 52,
      minHeight: 52,
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
    padding: "4px 6px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 40,
    minHeight: 32,
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
  };

  const selectSpotForEdit = useCallback(
    (layoutSlot: string) => {
      cancelActiveDrag();
      const zone = zoneForLayoutSlot(layoutSlot);
      const label = zone?.label ?? layoutSlot;
      const code = zone?.code ?? formatStagingCodeCanonical(layoutSlot);
      const offsetX = zone?.mapOffsetX ?? 0;
      const offsetY = zone?.mapOffsetY ?? 0;
      setSelectedLayoutSlot(layoutSlot);
      setEditLabel(label);
      setEditCode(code);
      setEditOffsetX(offsetX);
      setEditOffsetY(offsetY);
      editSessionRef.current = { label, code, offsetX, offsetY };
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

  const spotEditChrome = (layoutSlot: string): CSSProperties =>
    editMode && selectedLayoutSlot === layoutSlot
      ? { outline: "2px dashed #2563eb", outlineOffset: 2 }
      : editMode
        ? { outline: "1px dashed #94a3b8", outlineOffset: 1 }
        : {};

  const offsetForSpot = (
    layoutSlot: string,
    absoluteBase?: { left: number; top: number },
  ): CSSProperties => {
    const zone = zoneForLayoutSlot(layoutSlot);
    const ox =
      editMode && selectedLayoutSlot === layoutSlot
        ? editOffsetX
        : (zone?.mapOffsetX ?? 0);
    const oy =
      editMode && selectedLayoutSlot === layoutSlot
        ? editOffsetY
        : (zone?.mapOffsetY ?? 0);
    if (absoluteBase) {
      return { left: absoluteBase.left + ox, top: absoluteBase.top + oy };
    }
    if (ox === 0 && oy === 0) return {};
    return { marginLeft: ox, marginTop: oy };
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
    return { ox, oy };
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
            Edit mode — click a spot to rename or drag to move
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
        {/* Left ground column G1–G4 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {SHOP_MAP_GROUND_LEFT.map((layoutSlot) => {
            const { ox, oy } = offsetAttrsForSpot(layoutSlot);
            return (
            <button
              key={layoutSlot}
              type="button"
              data-testid={`shop-spot-${layoutSlot}`}
              data-spot-color={colorOf(layoutSlot)}
              data-map-offset-x={ox}
              data-map-offset-y={oy}
              style={{
                ...spotStyle(colorOf(layoutSlot), true),
                ...offsetForSpot(layoutSlot),
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
            );
          })}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Top ground row G5–G12 */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {SHOP_MAP_GROUND_TOP.map((layoutSlot) => {
              const { ox, oy } = offsetAttrsForSpot(layoutSlot);
              return (
              <button
                key={layoutSlot}
                type="button"
                data-testid={`shop-spot-${layoutSlot}`}
                data-spot-color={colorOf(layoutSlot)}
                data-map-offset-x={ox}
                data-map-offset-y={oy}
                style={{
                  ...spotStyle(colorOf(layoutSlot), true),
                  ...offsetForSpot(layoutSlot),
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
              );
            })}
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
                      const offA = offsetAttrsForSpot(codeA);
                      const offB = offsetAttrsForSpot(codeB);
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
                          <button
                            type="button"
                            data-testid={`shop-spot-${codeA}`}
                            data-spot-color={colorOf(codeA)}
                            data-map-offset-x={offA.ox}
                            data-map-offset-y={offA.oy}
                            style={{
                              ...spotStyle(colorOf(codeA), false),
                              position: "absolute",
                              zIndex: 1,
                              ...offsetForSpot(codeA, { left: 0, top: 2 }),
                              ...spotEditChrome(codeA),
                            }}
                            onMouseEnter={() => !editMode && void onEnter(codeA)}
                            onMouseLeave={() => !editMode && setHover(null)}
                            onClick={() => onClickSpot(codeA)}
                            onPointerDown={(e) => onSpotPointerDown(e, codeA)}
                            onPointerMove={(e) => onSpotPointerMove(e, codeA)}
                            onPointerUp={(e) => onSpotPointerUp(e, codeA)}
                          >
                            {displayCodeForSlot(codeA)}
                          </button>
                          <button
                            type="button"
                            data-testid={`shop-spot-${codeB}`}
                            data-spot-color={colorOf(codeB)}
                            data-map-offset-x={offB.ox}
                            data-map-offset-y={offB.oy}
                            style={{
                              ...spotStyle(colorOf(codeB), false),
                              position: "absolute",
                              zIndex: 2,
                              ...offsetForSpot(codeB, { left: 34, top: 18 }),
                              ...spotEditChrome(codeB),
                            }}
                            onMouseEnter={() => !editMode && void onEnter(codeB)}
                            onMouseLeave={() => !editMode && setHover(null)}
                            onClick={() => onClickSpot(codeB)}
                            onPointerDown={(e) => onSpotPointerDown(e, codeB)}
                            onPointerMove={(e) => onSpotPointerMove(e, codeB)}
                            onPointerUp={(e) => onSpotPointerUp(e, codeB)}
                          >
                            {displayCodeForSlot(codeB)}
                          </button>
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
