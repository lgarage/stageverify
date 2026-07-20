import {
  forwardRef,
  useMemo,
  useState,
  useCallback,
  useRef,
  useImperativeHandle,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { DeliveryDetails } from "./dispatcher";
import type { ShopStockLocationMapping, StagingLocation } from "./dispatcher/models";
import { firestoreDataService } from "./dispatcher/firestoreService";
import {
  SHOP_MAP_GROUND_SPOT_H,
  SHOP_MAP_GROUND_SPOT_W,
  SHOP_MAP_SHELF_LEVELS,
  SHOP_MAP_SHELF_SPOT_H,
  SHOP_MAP_SHELF_SPOT_W,
  SHOP_MAP_DEFAULT_SHELF_LETTERS,
  allShopMapSpotCodes,
  isShelfUnitCode,
  removeGroundSpotFromExtras,
  removeShelfUnitFromExtras,
  resolveShopMapLayout,
  shelfSpotCode,
  shelfUnitForSpot,
  slotsToHideForDelete,
  withHiddenSlots,
  type ResolvedShopMapLayout,
  type ShopMapLayoutExtras,
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
  /** Constants + persisted extras (ground / shelf units / extra letters). */
  layout?: ResolvedShopMapLayout;
  onAddGroundSpot?: () => Promise<void>;
  onAddShelf?: () => Promise<void>;
  onAddSpotToShelf?: (unit: string) => Promise<void>;
  /** Persist layout extras (hidden slots, adds) after Save / Undo of layout changes. */
  onPersistLayoutExtras?: (next: ShopMapLayoutExtras) => Promise<void>;
  /** Deactivate zone docs for deleted layout slots after Save. */
  onDeactivateSlots?: (slots: string[]) => Promise<void>;
};

export type ShopFloorMapHandle = {
  persistAllPendingEdits: () => Promise<boolean>;
};

const UNDO_STACK_CAP = 30;

type SlotSnapshot = {
  label: string;
  code: string;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  rotationDeg: number;
};

type UndoFrame = {
  pendingOffsets: Record<string, { ox: number; oy: number }>;
  pendingLabels: Record<string, string>;
  pendingRotations: Record<string, number>;
  pendingSizes: Record<string, { w: number; h: number }>;
  pendingHidden: string[];
  editLabel: string;
  editCode: string;
  editOffsetX: number;
  editOffsetY: number;
  editWidth: number;
  editHeight: number;
  editRotationDeg: number;
  selectedLayoutSlot: string | null;
  selectedSlots: string[];
};

const NUDGE_STEP = 8;
const SIZE_STEP = 4;
const ROTATE_STEP = 15;
const MIN_SPOT_SIZE = 24;
const DRAG_CLICK_THRESHOLD_PX = 4;

function normalizeRotationDeg(deg: number): number {
  const n = ((Math.round(deg) % 360) + 360) % 360;
  return n;
}

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

export const ShopFloorMap = forwardRef<ShopFloorMapHandle, Props>(
  function ShopFloorMap(
    {
      occupancyByZoneCode,
      shopStockByCode,
      onOpenDelivery,
      editMode = false,
      zonesByLayoutSlot = {},
      onSaveZone,
      layout: layoutProp,
      onAddGroundSpot,
      onAddShelf,
      onAddSpotToShelf,
      onPersistLayoutExtras,
      onDeactivateSlots,
    },
    ref,
  ) {
  const [pendingHidden, setPendingHidden] = useState<string[]>([]);
  const layout = useMemo(() => {
    const base = layoutProp ?? resolveShopMapLayout();
    if (pendingHidden.length === 0) return base;
    return resolveShopMapLayout(
      withHiddenSlots(base.extras, pendingHidden),
    );
  }, [layoutProp, pendingHidden]);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [addingLayout, setAddingLayout] = useState(false);
  /** Primary slot for the edit panel (single-select / last focused). */
  const [selectedLayoutSlot, setSelectedLayoutSlot] = useState<string | null>(
    null,
  );
  /** All selected layout slots (marquee or multi). */
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  /** Draft offsets held per layout slot for the edit session. */
  const [pendingOffsets, setPendingOffsets] = useState<
    Record<string, { ox: number; oy: number }>
  >({});
  /** Draft display names held per layout slot for the edit session. */
  const [pendingLabels, setPendingLabels] = useState<Record<string, string>>(
    {},
  );
  /** Draft sizes held per layout slot for the edit session. */
  const [pendingSizes, setPendingSizes] = useState<
    Record<string, { w: number; h: number }>
  >({});
  const [editLabel, setEditLabel] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editOffsetX, setEditOffsetX] = useState(0);
  const [editOffsetY, setEditOffsetY] = useState(0);
  const [editWidth, setEditWidth] = useState(SHOP_MAP_GROUND_SPOT_W);
  const [editHeight, setEditHeight] = useState(SHOP_MAP_GROUND_SPOT_H);
  const [sizeInputFocus, setSizeInputFocus] = useState<
    "width" | "height" | null
  >(null);
  const [sizeInputDraft, setSizeInputDraft] = useState("");
  const [editRotationDeg, setEditRotationDeg] = useState(0);
  const [pendingRotations, setPendingRotations] = useState<
    Record<string, number>
  >({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  /** Per-slot snapshot when that object was first selected this edit (Cancel target). */
  const editSessionBySlotRef = useRef<Record<string, SlotSnapshot>>({});
  const undoStackRef = useRef<UndoFrame[]>([]);
  const [undoDepth, setUndoDepth] = useState(0);
  const labelFocusSnapshotRef = useRef("");
  const codeFocusSnapshotRef = useRef("");
  const dragRef = useRef<{
    slots: string[];
    startX: number;
    startY: number;
    bases: Record<string, { ox: number; oy: number }>;
    moved: boolean;
    undoPushed: boolean;
  } | null>(null);
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    baseW: number;
    baseH: number;
    undoPushed: boolean;
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
      const pending = pendingSizes[layoutSlot];
      if (pending) {
        return { width: pending.w, height: pending.h };
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
    [
      editMode,
      editHeight,
      editWidth,
      pendingSizes,
      selectedLayoutSlot,
      zoneForLayoutSlot,
    ],
  );

  const applyPendingSize = useCallback(
    (layoutSlot: string | null, w: number, h: number) => {
      if (!layoutSlot || isShelfUnitCode(layoutSlot)) return;
      const nextW = Math.max(MIN_SPOT_SIZE, w);
      const nextH = Math.max(MIN_SPOT_SIZE, h);
      setEditWidth(nextW);
      setEditHeight(nextH);
      setPendingSizes((prev) => ({
        ...prev,
        [layoutSlot]: { w: nextW, h: nextH },
      }));
    },
    [],
  );

  const readLabel = useCallback(
    (layoutSlot: string): string => {
      if (editMode && selectedLayoutSlot === layoutSlot) {
        return editLabel;
      }
      if (pendingLabels[layoutSlot] !== undefined) {
        return pendingLabels[layoutSlot];
      }
      const zone = zoneForLayoutSlot(layoutSlot);
      return zone?.label ?? layoutSlot;
    },
    [
      editMode,
      editLabel,
      pendingLabels,
      selectedLayoutSlot,
      zoneForLayoutSlot,
    ],
  );

  const readRotation = useCallback(
    (layoutSlot: string): number => {
      if (pendingRotations[layoutSlot] !== undefined) {
        return pendingRotations[layoutSlot];
      }
      if (editMode && selectedLayoutSlot === layoutSlot) {
        return editRotationDeg;
      }
      const zone = zoneForLayoutSlot(layoutSlot);
      return normalizeRotationDeg(zone?.mapRotationDeg ?? 0);
    },
    [
      editMode,
      editRotationDeg,
      pendingRotations,
      selectedLayoutSlot,
      zoneForLayoutSlot,
    ],
  );

  const selectSpotForEdit = useCallback(
    (layoutSlot: string, additive = false) => {
      cancelActiveDrag();
      const zone = zoneForLayoutSlot(layoutSlot);
      const flushedPending = { ...pendingOffsets };
      const flushedLabels = { ...pendingLabels };
      const flushedRotations = { ...pendingRotations };
      const flushedSizes = { ...pendingSizes };
      if (selectedLayoutSlot && selectedLayoutSlot !== layoutSlot) {
        flushedPending[selectedLayoutSlot] = {
          ox: editOffsetX,
          oy: editOffsetY,
        };
        flushedLabels[selectedLayoutSlot] = editLabel;
        flushedRotations[selectedLayoutSlot] = editRotationDeg;
        if (!isShelfUnitCode(selectedLayoutSlot)) {
          flushedSizes[selectedLayoutSlot] = {
            w: editWidth,
            h: editHeight,
          };
        }
      }
      setPendingOffsets(flushedPending);
      setPendingLabels(flushedLabels);
      setPendingRotations(flushedRotations);
      setPendingSizes(flushedSizes);
      const label =
        flushedLabels[layoutSlot] ?? zone?.label ?? layoutSlot;
      const code = zone?.code ?? formatStagingCodeCanonical(layoutSlot);
      const offsetX =
        flushedPending[layoutSlot]?.ox ?? zone?.mapOffsetX ?? 0;
      const offsetY =
        flushedPending[layoutSlot]?.oy ?? zone?.mapOffsetY ?? 0;
      const defaults = isShelfUnitCode(layoutSlot)
        ? { w: 0, h: 0 }
        : defaultSpotSize(layoutSlot);
      const width =
        flushedSizes[layoutSlot]?.w ?? zone?.mapWidth ?? defaults.w;
      const height =
        flushedSizes[layoutSlot]?.h ?? zone?.mapHeight ?? defaults.h;
      const rotationDeg = normalizeRotationDeg(
        flushedRotations[layoutSlot] ?? zone?.mapRotationDeg ?? 0,
      );
      setSelectedLayoutSlot(layoutSlot);
      setSelectedSlots((prev) => {
        if (additive && prev.includes(layoutSlot)) return prev;
        if (additive) return [...prev, layoutSlot];
        return [layoutSlot];
      });
      setEditLabel(label);
      setEditCode(code);
      setEditOffsetX(offsetX);
      setEditOffsetY(offsetY);
      setEditWidth(width);
      setEditHeight(height);
      setEditRotationDeg(rotationDeg);
      setSizeInputFocus(null);
      // Snapshot displayed state once when edit starts on this slot (Cancel baseline).
      if (!editSessionBySlotRef.current[layoutSlot]) {
        editSessionBySlotRef.current[layoutSlot] = {
          label:
            flushedLabels[layoutSlot] ?? zone?.label ?? layoutSlot,
          code: zone?.code ?? formatStagingCodeCanonical(layoutSlot),
          offsetX,
          offsetY,
          width,
          height,
          rotationDeg,
        };
      }
      setSaveError(null);
      setHover(null);
    },
    [
      zoneForLayoutSlot,
      pendingOffsets,
      pendingLabels,
      pendingRotations,
      pendingSizes,
      selectedLayoutSlot,
      editOffsetX,
      editOffsetY,
      editWidth,
      editHeight,
      editLabel,
      editRotationDeg,
    ],
  );

  const captureUndoFrame = useCallback((): UndoFrame => {
    const flushedOffsets = { ...pendingOffsets };
    const flushedLabels = { ...pendingLabels };
    const flushedRotations = { ...pendingRotations };
    const flushedSizes = { ...pendingSizes };
    if (selectedLayoutSlot) {
      flushedOffsets[selectedLayoutSlot] = {
        ox: editOffsetX,
        oy: editOffsetY,
      };
      flushedLabels[selectedLayoutSlot] = editLabel;
      flushedRotations[selectedLayoutSlot] = editRotationDeg;
      if (!isShelfUnitCode(selectedLayoutSlot)) {
        flushedSizes[selectedLayoutSlot] = {
          w: editWidth,
          h: editHeight,
        };
      }
    }
    return {
      pendingOffsets: flushedOffsets,
      pendingLabels: flushedLabels,
      pendingRotations: flushedRotations,
      pendingSizes: flushedSizes,
      pendingHidden: [...pendingHidden],
      editLabel,
      editCode,
      editOffsetX,
      editOffsetY,
      editWidth,
      editHeight,
      editRotationDeg,
      selectedLayoutSlot,
      selectedSlots: [...selectedSlots],
    };
  }, [
    pendingOffsets,
    pendingLabels,
    pendingRotations,
    pendingSizes,
    pendingHidden,
    selectedLayoutSlot,
    selectedSlots,
    editLabel,
    editCode,
    editOffsetX,
    editOffsetY,
    editWidth,
    editHeight,
    editRotationDeg,
  ]);

  const pushUndo = useCallback(() => {
    const frame = captureUndoFrame();
    undoStackRef.current = [
      ...undoStackRef.current.slice(-(UNDO_STACK_CAP - 1)),
      frame,
    ];
    setUndoDepth(undoStackRef.current.length);
  }, [captureUndoFrame]);

  const applyUndoFrame = useCallback((frame: UndoFrame) => {
    setPendingOffsets(frame.pendingOffsets);
    setPendingLabels(frame.pendingLabels);
    setPendingRotations(frame.pendingRotations);
    setPendingSizes(frame.pendingSizes);
    setPendingHidden(frame.pendingHidden);
    setEditLabel(frame.editLabel);
    setEditCode(frame.editCode);
    setEditOffsetX(frame.editOffsetX);
    setEditOffsetY(frame.editOffsetY);
    setEditWidth(frame.editWidth);
    setEditHeight(frame.editHeight);
    setEditRotationDeg(frame.editRotationDeg);
    setSelectedLayoutSlot(frame.selectedLayoutSlot);
    setSelectedSlots(frame.selectedSlots);
    setSaveError(null);
  }, []);

  const undoLastEdit = useCallback(() => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const prev = stack[stack.length - 1];
    undoStackRef.current = stack.slice(0, -1);
    setUndoDepth(undoStackRef.current.length);
    cancelActiveDrag();
    applyUndoFrame(prev);
  }, [applyUndoFrame]);

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
    // Prefer drag.slots primary (index 0) when selection state is still flushing
    const panelSlot =
      selectedLayoutSlot && next[selectedLayoutSlot]
        ? selectedLayoutSlot
        : drag.slots.find((s) => next[s]);
    if (panelSlot && next[panelSlot]) {
      setEditOffsetX(next[panelSlot].ox);
      setEditOffsetY(next[panelSlot].oy);
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
      undoPushed: false,
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
    const slots =
      selectedSlots.length > 0
        ? selectedSlots
        : selectedLayoutSlot
          ? [selectedLayoutSlot]
          : [];
    if (slots.length === 0) {
      setSaveError(null);
      return;
    }
    const hideSet = new Set(
      slots.flatMap((s) => slotsToHideForDelete(s, layout)),
    );
    setPendingOffsets((prev) => {
      const next = { ...prev };
      for (const slot of slots) {
        const snap = editSessionBySlotRef.current[slot];
        if (!snap) {
          delete next[slot];
          continue;
        }
        next[slot] = { ox: snap.offsetX, oy: snap.offsetY };
      }
      return next;
    });
    setPendingLabels((prev) => {
      const next = { ...prev };
      for (const slot of slots) {
        const snap = editSessionBySlotRef.current[slot];
        if (!snap) {
          delete next[slot];
          continue;
        }
        next[slot] = snap.label;
      }
      return next;
    });
    setPendingRotations((prev) => {
      const next = { ...prev };
      for (const slot of slots) {
        const snap = editSessionBySlotRef.current[slot];
        if (!snap) {
          delete next[slot];
          continue;
        }
        next[slot] = snap.rotationDeg;
      }
      return next;
    });
    setPendingSizes((prev) => {
      const next = { ...prev };
      for (const slot of slots) {
        if (isShelfUnitCode(slot)) {
          delete next[slot];
          continue;
        }
        const snap = editSessionBySlotRef.current[slot];
        if (!snap) {
          delete next[slot];
          continue;
        }
        next[slot] = { w: snap.width, h: snap.height };
      }
      return next;
    });
    setPendingHidden((prev) =>
      prev.filter((h) => !hideSet.has(h.toUpperCase().replace(/-/g, ""))),
    );
    for (const slot of slots) {
      delete editSessionBySlotRef.current[slot];
    }
    setSelectedLayoutSlot(null);
    setSelectedSlots([]);
    setSaveError(null);
  }, [selectedSlots, selectedLayoutSlot, layout]);

  const persistEdit = useCallback(async (): Promise<boolean> => {
    if (saving) return false;
    const flushedPending = { ...pendingOffsets };
    const flushedLabels = { ...pendingLabels };
    const flushedRotations = { ...pendingRotations };
    const flushedSizes = { ...pendingSizes };
    if (selectedLayoutSlot) {
      flushedPending[selectedLayoutSlot] = {
        ox: editOffsetX,
        oy: editOffsetY,
      };
      flushedLabels[selectedLayoutSlot] = editLabel;
      flushedRotations[selectedLayoutSlot] = editRotationDeg;
      if (!isShelfUnitCode(selectedLayoutSlot)) {
        flushedSizes[selectedLayoutSlot] = {
          w: editWidth,
          h: editHeight,
        };
      }
    }
    const primarySlot = selectedLayoutSlot;
    const multi =
      selectedSlots.length > 1
        ? selectedSlots
        : primarySlot
          ? [primarySlot]
          : [];
    const slotsToSave = new Set<string>([
      ...Object.keys(flushedPending),
      ...Object.keys(flushedLabels),
      ...Object.keys(flushedRotations),
      ...Object.keys(flushedSizes),
      ...multi,
    ]);
    if (slotsToSave.size === 0 && pendingHidden.length === 0) return true;
    if (pendingHidden.length > 0 && !onPersistLayoutExtras) return false;
    if (slotsToSave.size > 0 && !onSaveZone) return false;
    setSaving(true);
    setSaveError(null);
    try {
      if (pendingHidden.length > 0 && onPersistLayoutExtras) {
        let nextExtras: ShopMapLayoutExtras = layoutProp?.extras ??
          layout.extras ??
          {};
        const baseLayout = resolveShopMapLayout(nextExtras);
        for (const slot of pendingHidden) {
          if (isShelfUnitCode(slot)) {
            nextExtras = removeShelfUnitFromExtras(
              nextExtras,
              slot,
              baseLayout,
            );
          } else if (isGroundLayoutSlot(slot)) {
            nextExtras = removeGroundSpotFromExtras(nextExtras, slot);
          } else {
            nextExtras = withHiddenSlots(nextExtras, [slot]);
          }
        }
        // Also hide all chips when deleting via pendingHidden that already expanded
        nextExtras = withHiddenSlots(nextExtras, pendingHidden);
        await onPersistLayoutExtras(nextExtras);
        if (onDeactivateSlots) {
          await onDeactivateSlots(pendingHidden);
        }
      }
      if (!onSaveZone) {
        setPendingHidden([]);
        setSelectedLayoutSlot(null);
        setSelectedSlots([]);
        return true;
      }
      for (const slot of slotsToSave) {
        const zone = zoneForLayoutSlot(slot);
        const { ox, oy } = flushedPending[slot] ?? {
          ox: zone?.mapOffsetX ?? 0,
          oy: zone?.mapOffsetY ?? 0,
        };
        const baseOx = zone?.mapOffsetX ?? 0;
        const baseOy = zone?.mapOffsetY ?? 0;
        const isPrimary = slot === primarySlot && selectedSlots.length <= 1;
        const shelfUnit = isShelfUnitCode(slot);
        const canRotate = shelfUnit || isGroundLayoutSlot(slot);
        const defaults = shelfUnit
          ? { w: undefined, h: undefined }
          : defaultSpotSize(slot);
        const baseW = zone?.mapWidth ?? defaults.w ?? MIN_SPOT_SIZE;
        const baseH = zone?.mapHeight ?? defaults.h ?? MIN_SPOT_SIZE;
        const patchWidth = shelfUnit
          ? baseW
          : (flushedSizes[slot]?.w ??
            (isPrimary ? editWidth : baseW));
        const patchHeight = shelfUnit
          ? baseH
          : (flushedSizes[slot]?.h ??
            (isPrimary ? editHeight : baseH));
        const rotationDeg = normalizeRotationDeg(
          isPrimary && canRotate
            ? editRotationDeg
            : (flushedRotations[slot] ?? zone?.mapRotationDeg ?? 0),
        );
        const baseRotation = normalizeRotationDeg(zone?.mapRotationDeg ?? 0);
        // Shelf units keep layout-slot code (S1/S2); only display name changes.
        const patchCode = shelfUnit
          ? formatStagingCodeCanonical(slot)
          : isPrimary
            ? formatStagingCodeCanonical(editCode.trim() || slot)
            : (zone?.code ?? formatStagingCodeCanonical(slot));
        const patchLabel = (
          flushedLabels[slot] ??
          zone?.label ??
          slot
        ).trim() || slot;
        const offsetChanged = ox !== baseOx || oy !== baseOy;
        const labelChanged = patchLabel !== (zone?.label ?? slot);
        const codeChanged =
          !shelfUnit &&
          patchCode !== (zone?.code ?? formatStagingCodeCanonical(slot));
        const sizeChanged =
          !shelfUnit && (patchWidth !== baseW || patchHeight !== baseH);
        const rotationChanged = canRotate && rotationDeg !== baseRotation;
        if (
          !offsetChanged &&
          !labelChanged &&
          !codeChanged &&
          !sizeChanged &&
          !rotationChanged
        ) {
          continue;
        }
        await onSaveZone({
          code: slot,
          zoneId: zone?.id,
          patch: {
            code: patchCode,
            label: patchLabel,
            mapOffsetX: ox,
            mapOffsetY: oy,
            ...(shelfUnit
              ? {}
              : { mapWidth: patchWidth, mapHeight: patchHeight }),
            ...(canRotate ? { mapRotationDeg: rotationDeg } : {}),
          },
        });
      }
      for (const slot of slotsToSave) {
        delete editSessionBySlotRef.current[slot];
      }
      setSelectedLayoutSlot(null);
      setSelectedSlots([]);
      setPendingOffsets({});
      setPendingLabels({});
      setPendingRotations({});
      setPendingSizes({});
      setPendingHidden([]);
      undoStackRef.current = [];
      setUndoDepth(0);
      return true;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
      return false;
    } finally {
      setSaving(false);
    }
  }, [
    saving,
    pendingOffsets,
    pendingLabels,
    pendingRotations,
    pendingSizes,
    pendingHidden,
    selectedLayoutSlot,
    editOffsetX,
    editOffsetY,
    editLabel,
    editCode,
    editWidth,
    editHeight,
    editRotationDeg,
    selectedSlots,
    onSaveZone,
    onPersistLayoutExtras,
    onDeactivateSlots,
    layoutProp,
    layout,
    zoneForLayoutSlot,
  ]);

  useImperativeHandle(
    ref,
    () => ({
      persistAllPendingEdits: () => persistEdit(),
    }),
    [persistEdit],
  );

  const markSelectionDeleted = () => {
    const slot = selectedLayoutSlot;
    if (!slot || selectedSlots.length > 1) {
      setSaveError("Select a single ground spot or shelf to delete.");
      return;
    }
    const hide = slotsToHideForDelete(slot, layout);
    for (const code of hide) {
      const display = displayCodeForSlot(code);
      if (occupancyByZoneCode[normalizeStagingCodeKey(display)]) {
        setSaveError(
          `Cannot delete ${display} — a delivery is assigned there.`,
        );
        return;
      }
      if (shopStockByCode[normalizeStagingCodeKey(display)]) {
        setSaveError(
          `Cannot delete ${display} — shop stock is mapped there.`,
        );
        return;
      }
    }
    pushUndo();
    setPendingHidden((prev) => [
      ...new Set([...prev, ...hide.map((h) => h.toUpperCase())]),
    ]);
    setSelectedLayoutSlot(null);
    setSelectedSlots([]);
    setSaveError(null);
  };

  const nudgeRotation = (delta: number) => {
    if (!selectedLayoutSlot) return;
    if (
      !isShelfUnitCode(selectedLayoutSlot) &&
      !isGroundLayoutSlot(selectedLayoutSlot)
    ) {
      return;
    }
    pushUndo();
    setEditRotationDeg((prev) => {
      const next = normalizeRotationDeg(prev + delta);
      setPendingRotations((p) => ({
        ...p,
        [selectedLayoutSlot]: next,
      }));
      return next;
    });
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
      if (!dragRef.current.undoPushed) {
        pushUndo();
        dragRef.current.undoPushed = true;
      }
      dragRef.current.moved = true;
    }
    applyGroupDelta(dx, dy);
  };

  const onDragPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    if (!editMode || !dragRef.current) return;
    if (dragRef.current.moved) {
      suppressClickRef.current = true;
      // Frame before drag was captured at pointer down via pushUndo in beginDrag
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
    for (const code of allShopMapSpotCodes(layout)) {
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
        '[data-testid^="shop-spot-"], [data-testid="shop-map-resize-handle"], [data-testid="shop-map-edit-panel"], [data-testid="shop-map-add-bar"], [data-testid^="shop-shelf-"][data-testid$="-frame"]',
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
    const flushedPending = { ...pendingOffsets };
    const flushedLabels = { ...pendingLabels };
    const flushedRotations = { ...pendingRotations };
    const flushedSizes = { ...pendingSizes };
    if (selectedLayoutSlot) {
      flushedPending[selectedLayoutSlot] = {
        ox: editOffsetX,
        oy: editOffsetY,
      };
      flushedLabels[selectedLayoutSlot] = editLabel;
      flushedRotations[selectedLayoutSlot] = editRotationDeg;
      if (!isShelfUnitCode(selectedLayoutSlot)) {
        flushedSizes[selectedLayoutSlot] = {
          w: editWidth,
          h: editHeight,
        };
      }
    }
    setSelectedSlots(hits);
    setSelectedLayoutSlot(hits[0]);
    const zone = zoneForLayoutSlot(hits[0]);
    const defaults = defaultSpotSize(hits[0]);
    const primaryOx =
      flushedPending[hits[0]]?.ox ?? zone?.mapOffsetX ?? 0;
    const primaryOy =
      flushedPending[hits[0]]?.oy ?? zone?.mapOffsetY ?? 0;
    setEditLabel(`${hits.length} spots selected`);
    setEditCode("");
    setEditOffsetX(primaryOx);
    setEditOffsetY(primaryOy);
    setEditWidth(flushedSizes[hits[0]]?.w ?? zone?.mapWidth ?? defaults.w);
    setEditHeight(flushedSizes[hits[0]]?.h ?? zone?.mapHeight ?? defaults.h);
    setEditRotationDeg(
      normalizeRotationDeg(
        flushedRotations[hits[0]] ?? zone?.mapRotationDeg ?? 0,
      ),
    );
    for (const slot of hits) {
      if (!editSessionBySlotRef.current[slot]) {
        const z = zoneForLayoutSlot(slot);
        const d = defaultSpotSize(slot);
        editSessionBySlotRef.current[slot] = {
          label: z?.label ?? slot,
          code: z?.code ?? formatStagingCodeCanonical(slot),
          offsetX: z?.mapOffsetX ?? 0,
          offsetY: z?.mapOffsetY ?? 0,
          width: z?.mapWidth ?? d.w,
          height: z?.mapHeight ?? d.h,
          rotationDeg: normalizeRotationDeg(z?.mapRotationDeg ?? 0),
        };
      }
    }
    const seeded: Record<string, { ox: number; oy: number }> = {};
    for (const slot of hits) {
      if (flushedPending[slot]) {
        seeded[slot] = flushedPending[slot];
        continue;
      }
      const z = zoneForLayoutSlot(slot);
      seeded[slot] = { ox: z?.mapOffsetX ?? 0, oy: z?.mapOffsetY ?? 0 };
    }
    setPendingOffsets({ ...flushedPending, ...seeded });
    setPendingLabels(flushedLabels);
    setPendingRotations(flushedRotations);
    setPendingSizes(flushedSizes);
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
    pushUndo();
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
    if (!selectedLayoutSlot || isShelfUnitCode(selectedLayoutSlot)) return;
    pushUndo();
    setSizeInputFocus(null);
    applyPendingSize(selectedLayoutSlot, editWidth + dw, editHeight + dh);
  };

  const commitSizeDraft = (dim: "width" | "height", raw: string) => {
    if (!selectedLayoutSlot || isShelfUnitCode(selectedLayoutSlot)) return;
    const parsed = parseInt(raw.trim(), 10);
    const clamped = Number.isFinite(parsed)
      ? Math.max(MIN_SPOT_SIZE, parsed)
      : MIN_SPOT_SIZE;
    const nextW = dim === "width" ? clamped : editWidth;
    const nextH = dim === "height" ? clamped : editHeight;
    if (nextW === editWidth && nextH === editHeight) return;
    pushUndo();
    applyPendingSize(selectedLayoutSlot, nextW, nextH);
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
      undoPushed: false,
    };
  };

  const onResizeHandlePointerMove = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (!editMode || !resizeRef.current || !selectedLayoutSlot) return;
    const { startX, startY, baseW, baseH } = resizeRef.current;
    const dw = e.clientX - startX;
    const dh = e.clientY - startY;
    if (!resizeRef.current.undoPushed && (dw !== 0 || dh !== 0)) {
      pushUndo();
      resizeRef.current.undoPushed = true;
    }
    applyPendingSize(
      selectedLayoutSlot,
      baseW + Math.round(dw),
      baseH + Math.round(dh),
    );
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
    const rotationDeg = ground ? readRotation(layoutSlot) : 0;
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
          data-map-rotation-deg={rotationDeg}
          style={{
            ...spotStyle(colorOf(layoutSlot), ground, width, height),
            position: "absolute",
            zIndex,
            ...offset,
            ...(rotationDeg
              ? {
                  transform: `rotate(${rotationDeg}deg)`,
                  transformOrigin: "center center",
                }
              : {}),
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
    const codes = new Set(
      allShopMapSpotCodes(layout).map((c) => normalizeStagingCodeKey(c)),
    );
    return Object.keys(occupancyByZoneCode)
      .filter((k) => !codes.has(normalizeStagingCodeKey(k)))
      .sort();
  }, [layout, occupancyByZoneCode]);

  const selectedShelfUnit = useMemo(() => {
    if (!selectedLayoutSlot) return null;
    if (isShelfUnitCode(selectedLayoutSlot)) return selectedLayoutSlot;
    return shelfUnitForSpot(selectedLayoutSlot);
  }, [selectedLayoutSlot]);

  const runAdd = async (action: () => Promise<void>) => {
    if (addingLayout) return;
    pushUndo();
    setAddingLayout(true);
    setSaveError(null);
    try {
      await action();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Add failed");
    } finally {
      setAddingLayout(false);
    }
  };

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
            Edit mode — drag spots, marquee-select, drag shelf frames
          </span>
        )}
      </div>

      {editMode && (onAddGroundSpot || onAddShelf || onSaveZone) && (
        <div
          data-testid="shop-map-add-bar"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 10,
            alignItems: "center",
          }}
        >
          <button
            type="button"
            data-testid="shop-map-undo"
            disabled={undoDepth === 0}
            onClick={undoLastEdit}
            style={{
              ...addLayoutBtnStyle,
              opacity: undoDepth === 0 ? 0.45 : 1,
              cursor: undoDepth === 0 ? "not-allowed" : "pointer",
            }}
          >
            Undo
          </button>
          {onAddGroundSpot && (
            <button
              type="button"
              data-testid="shop-map-add-ground"
              disabled={addingLayout || !onSaveZone}
              onClick={() => void runAdd(onAddGroundSpot)}
              style={addLayoutBtnStyle}
            >
              Add ground spot
            </button>
          )}
          {onAddShelf && (
            <button
              type="button"
              data-testid="shop-map-add-shelf"
              disabled={addingLayout || !onSaveZone}
              onClick={() => void runAdd(onAddShelf)}
              style={addLayoutBtnStyle}
            >
              Add shelf
            </button>
          )}
          {onAddSpotToShelf && selectedShelfUnit && (
            <button
              type="button"
              data-testid="shop-map-add-shelf-spot"
              disabled={addingLayout || !onSaveZone}
              onClick={() =>
                void runAdd(() => onAddSpotToShelf(selectedShelfUnit))
              }
              style={addLayoutBtnStyle}
            >
              Add spot to {selectedShelfUnit}
            </button>
          )}
        </div>
      )}

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
          {layout.groundLeft.map((layoutSlot) => (
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
          {/* Top ground row G5–G12 (+ extras) */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {layout.groundTop.map((layoutSlot) => (
              <div
                key={layoutSlot}
                data-testid={`shop-ground-slot-${layoutSlot}`}
                style={groundSlotStyle(layoutSlot)}
              >
                {renderSpotButton(layoutSlot, true)}
              </div>
            ))}
          </div>

          {/* Shelves — flush 6-bay columns; moderate aisle; shift into open floor */}
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
            {layout.shelfUnits.map((unit) => {
              const unitOff = readOffset(unit);
              const unitRot = readRotation(unit);
              const unitTitle = readLabel(unit);
              const unitSelected =
                editMode &&
                (selectedLayoutSlot === unit || selectedSlots.includes(unit));
              const extraLetters = (
                layout.shelfLettersByUnit[unit] ?? []
              ).filter(
                (letter) =>
                  !(
                    SHOP_MAP_DEFAULT_SHELF_LETTERS as readonly string[]
                  ).includes(letter),
              );
              return (
                <div
                  key={unit}
                  data-testid={`shop-shelf-${unit}`}
                  data-map-offset-x={unitOff.ox}
                  data-map-offset-y={unitOff.oy}
                  data-map-rotation-deg={unitRot}
                  style={{
                    position: "relative",
                    transform: `translate(${unitOff.ox}px, ${unitOff.oy}px) rotate(${unitRot}deg)`,
                    transformOrigin: "center center",
                    zIndex: unitSelected ? 3 : 1,
                  }}
                >
                  <div
                    data-testid={`shop-shelf-${unit}-title`}
                    style={{
                      fontWeight: 800,
                      color: NAVY,
                      marginBottom: 6,
                      fontSize: 14,
                      textAlign: "center",
                      minWidth: 52,
                      maxWidth: 140,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={unitTitle}
                  >
                    {unitTitle}
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
                  {extraLetters.length > 0 && (
                    <div
                      data-testid={`shop-shelf-${unit}-extra-spots`}
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 6,
                        marginTop: 8,
                        maxWidth: 160,
                        position: "relative",
                        minHeight: 40,
                      }}
                    >
                      {extraLetters.map((letter, idx) =>
                        renderSpotButton(
                          shelfSpotCode(unit, letter),
                          false,
                          {
                            left: (idx % 3) * 44,
                            top: Math.floor(idx / 3) * 36,
                          },
                          1,
                        ),
                      )}
                    </div>
                  )}
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
                  onFocus={() => {
                    labelFocusSnapshotRef.current = editLabel;
                    pushUndo();
                  }}
                  onBlur={() => {
                    if (!selectedLayoutSlot) return;
                    if (editLabel === labelFocusSnapshotRef.current) {
                      undoStackRef.current = undoStackRef.current.slice(0, -1);
                      setUndoDepth(undoStackRef.current.length);
                      return;
                    }
                    setPendingLabels((prev) => ({
                      ...prev,
                      [selectedLayoutSlot]: editLabel,
                    }));
                  }}
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
                    onFocus={() => {
                      codeFocusSnapshotRef.current = editCode;
                      pushUndo();
                    }}
                    onBlur={() => {
                      if (editCode === codeFocusSnapshotRef.current) {
                        undoStackRef.current = undoStackRef.current.slice(0, -1);
                        setUndoDepth(undoStackRef.current.length);
                      }
                    }}
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
                aria-label="Nudge up"
                onClick={() => nudge(0, -NUDGE_STEP)}
                style={nudgeArrowBtnStyle}
              >
                ↑
              </button>
              <span />
              <button
                type="button"
                data-testid="shop-map-nudge-left"
                aria-label="Nudge left"
                onClick={() => nudge(-NUDGE_STEP, 0)}
                style={nudgeArrowBtnStyle}
              >
                ←
              </button>
              <button
                type="button"
                data-testid="shop-map-nudge-reset"
                aria-label="Reset position and size"
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
                    applyPendingSize(
                      selectedLayoutSlot,
                      defaults.w,
                      defaults.h,
                    );
                  }
                }}
                style={nudgeResetBtnStyle}
                title="Reset position and size"
              >
                ⟲
              </button>
              <button
                type="button"
                data-testid="shop-map-nudge-right"
                aria-label="Nudge right"
                onClick={() => nudge(NUDGE_STEP, 0)}
                style={nudgeArrowBtnStyle}
              >
                →
              </button>
              <span />
              <button
                type="button"
                data-testid="shop-map-nudge-down"
                aria-label="Nudge down"
                onClick={() => nudge(0, NUDGE_STEP)}
                style={nudgeArrowBtnStyle}
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
            (isShelfUnitCode(selectedLayoutSlot) ||
              isGroundLayoutSlot(selectedLayoutSlot)) && (
              <div style={{ marginBottom: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#6b7280" }}>
                  Rotation
                </span>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginTop: 6,
                  }}
                >
                  <button
                    type="button"
                    data-testid="shop-map-rotate-ccw"
                    aria-label="Rotate counter-clockwise"
                    onClick={() => nudgeRotation(-ROTATE_STEP)}
                    style={sizePadBtnStyle}
                  >
                    ↺
                  </button>
                  <span
                    data-testid="shop-map-rotation-deg"
                    style={{
                      fontSize: 14,
                      fontWeight: 800,
                      color: NAVY,
                      minWidth: 52,
                      textAlign: "center",
                      fontFamily: FONT,
                    }}
                  >
                    {editRotationDeg}°
                  </span>
                  <button
                    type="button"
                    data-testid="shop-map-rotate-cw"
                    aria-label="Rotate clockwise"
                    onClick={() => nudgeRotation(ROTATE_STEP)}
                    style={sizePadBtnStyle}
                  >
                    ↻
                  </button>
                  <button
                    type="button"
                    data-testid="shop-map-rotate-reset"
                    aria-label="Reset rotation"
                    onClick={() => nudgeRotation(-editRotationDeg)}
                    style={{ ...sizePadBtnStyle, fontSize: 11, minWidth: 40 }}
                    title="Reset to 0°"
                  >
                    0°
                  </button>
                </div>
              </div>
            )}
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
                        aria-label={isW ? "Decrease width" : "Decrease height"}
                        onClick={() =>
                          nudgeSize(isW ? -SIZE_STEP : 0, isW ? 0 : -SIZE_STEP)
                        }
                        style={sizePadBtnStyle}
                      >
                        −
                      </button>
                      <input
                        data-testid={inputId}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        aria-label={isW ? "Width in pixels" : "Height in pixels"}
                        readOnly={false}
                        value={
                          sizeInputFocus === dim ? sizeInputDraft : String(value)
                        }
                        onFocus={() => {
                          setSizeInputFocus(dim);
                          setSizeInputDraft(String(value));
                        }}
                        onChange={(e) => {
                          if (sizeInputFocus === dim) {
                            setSizeInputDraft(e.target.value);
                          }
                        }}
                        onBlur={() => {
                          if (sizeInputFocus === dim) {
                            commitSizeDraft(dim, sizeInputDraft);
                            setSizeInputFocus(null);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.currentTarget.blur();
                          }
                        }}
                        style={{ ...editInputStyle, marginTop: 0, width: 56 }}
                      />
                      <button
                        type="button"
                        data-testid={plusId}
                        aria-label={isW ? "Increase width" : "Increase height"}
                        onClick={() =>
                          nudgeSize(isW ? SIZE_STEP : 0, isW ? 0 : SIZE_STEP)
                        }
                        style={sizePadBtnStyle}
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
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              data-testid="shop-map-edit-save"
              disabled={
                saving ||
                (!onSaveZone &&
                  !(pendingHidden.length > 0 && onPersistLayoutExtras))
              }
              onClick={() => void persistEdit()}
              style={{
                flex: 1,
                minWidth: 80,
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
            {selectedSlots.length <= 1 && selectedLayoutSlot && (
                <button
                  type="button"
                  data-testid="shop-map-edit-delete"
                  onClick={markSelectionDeleted}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 4,
                    border: "1px solid #fecaca",
                    backgroundColor: "#fef2f2",
                    color: "#991b1b",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: FONT,
                  }}
                >
                  Delete
                </button>
              )}
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
  },
);

const nudgeBtnStyle: CSSProperties = {
  padding: "4px 8px",
  border: "1px solid #d1d5db",
  borderRadius: 4,
  backgroundColor: "#f9fafb",
  cursor: "pointer",
  fontFamily: FONT,
  fontWeight: 700,
};

const nudgeArrowBtnStyle: CSSProperties = {
  ...nudgeBtnStyle,
  fontSize: 18,
  lineHeight: 1,
  minWidth: 36,
  minHeight: 36,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const nudgeResetBtnStyle: CSSProperties = {
  ...nudgeArrowBtnStyle,
  fontSize: 16,
};

const sizePadBtnStyle: CSSProperties = {
  ...nudgeBtnStyle,
  minWidth: 28,
  minHeight: 28,
  fontSize: 16,
  lineHeight: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const addLayoutBtnStyle: CSSProperties = {
  ...nudgeBtnStyle,
  fontSize: 12,
  fontWeight: 700,
  color: NAVY,
  backgroundColor: "#eff6ff",
  border: "1px solid #bfdbfe",
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
