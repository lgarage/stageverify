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
  isShelfUnitCode,
  shelfSpotCode,
  type ShopMapShelfUnit,
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
  /** Primary slot for the edit panel (single-select / last focused). */
  const [selectedLayoutSlot, setSelectedLayoutSlot] = useState<string | null>(
    null,
  );
  /** All selected layout slots (marquee or multi). */
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  /** Draft offsets for multi-select / in-progress group moves. */
  const [pendingOffsets, setPendingOffsets] = useState<
    Record<string, { ox: number; oy: number }>
  >({});
  const [editLabel, setEditLabel] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editOffsetX, setEditOffsetX] = useState(0);
  const [editOffsetY, setEditOffsetY] = useState(0);
  const [editWidth, setEditWidth] = useState(SHOP_MAP_GROUND_SPOT_W);
  const [editHeight, setEditHeight] = useState(SHOP_MAP_GROUND_SPOT_H);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  const editSessionRef = useRef<EditSessionSnapshot | null>(null);
  const dragRef = useRef<{
    slots: string[];
    startX: number;
    startY: number;
    bases: Record<string, { ox: number; oy: number }>;
    moved: boolean;
  } | null>(null);
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    baseW: number;
    baseH: number;
  } | null>(null);
  const marqueeRef = useRef<{
    startX: number;
    startY: number;
    canvasLeft: number;
    canvasTop: number;
  } | null>(null);
  const mapCanvasRef = useRef<HTMLDivElement>(null);
  const spotElRefs = useRef<Record<string, HTMLElement | null>>({});
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
    marqueeRef.current = null;
  };

  const readOffset = useCallback(
    (layoutSlot: string): { ox: number; oy: number } => {
      const pending = pendingOffsets[layoutSlot];
      if (pending) return pending;
      if (editMode && selectedLayoutSlot === layoutSlot) {
        return { ox: editOffsetX, oy: editOffsetY };
      }
      const zone = zoneForLayoutSlot(layoutSlot);
      return { ox: zone?.mapOffsetX ?? 0, oy: zone?.mapOffsetY ?? 0 };
    },
    [
      editMode,
      editOffsetX,
      editOffsetY,
      pendingOffsets,
      selectedLayoutSlot,
      zoneForLayoutSlot,
    ],
  );

  const sizeForSpot = useCallback(
    (layoutSlot: string): { width: number; height: number } => {
      if (isShelfUnitCode(layoutSlot)) {
        return { width: 0, height: 0 };
      }
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
    (layoutSlot: string, additive = false) => {
      cancelActiveDrag();
      const zone = zoneForLayoutSlot(layoutSlot);
      const label = zone?.label ?? layoutSlot;
      const code = zone?.code ?? formatStagingCodeCanonical(layoutSlot);
      const offsetX = zone?.mapOffsetX ?? 0;
      const offsetY = zone?.mapOffsetY ?? 0;
      const defaults = isShelfUnitCode(layoutSlot)
        ? { w: 0, h: 0 }
        : defaultSpotSize(layoutSlot);
      const width = zone?.mapWidth ?? defaults.w;
      const height = zone?.mapHeight ?? defaults.h;
      setSelectedLayoutSlot(layoutSlot);
      setSelectedSlots((prev) => {
        if (additive && prev.includes(layoutSlot)) return prev;
        if (additive) return [...prev, layoutSlot];
        return [layoutSlot];
      });
      if (!additive) setPendingOffsets({});
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

  const applyGroupDelta = (dx: number, dy: number) => {
    const drag = dragRef.current;
    if (!drag) return;
    const next: Record<string, { ox: number; oy: number }> = {};
    for (const slot of drag.slots) {
      const base = drag.bases[slot] ?? { ox: 0, oy: 0 };
      next[slot] = {
        ox: base.ox + Math.round(dx),
        oy: base.oy + Math.round(dy),
      };
    }
    setPendingOffsets((prev) => ({ ...prev, ...next }));
    if (selectedLayoutSlot && next[selectedLayoutSlot]) {
      setEditOffsetX(next[selectedLayoutSlot].ox);
      setEditOffsetY(next[selectedLayoutSlot].oy);
    }
  };

  const beginDragSlots = (
    e: ReactPointerEvent<HTMLElement>,
    slots: string[],
    basesOverride?: Record<string, { ox: number; oy: number }>,
  ) => {
    const bases: Record<string, { ox: number; oy: number }> = {};
    for (const slot of slots) {
      bases[slot] = basesOverride?.[slot] ?? readOffset(slot);
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    suppressClickRef.current = false;
    dragRef.current = {
      slots,
      startX: e.clientX,
      startY: e.clientY,
      bases,
      moved: false,
    };
  };

  const syncOffsetForSlot = (layoutSlot: string): { ox: number; oy: number } => {
    if (pendingOffsets[layoutSlot]) return pendingOffsets[layoutSlot];
    if (selectedLayoutSlot === layoutSlot) {
      return { ox: editOffsetX, oy: editOffsetY };
    }
    const zone = zoneForLayoutSlot(layoutSlot);
    return { ox: zone?.mapOffsetX ?? 0, oy: zone?.mapOffsetY ?? 0 };
  };

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
    setSelectedSlots([]);
    setPendingOffsets({});
    setSaveError(null);
  }, []);

  const persistEdit = async () => {
    if (!onSaveZone || saving) return;
    const multi =
      selectedSlots.length > 1
        ? selectedSlots
        : selectedLayoutSlot
          ? [selectedLayoutSlot]
          : [];
    if (multi.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (multi.length > 1) {
        for (const slot of multi) {
          const zone = zoneForLayoutSlot(slot);
          const { ox, oy } = readOffset(slot);
          const defaults = isShelfUnitCode(slot)
            ? { w: undefined, h: undefined }
            : defaultSpotSize(slot);
          await onSaveZone({
            code: slot,
            zoneId: zone?.id,
            patch: {
              code: zone?.code ?? formatStagingCodeCanonical(slot),
              label: zone?.label ?? slot,
              mapOffsetX: ox,
              mapOffsetY: oy,
              ...(isShelfUnitCode(slot)
                ? {}
                : {
                    mapWidth: zone?.mapWidth ?? defaults.w,
                    mapHeight: zone?.mapHeight ?? defaults.h,
                  }),
            },
          });
        }
      } else {
        const slot = multi[0];
        const zone = zoneForLayoutSlot(slot);
        const canonicalCode = formatStagingCodeCanonical(
          editCode.trim() || slot,
        );
        const { ox, oy } = readOffset(slot);
        await onSaveZone({
          code: slot,
          zoneId: zone?.id,
          patch: {
            code: canonicalCode,
            label: editLabel.trim() || slot,
            mapOffsetX: ox,
            mapOffsetY: oy,
            ...(isShelfUnitCode(slot)
              ? {}
              : { mapWidth: editWidth, mapHeight: editHeight }),
          },
        });
      }
      editSessionRef.current = null;
      setSelectedLayoutSlot(null);
      setSelectedSlots([]);
      setPendingOffsets({});
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
    e.stopPropagation();
    const inGroup =
      selectedSlots.length > 1 && selectedSlots.includes(layoutSlot);
    if (!inGroup) {
      const zone = zoneForLayoutSlot(layoutSlot);
      const base = {
        ox:
          selectedLayoutSlot === layoutSlot
            ? editOffsetX
            : (pendingOffsets[layoutSlot]?.ox ?? zone?.mapOffsetX ?? 0),
        oy:
          selectedLayoutSlot === layoutSlot
            ? editOffsetY
            : (pendingOffsets[layoutSlot]?.oy ?? zone?.mapOffsetY ?? 0),
      };
      selectSpotForEdit(layoutSlot);
      beginDragSlots(e, [layoutSlot], { [layoutSlot]: base });
      return;
    }
    const bases: Record<string, { ox: number; oy: number }> = {};
    for (const slot of selectedSlots) {
      bases[slot] = syncOffsetForSlot(slot);
    }
    beginDragSlots(e, selectedSlots, bases);
  };

  const onDragPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!editMode || !dragRef.current) return;
    const { startX, startY } = dragRef.current;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (
      !dragRef.current.moved &&
      Math.hypot(dx, dy) >= DRAG_CLICK_THRESHOLD_PX
    ) {
      dragRef.current.moved = true;
    }
    applyGroupDelta(dx, dy);
  };

  const onDragPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    if (!editMode || !dragRef.current) return;
    if (dragRef.current.moved) {
      suppressClickRef.current = true;
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    dragRef.current = null;
  };

  const onShelfFramePointerDown = (
    e: ReactPointerEvent<HTMLDivElement>,
    unit: ShopMapShelfUnit,
  ) => {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();
    const base = syncOffsetForSlot(unit);
    selectSpotForEdit(unit);
    beginDragSlots(e, [unit], { [unit]: base });
  };

  const spotsInMarquee = (box: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  }): string[] => {
    const left = Math.min(box.x0, box.x1);
    const right = Math.max(box.x0, box.x1);
    const top = Math.min(box.y0, box.y1);
    const bottom = Math.max(box.y0, box.y1);
    const canvas = mapCanvasRef.current;
    if (!canvas) return [];
    const canvasRect = canvas.getBoundingClientRect();
    const hits: string[] = [];
    for (const code of allShopMapSpotCodes()) {
      const el = spotElRefs.current[code];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const x = r.left - canvasRect.left;
      const y = r.top - canvasRect.top;
      const x2 = x + r.width;
      const y2 = y + r.height;
      if (x < right && x2 > left && y < bottom && y2 > top) {
        hits.push(code);
      }
    }
    return hits;
  };

  const onCanvasPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!editMode) return;
    const target = e.target as HTMLElement;
    if (
      target.closest(
        '[data-testid^="shop-spot-"], [data-testid="shop-map-resize-handle"], [data-testid="shop-map-edit-panel"], [data-testid^="shop-shelf-"][data-testid$="-frame"]',
      )
    ) {
      return;
    }
    const canvas = mapCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    marqueeRef.current = {
      startX: x,
      startY: y,
      canvasLeft: rect.left,
      canvasTop: rect.top,
    };
    setMarquee({ x0: x, y0: y, x1: x, y1: y });
    canvas.setPointerCapture(e.pointerId);
  };

  const onCanvasPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!marqueeRef.current || !mapCanvasRef.current) return;
    const rect = mapCanvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setMarquee({
      x0: marqueeRef.current.startX,
      y0: marqueeRef.current.startY,
      x1: x,
      y1: y,
    });
  };

  const onCanvasPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!marqueeRef.current || !mapCanvasRef.current) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    const rect = mapCanvasRef.current.getBoundingClientRect();
    const box = {
      x0: marqueeRef.current.startX,
      y0: marqueeRef.current.startY,
      x1: e.clientX - rect.left,
      y1: e.clientY - rect.top,
    };
    marqueeRef.current = null;
    setMarquee(null);
    const w = Math.abs(box.x1 - box.x0);
    const h = Math.abs(box.y1 - box.y0);
    if (w < 4 && h < 4) {
      cancelEditSession();
      return;
    }
    const hits = spotsInMarquee(box);
    if (hits.length === 0) {
      cancelEditSession();
      return;
    }
    if (hits.length === 1) {
      selectSpotForEdit(hits[0]);
      return;
    }
    cancelActiveDrag();
    setSelectedSlots(hits);
    setSelectedLayoutSlot(hits[0]);
    const zone = zoneForLayoutSlot(hits[0]);
    const ox = zone?.mapOffsetX ?? 0;
    const oy = zone?.mapOffsetY ?? 0;
    const defaults = defaultSpotSize(hits[0]);
    setEditLabel(`${hits.length} spots selected`);
    setEditCode("");
    setEditOffsetX(ox);
    setEditOffsetY(oy);
    setEditWidth(zone?.mapWidth ?? defaults.w);
    setEditHeight(zone?.mapHeight ?? defaults.h);
    editSessionRef.current = null;
    const seeded: Record<string, { ox: number; oy: number }> = {};
    for (const slot of hits) {
      const z = zoneForLayoutSlot(slot);
      seeded[slot] = { ox: z?.mapOffsetX ?? 0, oy: z?.mapOffsetY ?? 0 };
    }
    setPendingOffsets(seeded);
    setSaveError(null);
    setHover(null);
  };

  const nudge = (dx: number, dy: number) => {
    const slots =
      selectedSlots.length > 1
        ? selectedSlots
        : selectedLayoutSlot
          ? [selectedLayoutSlot]
          : [];
    if (slots.length === 0) return;
    const bases = Object.fromEntries(
      slots.map((slot) => [slot, syncOffsetForSlot(slot)]),
    );
    setPendingOffsets((prev) => {
      const next = { ...prev };
      for (const slot of slots) {
        const cur = bases[slot] ?? { ox: 0, oy: 0 };
        next[slot] = { ox: cur.ox + dx, oy: cur.oy + dy };
      }
      return next;
    });
    if (selectedLayoutSlot && slots.includes(selectedLayoutSlot)) {
      setEditOffsetX((x) => x + dx);
      setEditOffsetY((y) => y + dy);
    }
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

  const spotEditChrome = (layoutSlot: string): CSSProperties => {
    if (!editMode) return {};
    if (selectedSlots.includes(layoutSlot) || selectedLayoutSlot === layoutSlot) {
      return { outline: "2px dashed #2563eb", outlineOffset: 2 };
    }
    return { outline: "1px dashed #94a3b8", outlineOffset: 1 };
  };

  const offsetAttrsForSpot = (layoutSlot: string) => {
    const { ox, oy } = readOffset(layoutSlot);
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
      : { left: ox, top: oy };
    const selected =
      editMode &&
      selectedSlots.length <= 1 &&
      selectedLayoutSlot === layoutSlot;
    return (
      <>
        <button
          type="button"
          ref={(el) => {
            spotElRefs.current[layoutSlot] = el;
          }}
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
          onPointerMove={onDragPointerMove}
          onPointerUp={onDragPointerUp}
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
            Edit mode — drag spots, marquee-select, drag S1/S2 frames
          </span>
        )}
      </div>

      <div
        ref={mapCanvasRef}
        data-testid="shop-map-canvas"
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={onCanvasPointerUp}
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
          position: "relative",
          touchAction: editMode ? "none" : undefined,
          userSelect: editMode ? "none" : undefined,
        }}
      >
        {marquee && (
          <div
            data-testid="shop-map-marquee"
            style={{
              position: "absolute",
              left: Math.min(marquee.x0, marquee.x1),
              top: Math.min(marquee.y0, marquee.y1),
              width: Math.abs(marquee.x1 - marquee.x0),
              height: Math.abs(marquee.y1 - marquee.y0),
              border: "1px dashed #2563eb",
              backgroundColor: "rgba(37, 99, 235, 0.12)",
              pointerEvents: "none",
              zIndex: 20,
            }}
          />
        )}
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
            {SHOP_MAP_SHELF_UNITS.map((unit) => {
              const unitOff = readOffset(unit);
              const unitSelected =
                editMode &&
                (selectedLayoutSlot === unit || selectedSlots.includes(unit));
              return (
                <div
                  key={unit}
                  data-testid={`shop-shelf-${unit}`}
                  data-map-offset-x={unitOff.ox}
                  data-map-offset-y={unitOff.oy}
                  style={{
                    position: "relative",
                    transform: `translate(${unitOff.ox}px, ${unitOff.oy}px)`,
                    zIndex: unitSelected ? 3 : 1,
                  }}
                >
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
                    data-testid={`shop-shelf-${unit}-frame`}
                    onPointerDown={(e) => onShelfFramePointerDown(e, unit)}
                    onPointerMove={onDragPointerMove}
                    onPointerUp={onDragPointerUp}
                    style={{
                      display: "flex",
                      alignItems: "stretch",
                      cursor: editMode ? "grab" : "default",
                      outline: unitSelected
                        ? "2px dashed #2563eb"
                        : editMode
                          ? "1px dashed #94a3b8"
                          : undefined,
                      outlineOffset: 4,
                      borderRadius: 4,
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
                            {renderSpotButton(
                              codeA,
                              false,
                              { left: 0, top: 2 },
                              1,
                            )}
                            {renderSpotButton(
                              codeB,
                              false,
                              { left: 34, top: 18 },
                              2,
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {editMode && (selectedLayoutSlot || selectedSlots.length > 1) && (
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
            {selectedSlots.length > 1
              ? `${selectedSlots.length} spots selected`
              : isShelfUnitCode(selectedLayoutSlot ?? "")
                ? `Edit shelf ${selectedLayoutSlot}`
                : `Edit ${selectedLayoutSlot}`}
          </div>
          {selectedSlots.length <= 1 && selectedLayoutSlot && (
            <>
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
              {!isShelfUnitCode(selectedLayoutSlot) && (
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
                  <span
                    style={{
                      fontSize: 10,
                      color: "#b45309",
                      marginTop: 4,
                      display: "block",
                    }}
                  >
                    Changing code updates QR/sign URLs — prefer display name when
                    possible.
                  </span>
                </label>
              )}
            </>
          )}
          {selectedSlots.length > 1 && (
            <p
              data-testid="shop-map-multi-hint"
              style={{ fontSize: 12, color: "#374151", marginTop: 0 }}
            >
              Drag any selected spot to move all together, then Save.
            </p>
          )}
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
                  if (selectedSlots.length > 1) {
                    const cleared: Record<string, { ox: number; oy: number }> =
                      {};
                    for (const slot of selectedSlots) cleared[slot] = { ox: 0, oy: 0 };
                    setPendingOffsets(cleared);
                    setEditOffsetX(0);
                    setEditOffsetY(0);
                    return;
                  }
                  setEditOffsetX(0);
                  setEditOffsetY(0);
                  setPendingOffsets((prev) =>
                    selectedLayoutSlot
                      ? { ...prev, [selectedLayoutSlot]: { ox: 0, oy: 0 } }
                      : prev,
                  );
                  if (
                    selectedLayoutSlot &&
                    !isShelfUnitCode(selectedLayoutSlot)
                  ) {
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
              Offset: {editOffsetX}px, {editOffsetY}px
              {selectedSlots.length > 1
                ? " — drag selection"
                : isShelfUnitCode(selectedLayoutSlot ?? "")
                  ? " — or drag the shelf frame"
                  : " — or drag the spot"}
            </span>
          </div>
          {selectedSlots.length <= 1 &&
            selectedLayoutSlot &&
            !isShelfUnitCode(selectedLayoutSlot) && (
              <div style={{ marginBottom: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#6b7280" }}>
                  Size (px)
                </span>
                {(["width", "height"] as const).map((dim) => {
                  const isW = dim === "width";
                  const value = isW ? editWidth : editHeight;
                  const setValue = isW ? setEditWidth : setEditHeight;
                  const minusId = isW
                    ? "shop-map-size-w-minus"
                    : "shop-map-size-h-minus";
                  const plusId = isW
                    ? "shop-map-size-w-plus"
                    : "shop-map-size-h-plus";
                  const inputId = isW
                    ? "shop-map-edit-width"
                    : "shop-map-edit-height";
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
                        onClick={() =>
                          nudgeSize(isW ? -SIZE_STEP : 0, isW ? 0 : -SIZE_STEP)
                        }
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
                            Math.max(
                              MIN_SPOT_SIZE,
                              Number(e.target.value) || MIN_SPOT_SIZE,
                            ),
                          )
                        }
                        style={{ ...editInputStyle, marginTop: 0, width: 56 }}
                      />
                      <button
                        type="button"
                        data-testid={plusId}
                        onClick={() =>
                          nudgeSize(isW ? SIZE_STEP : 0, isW ? 0 : SIZE_STEP)
                        }
                        style={nudgeBtnStyle}
                      >
                        +
                      </button>
                    </div>
                  );
                })}
                <span
                  style={{
                    fontSize: 11,
                    color: "#6b7280",
                    display: "block",
                    marginTop: 4,
                  }}
                >
                  {editWidth}×{editHeight}px — or drag the blue corner handle
                </span>
              </div>
            )}
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
              {saving
                ? "Saving…"
                : selectedSlots.length > 1
                  ? `Save ${selectedSlots.length}`
                  : "Save"}
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
