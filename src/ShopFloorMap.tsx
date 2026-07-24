import {
  forwardRef,
  useMemo,
  useState,
  useCallback,
  useRef,
  useEffect,
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
  withYouAreHere,
  withDoor,
  defaultCatchAllMarker,
  withCatchAllMarker,
  withoutCatchAllMarker,
  resolveCatchAllMarker,
  resolveYouAreHereMarker,
  resolveDoorMarker,
  doorHeightFromWidth,
  CATCH_ALL_MIN_SIZE,
  CATCH_ALL_ZONE_CODE,
  DOOR_DEFAULT_SIZE_PX,
  DOOR_MIN_SIZE_PX,
  DOOR_MAX_SIZE_PX,
  YOU_ARE_HERE_DEFAULT_SIZE_PX,
  YOU_ARE_HERE_MIN_SIZE_PX,
  YOU_ARE_HERE_MAX_SIZE_PX,
  type ResolvedShopMapLayout,
  type ShopMapLayoutExtras,
  type ShopMapShelfUnit,
  type YouAreHereMarker,
  type DoorMarker,
  type CatchAllMarker,
} from "./dispatcher/shopMapLayout";
import { formatStagingCodeCanonical } from "./dispatcher/stagingCode";
import {
  SPOT_MAP_COLORS,
  SPOT_MAP_FG,
  CATCH_ALL_SPOT_BG,
  CATCH_ALL_SPOT_FG,
  CATCH_ALL_SPOT_BORDER,
  resolveSpotColor,
  type SpotMapColor,
} from "./dispatcher/resolveSpotColor";
import type { ZoneOccupancySummaryWithReadiness } from "./dispatcher/zoneOccupancyCompute";
import { normalizeStagingCodeKey } from "./dispatcher/stagingCode";
import { resolveDeliveryPoNumber } from "./dispatcher/invoice/invoiceShellDisplayHelpers";

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const NUDGE_SYMBOL_FONT = `${FONT}, "Segoe UI Symbol", "Noto Sans Symbols", sans-serif`;
const NAVY = "#0a3161";
/** Bright yellow for print/vendor YOU ARE HERE circle (wall poster). */
const YOU_ARE_HERE_YELLOW = "#FFE600";
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
  onOpenDelivery: (deliveryId: string, spotCode?: string) => void;
  /** Dispatcher map edit — rename label and nudge/drag spot position. */
  editMode?: boolean;
  /**
   * Vendor / wall-sign preview — shows YOU ARE HERE marker.
   * Hidden on the live dispatcher map when off.
   */
  vendorView?: boolean;
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
  /** Assign-location mode — click open spots to plan staging (mutex with editMode). */
  assignMode?: boolean;
  assignDeliveryId?: string;
  pendingAssignLayoutSlot?: string | null;
  selfPlannedLayoutSlots?: ReadonlySet<string>;
  onAssignSpotClick?: (layoutSlot: string) => void;
  onAssignSpotRefused?: (message: string) => void;
  /** Deep-link highlight — scroll to and outline matching spot (e.g. from drawer chip). */
  focusSpotCode?: string | null;
  /** Packages awaiting management check-in at catch-all. */
  catchAllPendingCount?: number;
  /** Add catch-all map box + backend zone (Settings sync). */
  onAddCatchAllSpot?: () => Promise<void>;
  /** Clear catch-all designation when overlay is deleted in edit session. */
  onRemoveCatchAllSpot?: () => Promise<void>;
  /** View-mode spot click could not open delivery (stale assignment, etc.). */
  onSpotDeliveryUnavailable?: (message: string) => void;
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
  labelRotationDeg: number;
};

type CatchAllSessionSnapshot = {
  marker: CatchAllMarker;
  label: string;
  code: string;
};

type UndoFrame = {
  pendingOffsets: Record<string, { ox: number; oy: number }>;
  pendingLabels: Record<string, string>;
  pendingRotations: Record<string, number>;
  pendingLabelRotations: Record<string, number>;
  pendingSizes: Record<string, { w: number; h: number }>;
  pendingHidden: string[];
  pendingYouAreHere: YouAreHereMarker | null;
  pendingDoor: DoorMarker | null;
  pendingCatchAll: CatchAllMarker | null;
  editLabel: string;
  editCode: string;
  editOffsetX: number;
  editOffsetY: number;
  editWidth: number;
  editHeight: number;
  editRotationDeg: number;
  editLabelRotationDeg: number;
  selectedLayoutSlot: string | null;
  selectedSlots: string[];
  selectedCatchAll: boolean;
};

const NUDGE_STEP = 8;
const SIZE_STEP = 4;
const ROTATE_STEP = 15;
const LABEL_ROTATE_STEP = 90;
const MIN_SPOT_SIZE = 24;
const DRAG_CLICK_THRESHOLD_PX = 4;

function normalizeRotationDeg(deg: number): number {
  const n = ((Math.round(deg) % 360) + 360) % 360;
  return n;
}

/** Inverse-rotate screen delta into a parent's local offset space. */
function rotateDelta(
  dx: number,
  dy: number,
  deg: number,
): { dx: number; dy: number } {
  if (deg === 0) return { dx, dy };
  const rad = (-deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    dx: dx * cos - dy * sin,
    dy: dx * sin + dy * cos,
  };
}

function screenDeltaToLocal(
  slot: string,
  screenDx: number,
  screenDy: number,
  readRot: (layoutSlot: string) => number,
): { dx: number; dy: number } {
  if (isShelfUnitCode(slot) || isGroundLayoutSlot(slot)) {
    return { dx: screenDx, dy: screenDy };
  }
  const unit = shelfUnitForSpot(slot);
  if (!unit) return { dx: screenDx, dy: screenDy };
  return rotateDelta(screenDx, screenDy, readRot(unit));
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
      vendorView = false,
      zonesByLayoutSlot = {},
      onSaveZone,
      layout: layoutProp,
      onAddGroundSpot,
      onAddShelf,
      onAddSpotToShelf,
      onPersistLayoutExtras,
      onDeactivateSlots,
      assignMode = false,
      assignDeliveryId,
      pendingAssignLayoutSlot = null,
      selfPlannedLayoutSlots,
      onAssignSpotClick,
      onAssignSpotRefused,
      focusSpotCode = null,
      catchAllPendingCount = 0,
      onAddCatchAllSpot,
      onRemoveCatchAllSpot,
      onSpotDeliveryUnavailable: _onSpotDeliveryUnavailable,
    },
    ref,
  ) {
    void _onSpotDeliveryUnavailable;
  const [pendingHidden, setPendingHidden] = useState<string[]>([]);
  /** null = use persisted extras; object = pending drag/resize in this edit session. */
  const [pendingYouAreHere, setPendingYouAreHere] =
    useState<YouAreHereMarker | null>(null);
  const [pendingDoor, setPendingDoor] = useState<DoorMarker | null>(null);
  const [pendingCatchAll, setPendingCatchAll] =
    useState<CatchAllMarker | null>(null);
  const formatLastEdited = () =>
    new Date().toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    });
  const [lastEditedLabel, setLastEditedLabel] = useState(formatLastEdited);
  useEffect(() => {
    const onBeforePrint = () => setLastEditedLabel(formatLastEdited());
    window.addEventListener("beforeprint", onBeforePrint);
    return () => window.removeEventListener("beforeprint", onBeforePrint);
  }, []);
  const layout = useMemo(() => {
    const base = layoutProp ?? resolveShopMapLayout();
    if (pendingHidden.length === 0) return base;
    return resolveShopMapLayout(
      withHiddenSlots(base.extras, pendingHidden),
    );
  }, [layoutProp, pendingHidden]);
  const persistedYouAreHere: YouAreHereMarker = resolveYouAreHereMarker(
    layout.extras,
  ) ?? {
    ox: 0,
    oy: 0,
    sizePx: YOU_ARE_HERE_DEFAULT_SIZE_PX,
  };
  const youAreHere = pendingYouAreHere ?? persistedYouAreHere;
  const persistedDoor: DoorMarker =
    resolveDoorMarker(layout.extras) ?? {
      ox: 0,
      oy: 0,
      sizePx: DOOR_DEFAULT_SIZE_PX,
      rotationDeg: 0,
    };
  const door = pendingDoor ?? persistedDoor;
  const doorHeightPx = doorHeightFromWidth(door.sizePx);
  /** Drag/resize only while editing inside Vendor view (marker visibility is CSS). */
  const canEditYouAreHere = editMode && vendorView;
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [addingLayout, setAddingLayout] = useState(false);
  /** Primary slot for the edit panel (single-select / last focused). */
  const [selectedLayoutSlot, setSelectedLayoutSlot] = useState<string | null>(
    null,
  );
  /** All selected layout slots (marquee or multi). */
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  /** Catch-all overlay selected for the edit side panel. */
  const [selectedCatchAll, setSelectedCatchAll] = useState(false);
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
  const [editLabelRotationDeg, setEditLabelRotationDeg] = useState(0);
  const [pendingRotations, setPendingRotations] = useState<
    Record<string, number>
  >({});
  const [pendingLabelRotations, setPendingLabelRotations] = useState<
    Record<string, number>
  >({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Edit-session overlay — hidden in view mode; hydrates from saved extras in edit. */
  const catchAllMarker = useMemo(() => {
    if (!editMode || !pendingCatchAll) return null;
    if (selectedCatchAll) {
      return {
        ox: editOffsetX,
        oy: editOffsetY,
        width: editWidth,
        height: editHeight,
      };
    }
    return pendingCatchAll;
  }, [
    editMode,
    pendingCatchAll,
    selectedCatchAll,
    editOffsetX,
    editOffsetY,
    editWidth,
    editHeight,
  ]);
  const [marquee, setMarquee] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  /** Per-slot snapshot when that object was first selected this edit (Cancel target). */
  const editSessionBySlotRef = useRef<Record<string, SlotSnapshot>>({});
  /** Catch-all overlay snapshot when edit panel opens (Cancel target). */
  const catchAllSessionSnapshotRef = useRef<CatchAllSessionSnapshot | null>(
    null,
  );
  /** True after Delete catch-all in this edit session — Done/Save must strip extras.catchAll. */
  const [catchAllRemovedInSession, setCatchAllRemovedInSession] =
    useState(false);
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
  const yahDragRef = useRef<{
    startX: number;
    startY: number;
    baseOx: number;
    baseOy: number;
    baseSize: number;
    undoPushed: boolean;
  } | null>(null);
  const yahResizeRef = useRef<{
    startX: number;
    startY: number;
    baseSize: number;
    baseOx: number;
    baseOy: number;
    undoPushed: boolean;
  } | null>(null);
  const doorDragRef = useRef<{
    startX: number;
    startY: number;
    baseOx: number;
    baseOy: number;
    baseSizePx: number;
    baseRotationDeg: number;
    undoPushed: boolean;
  } | null>(null);
  const doorResizeRef = useRef<{
    startX: number;
    startY: number;
    baseSizePx: number;
    baseOx: number;
    baseOy: number;
    baseRotationDeg: number;
    undoPushed: boolean;
  } | null>(null);
  const catchAllDragRef = useRef<{
    startX: number;
    startY: number;
    baseOx: number;
    baseOy: number;
    baseWidth: number;
    baseHeight: number;
    undoPushed: boolean;
  } | null>(null);
  const catchAllResizeRef = useRef<{
    startX: number;
    startY: number;
    baseWidth: number;
    baseHeight: number;
    baseOx: number;
    baseOy: number;
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

  const catchAllZone = useMemo(
    () => zoneForLayoutSlot(CATCH_ALL_ZONE_CODE),
    [zoneForLayoutSlot],
  );

  const prevEditModeRef = useRef(false);
  useEffect(() => {
    if (editMode && !prevEditModeRef.current) {
      if (catchAllZone) {
        const saved = resolveCatchAllMarker(layout.extras);
        if (saved) {
          setPendingCatchAll(saved);
        }
      }
    }
    if (!editMode) {
      setPendingYouAreHere(null);
      setPendingDoor(null);
      setPendingCatchAll(null);
      setSelectedCatchAll(false);
      catchAllSessionSnapshotRef.current = null;
      setCatchAllRemovedInSession(false);
      yahDragRef.current = null;
      yahResizeRef.current = null;
      doorDragRef.current = null;
      doorResizeRef.current = null;
      catchAllDragRef.current = null;
      catchAllResizeRef.current = null;
    }
    prevEditModeRef.current = editMode;
  }, [editMode, catchAllZone, layout.extras]);

  const applyCatchAllGeometry = useCallback(
    (ox: number, oy: number, width: number, height: number) => {
      const next: CatchAllMarker = {
        ox: Math.round(ox),
        oy: Math.round(oy),
        width: Math.max(CATCH_ALL_MIN_SIZE, Math.round(width)),
        height: Math.max(CATCH_ALL_MIN_SIZE, Math.round(height)),
      };
      setPendingCatchAll(next);
      if (selectedCatchAll) {
        setEditOffsetX(next.ox);
        setEditOffsetY(next.oy);
        setEditWidth(next.width);
        setEditHeight(next.height);
      }
      return next;
    },
    [selectedCatchAll],
  );

  const displayCodeForSlot = useCallback(
    (layoutSlot: string) => {
      const zone = zoneForLayoutSlot(layoutSlot);
      return zone?.code ?? formatStagingCodeCanonical(layoutSlot);
    },
    [zoneForLayoutSlot],
  );

  const focusLayoutSlot = useMemo(() => {
    const raw = focusSpotCode?.trim();
    if (!raw) return null;
    const key = normalizeStagingCodeKey(raw);
    for (const slot of allShopMapSpotCodes(layout)) {
      if (normalizeStagingCodeKey(displayCodeForSlot(slot)) === key) {
        return slot;
      }
    }
    return null;
  }, [focusSpotCode, layout, displayCodeForSlot]);

  useEffect(() => {
    if (!focusLayoutSlot) return;
    const el = spotElRefs.current[focusLayoutSlot];
    if (!el) return;
    const timer = window.setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [focusLayoutSlot]);

  const cancelActiveDrag = () => {
    dragRef.current = null;
    resizeRef.current = null;
    yahDragRef.current = null;
    yahResizeRef.current = null;
    doorDragRef.current = null;
    doorResizeRef.current = null;
    catchAllDragRef.current = null;
    catchAllResizeRef.current = null;
    marqueeRef.current = null;
  };

  const onYouAreHerePointerDown = (
    e: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (!canEditYouAreHere) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    yahDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseOx: youAreHere.ox,
      baseOy: youAreHere.oy,
      baseSize: youAreHere.sizePx,
      undoPushed: false,
    };
  };

  const onYouAreHerePointerMove = (
    e: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (!canEditYouAreHere || !yahDragRef.current) return;
    const { startX, startY, baseOx, baseOy, baseSize } = yahDragRef.current;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (
      !yahDragRef.current.undoPushed &&
      Math.hypot(dx, dy) >= DRAG_CLICK_THRESHOLD_PX
    ) {
      pushUndo();
      yahDragRef.current.undoPushed = true;
    }
    setPendingYouAreHere({
      ox: baseOx + Math.round(dx),
      oy: baseOy + Math.round(dy),
      sizePx: baseSize,
    });
  };

  const onYouAreHerePointerUp = (
    e: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (!yahDragRef.current) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    yahDragRef.current = null;
  };

  const onYouAreHereResizePointerDown = (
    e: ReactPointerEvent<HTMLSpanElement>,
  ) => {
    if (!canEditYouAreHere) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    yahResizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseSize: youAreHere.sizePx,
      baseOx: youAreHere.ox,
      baseOy: youAreHere.oy,
      undoPushed: false,
    };
  };

  const onYouAreHereResizePointerMove = (
    e: ReactPointerEvent<HTMLSpanElement>,
  ) => {
    if (!canEditYouAreHere || !yahResizeRef.current) return;
    const { startX, startY, baseSize, baseOx, baseOy } = yahResizeRef.current;
    const delta = Math.max(e.clientX - startX, e.clientY - startY);
    if (
      !yahResizeRef.current.undoPushed &&
      Math.abs(delta) >= DRAG_CLICK_THRESHOLD_PX
    ) {
      pushUndo();
      yahResizeRef.current.undoPushed = true;
    }
    const next = Math.max(
      YOU_ARE_HERE_MIN_SIZE_PX,
      Math.min(YOU_ARE_HERE_MAX_SIZE_PX, baseSize + Math.round(delta)),
    );
    setPendingYouAreHere({
      ox: baseOx,
      oy: baseOy,
      sizePx: next,
    });
  };

  const onYouAreHereResizePointerUp = (
    e: ReactPointerEvent<HTMLSpanElement>,
  ) => {
    if (!yahResizeRef.current) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    yahResizeRef.current = null;
  };

  const onDoorPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!editMode) return;
    const target = e.target as HTMLElement;
    if (
      target.closest('[data-testid="shop-map-door-resize-handle"]') ||
      target.closest('[data-testid="shop-map-door-rotate-cw"]') ||
      target.closest('[data-testid="shop-map-door-rotate-ccw"]')
    ) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    doorDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseOx: door.ox,
      baseOy: door.oy,
      baseSizePx: door.sizePx,
      baseRotationDeg: door.rotationDeg,
      undoPushed: false,
    };
  };

  const onDoorPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!editMode || !doorDragRef.current) return;
    const { startX, startY, baseOx, baseOy, baseSizePx, baseRotationDeg } =
      doorDragRef.current;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (
      !doorDragRef.current.undoPushed &&
      Math.hypot(dx, dy) >= DRAG_CLICK_THRESHOLD_PX
    ) {
      pushUndo();
      doorDragRef.current.undoPushed = true;
    }
    setPendingDoor({
      ox: baseOx + Math.round(dx),
      oy: baseOy + Math.round(dy),
      sizePx: baseSizePx,
      rotationDeg: baseRotationDeg,
    });
  };

  const onDoorPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!doorDragRef.current) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    doorDragRef.current = null;
  };

  const onDoorResizePointerDown = (
    e: ReactPointerEvent<HTMLSpanElement>,
  ) => {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    doorResizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseSizePx: door.sizePx,
      baseOx: door.ox,
      baseOy: door.oy,
      baseRotationDeg: door.rotationDeg,
      undoPushed: false,
    };
  };

  const onDoorResizePointerMove = (
    e: ReactPointerEvent<HTMLSpanElement>,
  ) => {
    if (!editMode || !doorResizeRef.current) return;
    const { startX, startY, baseSizePx, baseOx, baseOy, baseRotationDeg } =
      doorResizeRef.current;
    const delta = Math.max(e.clientX - startX, e.clientY - startY);
    if (
      !doorResizeRef.current.undoPushed &&
      Math.abs(delta) >= DRAG_CLICK_THRESHOLD_PX
    ) {
      pushUndo();
      doorResizeRef.current.undoPushed = true;
    }
    const next = Math.max(
      DOOR_MIN_SIZE_PX,
      Math.min(DOOR_MAX_SIZE_PX, baseSizePx + Math.round(delta)),
    );
    setPendingDoor({
      ox: baseOx,
      oy: baseOy,
      sizePx: next,
      rotationDeg: baseRotationDeg,
    });
  };

  const onDoorResizePointerUp = (
    e: ReactPointerEvent<HTMLSpanElement>,
  ) => {
    if (!doorResizeRef.current) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    doorResizeRef.current = null;
  };

  const onCatchAllPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!editMode || !catchAllMarker || !pendingCatchAll) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-testid="shop-map-catch-all-resize-handle"]')) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    selectCatchAllForEdit();
    e.currentTarget.setPointerCapture(e.pointerId);
    catchAllDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseOx: catchAllMarker.ox,
      baseOy: catchAllMarker.oy,
      baseWidth: catchAllMarker.width,
      baseHeight: catchAllMarker.height,
      undoPushed: false,
    };
  };

  const onCatchAllPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!editMode || !catchAllDragRef.current) return;
    const { startX, startY, baseOx, baseOy, baseWidth, baseHeight } =
      catchAllDragRef.current;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (
      !catchAllDragRef.current.undoPushed &&
      Math.hypot(dx, dy) >= DRAG_CLICK_THRESHOLD_PX
    ) {
      pushUndo();
      catchAllDragRef.current.undoPushed = true;
    }
    applyCatchAllGeometry(
      baseOx + Math.round(dx),
      baseOy + Math.round(dy),
      baseWidth,
      baseHeight,
    );
  };

  const onCatchAllPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!catchAllDragRef.current) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    catchAllDragRef.current = null;
  };

  const onCatchAllResizePointerDown = (
    e: ReactPointerEvent<HTMLSpanElement>,
  ) => {
    if (!editMode || !catchAllMarker || !pendingCatchAll) return;
    e.preventDefault();
    e.stopPropagation();
    selectCatchAllForEdit();
    e.currentTarget.setPointerCapture(e.pointerId);
    catchAllResizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseWidth: catchAllMarker.width,
      baseHeight: catchAllMarker.height,
      baseOx: catchAllMarker.ox,
      baseOy: catchAllMarker.oy,
      undoPushed: false,
    };
  };

  const onCatchAllResizePointerMove = (
    e: ReactPointerEvent<HTMLSpanElement>,
  ) => {
    if (!editMode || !catchAllResizeRef.current) return;
    const { startX, startY, baseWidth, baseHeight, baseOx, baseOy } =
      catchAllResizeRef.current;
    const dw = e.clientX - startX;
    const dh = e.clientY - startY;
    if (
      !catchAllResizeRef.current.undoPushed &&
      (dw !== 0 || dh !== 0)
    ) {
      pushUndo();
      catchAllResizeRef.current.undoPushed = true;
    }
    applyCatchAllGeometry(
      baseOx,
      baseOy,
      Math.max(CATCH_ALL_MIN_SIZE, baseWidth + Math.round(dw)),
      Math.max(CATCH_ALL_MIN_SIZE, baseHeight + Math.round(dh)),
    );
  };

  const onCatchAllResizePointerUp = (
    e: ReactPointerEvent<HTMLSpanElement>,
  ) => {
    if (!catchAllResizeRef.current) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    catchAllResizeRef.current = null;
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

  const readLabelRotation = useCallback(
    (unit: string): number => {
      if (pendingLabelRotations[unit] !== undefined) {
        return pendingLabelRotations[unit];
      }
      if (
        editMode &&
        selectedLayoutSlot === unit &&
        isShelfUnitCode(unit)
      ) {
        return editLabelRotationDeg;
      }
      const zone = zoneForLayoutSlot(unit);
      return normalizeRotationDeg(zone?.mapLabelRotationDeg ?? 0);
    },
    [
      editMode,
      editLabelRotationDeg,
      pendingLabelRotations,
      selectedLayoutSlot,
      zoneForLayoutSlot,
    ],
  );

  const selectCatchAllForEdit = useCallback(
    (markerOverride?: CatchAllMarker) => {
      const marker = markerOverride ?? pendingCatchAll;
      if (!marker) return;
      cancelActiveDrag();
      if (selectedLayoutSlot) {
        const flushedPending = { ...pendingOffsets };
        const flushedLabels = { ...pendingLabels };
        const flushedRotations = { ...pendingRotations };
        const flushedLabelRotations = { ...pendingLabelRotations };
        const flushedSizes = { ...pendingSizes };
        flushedPending[selectedLayoutSlot] = {
          ox: editOffsetX,
          oy: editOffsetY,
        };
        flushedLabels[selectedLayoutSlot] = editLabel;
        flushedRotations[selectedLayoutSlot] = editRotationDeg;
        if (isShelfUnitCode(selectedLayoutSlot)) {
          flushedLabelRotations[selectedLayoutSlot] = editLabelRotationDeg;
        }
        if (!isShelfUnitCode(selectedLayoutSlot)) {
          flushedSizes[selectedLayoutSlot] = {
            w: editWidth,
            h: editHeight,
          };
        }
        setPendingOffsets(flushedPending);
        setPendingLabels(flushedLabels);
        setPendingRotations(flushedRotations);
        setPendingLabelRotations(flushedLabelRotations);
        setPendingSizes(flushedSizes);
      }
      setSelectedLayoutSlot(null);
      setSelectedSlots([]);
      setSelectedCatchAll(true);
      const label = catchAllZone?.label ?? "Catch-all";
      const code =
        catchAllZone?.code ?? formatStagingCodeCanonical(CATCH_ALL_ZONE_CODE);
      setEditLabel(label);
      setEditCode(code);
      setEditOffsetX(marker.ox);
      setEditOffsetY(marker.oy);
      setEditWidth(marker.width);
      setEditHeight(marker.height);
      setEditRotationDeg(0);
      setEditLabelRotationDeg(0);
      setSizeInputFocus(null);
      setPendingCatchAll(marker);
      if (!catchAllSessionSnapshotRef.current) {
        catchAllSessionSnapshotRef.current = {
          marker: { ...marker },
          label,
          code,
        };
      }
      setSaveError(null);
      setHover(null);
    },
    [
      pendingCatchAll,
      selectedLayoutSlot,
      pendingOffsets,
      pendingLabels,
      pendingRotations,
      pendingLabelRotations,
      pendingSizes,
      editOffsetX,
      editOffsetY,
      editLabel,
      editCode,
      editWidth,
      editHeight,
      editRotationDeg,
      editLabelRotationDeg,
      catchAllZone,
    ],
  );

  const selectSpotForEdit = useCallback(
    (layoutSlot: string, additive = false) => {
      cancelActiveDrag();
      if (selectedCatchAll && pendingCatchAll) {
        applyCatchAllGeometry(
          editOffsetX,
          editOffsetY,
          editWidth,
          editHeight,
        );
        setSelectedCatchAll(false);
      }
      const zone = zoneForLayoutSlot(layoutSlot);
      const flushedPending = { ...pendingOffsets };
      const flushedLabels = { ...pendingLabels };
      const flushedRotations = { ...pendingRotations };
      const flushedLabelRotations = { ...pendingLabelRotations };
      const flushedSizes = { ...pendingSizes };
      if (selectedLayoutSlot && selectedLayoutSlot !== layoutSlot) {
        flushedPending[selectedLayoutSlot] = {
          ox: editOffsetX,
          oy: editOffsetY,
        };
        flushedLabels[selectedLayoutSlot] = editLabel;
        flushedRotations[selectedLayoutSlot] = editRotationDeg;
        if (isShelfUnitCode(selectedLayoutSlot)) {
          flushedLabelRotations[selectedLayoutSlot] = editLabelRotationDeg;
        }
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
      setPendingLabelRotations(flushedLabelRotations);
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
      const labelRotationDeg = isShelfUnitCode(layoutSlot)
        ? normalizeRotationDeg(
            flushedLabelRotations[layoutSlot] ??
              zone?.mapLabelRotationDeg ??
              0,
          )
        : 0;
      setSelectedLayoutSlot(layoutSlot);
      setSelectedSlots((prev) => {
        if (additive && prev.includes(layoutSlot)) return prev;
        if (additive) return [...prev, layoutSlot];
        return [layoutSlot];
      });
      setSelectedCatchAll(false);
      setEditLabel(label);
      setEditCode(code);
      setEditOffsetX(offsetX);
      setEditOffsetY(offsetY);
      setEditWidth(width);
      setEditHeight(height);
      setEditRotationDeg(rotationDeg);
      setEditLabelRotationDeg(labelRotationDeg);
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
          labelRotationDeg,
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
      pendingLabelRotations,
      pendingSizes,
      selectedLayoutSlot,
      editOffsetX,
      editOffsetY,
      editWidth,
      editHeight,
      editLabel,
      editRotationDeg,
      editLabelRotationDeg,
      selectedCatchAll,
      pendingCatchAll,
      applyCatchAllGeometry,
    ],
  );

  const captureUndoFrame = useCallback((): UndoFrame => {
    const flushedOffsets = { ...pendingOffsets };
    const flushedLabels = { ...pendingLabels };
    const flushedRotations = { ...pendingRotations };
    const flushedLabelRotations = { ...pendingLabelRotations };
    const flushedSizes = { ...pendingSizes };
    if (selectedLayoutSlot) {
      flushedOffsets[selectedLayoutSlot] = {
        ox: editOffsetX,
        oy: editOffsetY,
      };
      flushedLabels[selectedLayoutSlot] = editLabel;
      flushedRotations[selectedLayoutSlot] = editRotationDeg;
      if (isShelfUnitCode(selectedLayoutSlot)) {
        flushedLabelRotations[selectedLayoutSlot] = editLabelRotationDeg;
      }
      if (!isShelfUnitCode(selectedLayoutSlot)) {
        flushedSizes[selectedLayoutSlot] = {
          w: editWidth,
          h: editHeight,
        };
      }
    }
    const catchAllSnapshot =
      selectedCatchAll && pendingCatchAll
        ? {
            ox: editOffsetX,
            oy: editOffsetY,
            width: editWidth,
            height: editHeight,
          }
        : pendingCatchAll
          ? { ...pendingCatchAll }
          : null;
    return {
      pendingOffsets: flushedOffsets,
      pendingLabels: flushedLabels,
      pendingRotations: flushedRotations,
      pendingLabelRotations: flushedLabelRotations,
      pendingSizes: flushedSizes,
      pendingHidden: [...pendingHidden],
      pendingYouAreHere: pendingYouAreHere
        ? { ...pendingYouAreHere }
        : null,
      pendingDoor: pendingDoor ? { ...pendingDoor } : null,
      pendingCatchAll: catchAllSnapshot,
      editLabel,
      editCode,
      editOffsetX,
      editOffsetY,
      editWidth,
      editHeight,
      editRotationDeg,
      editLabelRotationDeg,
      selectedLayoutSlot,
      selectedSlots: [...selectedSlots],
      selectedCatchAll,
    };
  }, [
    pendingOffsets,
    pendingLabels,
    pendingRotations,
    pendingLabelRotations,
    pendingSizes,
    pendingHidden,
    pendingYouAreHere,
    pendingDoor,
    pendingCatchAll,
    selectedLayoutSlot,
    selectedSlots,
    selectedCatchAll,
    editLabel,
    editCode,
    editOffsetX,
    editOffsetY,
    editWidth,
    editHeight,
    editRotationDeg,
    editLabelRotationDeg,
  ]);

  const pushUndo = useCallback(() => {
    const frame = captureUndoFrame();
    undoStackRef.current = [
      ...undoStackRef.current.slice(-(UNDO_STACK_CAP - 1)),
      frame,
    ];
    setUndoDepth(undoStackRef.current.length);
  }, [captureUndoFrame]);

  const nudgeDoorRotation = useCallback(
    (deltaDeg: number) => {
      if (!editMode) return;
      pushUndo();
      setPendingDoor((prev) => {
        const base = prev ?? persistedDoor;
        return {
          ...base,
          rotationDeg: normalizeRotationDeg(base.rotationDeg + deltaDeg),
        };
      });
    },
    [editMode, pushUndo, persistedDoor],
  );

  const applyUndoFrame = useCallback((frame: UndoFrame) => {
    setPendingOffsets(frame.pendingOffsets);
    setPendingLabels(frame.pendingLabels);
    setPendingRotations(frame.pendingRotations);
    setPendingLabelRotations(frame.pendingLabelRotations);
    setPendingSizes(frame.pendingSizes);
    setPendingHidden(frame.pendingHidden);
    setPendingYouAreHere(
      frame.pendingYouAreHere ? { ...frame.pendingYouAreHere } : null,
    );
    setPendingDoor(frame.pendingDoor ? { ...frame.pendingDoor } : null);
    setPendingCatchAll(
      frame.pendingCatchAll ? { ...frame.pendingCatchAll } : null,
    );
    if (frame.pendingCatchAll) {
      setCatchAllRemovedInSession(false);
    }
    setEditLabel(frame.editLabel);
    setEditCode(frame.editCode);
    setEditOffsetX(frame.editOffsetX);
    setEditOffsetY(frame.editOffsetY);
    setEditWidth(frame.editWidth);
    setEditHeight(frame.editHeight);
    setEditRotationDeg(frame.editRotationDeg);
    setEditLabelRotationDeg(frame.editLabelRotationDeg);
    setSelectedLayoutSlot(frame.selectedLayoutSlot);
    setSelectedSlots(frame.selectedSlots);
    setSelectedCatchAll(frame.selectedCatchAll);
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
      const local = screenDeltaToLocal(slot, dx, dy, readRotation);
      next[slot] = {
        ox: base.ox + Math.round(local.dx),
        oy: base.oy + Math.round(local.dy),
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
    if (selectedCatchAll) {
      const snap = catchAllSessionSnapshotRef.current;
      if (snap) {
        setPendingCatchAll({ ...snap.marker });
        setEditLabel(snap.label);
        setEditCode(snap.code);
        setEditOffsetX(snap.marker.ox);
        setEditOffsetY(snap.marker.oy);
        setEditWidth(snap.marker.width);
        setEditHeight(snap.marker.height);
      }
      catchAllSessionSnapshotRef.current = null;
      setSelectedCatchAll(false);
      setSaveError(null);
      return;
    }
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
    setPendingLabelRotations((prev) => {
      const next = { ...prev };
      for (const slot of slots) {
        if (!isShelfUnitCode(slot)) {
          delete next[slot];
          continue;
        }
        const snap = editSessionBySlotRef.current[slot];
        if (!snap) {
          delete next[slot];
          continue;
        }
        next[slot] = snap.labelRotationDeg;
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
  }, [selectedSlots, selectedLayoutSlot, selectedCatchAll, layout]);

  const persistEdit = useCallback(async (): Promise<boolean> => {
    if (saving) return false;
    const flushedPending = { ...pendingOffsets };
    const flushedLabels = { ...pendingLabels };
    const flushedRotations = { ...pendingRotations };
    const flushedLabelRotations = { ...pendingLabelRotations };
    const flushedSizes = { ...pendingSizes };
    if (selectedCatchAll && pendingCatchAll) {
      applyCatchAllGeometry(editOffsetX, editOffsetY, editWidth, editHeight);
    }
    if (selectedLayoutSlot) {
      flushedPending[selectedLayoutSlot] = {
        ox: editOffsetX,
        oy: editOffsetY,
      };
      flushedLabels[selectedLayoutSlot] = editLabel;
      flushedRotations[selectedLayoutSlot] = editRotationDeg;
      if (isShelfUnitCode(selectedLayoutSlot)) {
        flushedLabelRotations[selectedLayoutSlot] = editLabelRotationDeg;
      }
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
      ...Object.keys(flushedLabelRotations),
      ...Object.keys(flushedSizes),
      ...multi,
    ]);
    const yahPending = pendingYouAreHere !== null;
    const doorPending = pendingDoor !== null;
    const catchAllPending = pendingCatchAll !== null;
    const catchAllShouldPersist = catchAllPending && !!catchAllZone;
    if (
      slotsToSave.size === 0 &&
      pendingHidden.length === 0 &&
      !yahPending &&
      !doorPending &&
      !catchAllShouldPersist &&
      !catchAllRemovedInSession
    ) {
      return true;
    }
    if (
      (pendingHidden.length > 0 || yahPending || doorPending) &&
      !onPersistLayoutExtras
    ) {
      return false;
    }
    if (catchAllShouldPersist && !onPersistLayoutExtras) return false;
    if (slotsToSave.size > 0 && !onSaveZone) return false;
    if (selectedCatchAll && catchAllPending && !onSaveZone) return false;
    setSaving(true);
    setSaveError(null);
    try {
      let workingExtras: ShopMapLayoutExtras = {
        ...(layoutProp?.extras ?? layout.extras ?? {}),
      };
      let shouldPersistExtras = false;
      if (catchAllRemovedInSession && onPersistLayoutExtras) {
        workingExtras = withoutCatchAllMarker(workingExtras);
        shouldPersistExtras = true;
      }
      if (catchAllShouldPersist && onPersistLayoutExtras) {
        const marker: CatchAllMarker =
          selectedCatchAll && pendingCatchAll
            ? {
                ox: Math.round(editOffsetX),
                oy: Math.round(editOffsetY),
                width: Math.max(CATCH_ALL_MIN_SIZE, Math.round(editWidth)),
                height: Math.max(CATCH_ALL_MIN_SIZE, Math.round(editHeight)),
              }
            : pendingCatchAll!;
        workingExtras = withCatchAllMarker(workingExtras, marker);
        setCatchAllRemovedInSession(false);
        shouldPersistExtras = true;
        setPendingCatchAll(marker);
        const patchLabel = (
          selectedCatchAll
            ? editLabel.trim()
            : (catchAllZone?.label ?? "Catch-all")
        ) || "Catch-all";
        const patchCode = formatStagingCodeCanonical(
          selectedCatchAll
            ? editCode.trim() || CATCH_ALL_ZONE_CODE
            : (catchAllZone?.code ?? CATCH_ALL_ZONE_CODE),
        );
        if (selectedCatchAll && onSaveZone) {
          const zone = catchAllZone;
          const labelChanged = patchLabel !== (zone?.label ?? "Catch-all");
          const codeChanged =
            patchCode !==
            formatStagingCodeCanonical(zone?.code ?? CATCH_ALL_ZONE_CODE);
          if (labelChanged || codeChanged) {
            await onSaveZone({
              code: CATCH_ALL_ZONE_CODE,
              zoneId: zone?.id,
              patch: {
                code: patchCode,
                label: patchLabel,
              },
            });
          }
        }
        catchAllSessionSnapshotRef.current = {
          marker: { ...marker },
          label: patchLabel,
          code: patchCode,
        };
        setSelectedCatchAll(false);
      }
      if (
        (pendingHidden.length > 0 || yahPending || doorPending) &&
        onPersistLayoutExtras
      ) {
        if (pendingHidden.length > 0) {
          const baseLayout = resolveShopMapLayout(workingExtras);
          for (const slot of pendingHidden) {
            if (isShelfUnitCode(slot)) {
              workingExtras = removeShelfUnitFromExtras(
                workingExtras,
                slot,
                baseLayout,
              );
            } else if (isGroundLayoutSlot(slot)) {
              workingExtras = removeGroundSpotFromExtras(workingExtras, slot);
            } else {
              workingExtras = withHiddenSlots(workingExtras, [slot]);
            }
          }
          workingExtras = withHiddenSlots(workingExtras, pendingHidden);
        }
        if (yahPending && pendingYouAreHere) {
          workingExtras = withYouAreHere(workingExtras, pendingYouAreHere);
        }
        if (doorPending && pendingDoor) {
          workingExtras = withDoor(workingExtras, pendingDoor);
        }
        shouldPersistExtras = true;
      }
      if (shouldPersistExtras && onPersistLayoutExtras) {
        await onPersistLayoutExtras(workingExtras);
        if (catchAllRemovedInSession && !catchAllShouldPersist) {
          setCatchAllRemovedInSession(false);
        }
        if (pendingHidden.length > 0 && onDeactivateSlots) {
          await onDeactivateSlots(pendingHidden);
        }
      }
      if (!onSaveZone && slotsToSave.size === 0 && !catchAllShouldPersist) {
        setPendingHidden([]);
        setPendingYouAreHere(null);
        setPendingDoor(null);
        setSelectedLayoutSlot(null);
        setSelectedSlots([]);
        return true;
      }
      if (slotsToSave.size > 0 && !onSaveZone) return false;
      const saveZone = onSaveZone;
      if (saveZone) {
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
        const labelRotationDeg = shelfUnit
          ? normalizeRotationDeg(
              isPrimary
                ? editLabelRotationDeg
                : (flushedLabelRotations[slot] ??
                    zone?.mapLabelRotationDeg ??
                    0),
            )
          : 0;
        const baseLabelRotation = normalizeRotationDeg(
          zone?.mapLabelRotationDeg ?? 0,
        );
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
        const labelRotationChanged =
          shelfUnit && labelRotationDeg !== baseLabelRotation;
        if (
          !offsetChanged &&
          !labelChanged &&
          !codeChanged &&
          !sizeChanged &&
          !rotationChanged &&
          !labelRotationChanged
        ) {
          continue;
        }
        await saveZone({
          code: slot,
          zoneId: zone?.id,
          patch: {
            code: patchCode,
            label: patchLabel,
            mapOffsetX: ox,
            mapOffsetY: oy,
            ...(shelfUnit
              ? { mapLabelRotationDeg: labelRotationDeg }
              : { mapWidth: patchWidth, mapHeight: patchHeight }),
            ...(canRotate ? { mapRotationDeg: rotationDeg } : {}),
          },
        });
        }
      }
      for (const slot of slotsToSave) {
        delete editSessionBySlotRef.current[slot];
      }
      setSelectedLayoutSlot(null);
      setSelectedSlots([]);
      setPendingOffsets({});
      setPendingLabels({});
      setPendingRotations({});
      setPendingLabelRotations({});
      setPendingSizes({});
      setPendingHidden([]);
      setPendingYouAreHere(null);
      setPendingDoor(null);
      setSelectedCatchAll(false);
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
    pendingYouAreHere,
    pendingDoor,
    pendingRotations,
    pendingLabelRotations,
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
    editLabelRotationDeg,
    selectedSlots,
    selectedCatchAll,
    pendingCatchAll,
    catchAllZone,
    catchAllRemovedInSession,
    applyCatchAllGeometry,
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

  const markCatchAllDeleted = async () => {
    if (!selectedCatchAll || !pendingCatchAll) {
      setSaveError("Select the catch-all overlay to delete.");
      return;
    }
    pushUndo();
    setCatchAllRemovedInSession(true);
    setPendingCatchAll(null);
    setSelectedCatchAll(false);
    catchAllSessionSnapshotRef.current = null;
    setSaveError(null);
    try {
      await onRemoveCatchAllSpot?.();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not remove catch-all.";
      setSaveError(message);
    }
  };

  const markSelectionDeleted = () => {
    if (selectedCatchAll) {
      void markCatchAllDeleted();
      return;
    }
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

  const nudgeLabelRotation = (delta: number) => {
    if (!selectedLayoutSlot || !isShelfUnitCode(selectedLayoutSlot)) return;
    pushUndo();
    setEditLabelRotationDeg((prev) => {
      const next = normalizeRotationDeg(prev + delta);
      setPendingLabelRotations((p) => ({
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
        '[data-testid^="shop-spot-"], [data-testid="shop-map-resize-handle"], [data-testid="shop-map-edit-panel"], [data-testid="shop-map-add-bar"], [data-testid="shop-map-you-are-here"], [data-testid="shop-map-door-wrap"], [data-testid="shop-map-catch-all"], [data-testid^="shop-shelf-"][data-testid$="-frame"]',
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
          labelRotationDeg: 0,
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
    if (selectedCatchAll && pendingCatchAll) {
      pushUndo();
      applyCatchAllGeometry(
        editOffsetX + dx,
        editOffsetY + dy,
        editWidth,
        editHeight,
      );
      return;
    }
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
        const local = screenDeltaToLocal(slot, dx, dy, readRotation);
        next[slot] = {
          ox: cur.ox + Math.round(local.dx),
          oy: cur.oy + Math.round(local.dy),
        };
      }
      return next;
    });
    if (selectedLayoutSlot && slots.includes(selectedLayoutSlot)) {
      const local = screenDeltaToLocal(
        selectedLayoutSlot,
        dx,
        dy,
        readRotation,
      );
      setEditOffsetX((x) => x + Math.round(local.dx));
      setEditOffsetY((y) => y + Math.round(local.dy));
    }
  };

  const nudgeSize = (dw: number, dh: number) => {
    if (selectedCatchAll && pendingCatchAll) {
      pushUndo();
      setSizeInputFocus(null);
      applyCatchAllGeometry(
        editOffsetX,
        editOffsetY,
        editWidth + dw,
        editHeight + dh,
      );
      return;
    }
    if (!selectedLayoutSlot || isShelfUnitCode(selectedLayoutSlot)) return;
    pushUndo();
    setSizeInputFocus(null);
    applyPendingSize(selectedLayoutSlot, editWidth + dw, editHeight + dh);
  };

  const commitSizeDraft = (dim: "width" | "height", raw: string) => {
    const minSize = selectedCatchAll ? CATCH_ALL_MIN_SIZE : MIN_SPOT_SIZE;
    if (selectedCatchAll && pendingCatchAll) {
      const parsed = parseInt(raw.trim(), 10);
      const clamped = Number.isFinite(parsed)
        ? Math.max(minSize, parsed)
        : minSize;
      const nextW = dim === "width" ? clamped : editWidth;
      const nextH = dim === "height" ? clamped : editHeight;
      if (nextW === editWidth && nextH === editHeight) return;
      pushUndo();
      applyCatchAllGeometry(editOffsetX, editOffsetY, nextW, nextH);
      return;
    }
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
    const shelfUnit = !ground ? shelfUnitForSpot(layoutSlot) : null;
    const labelRot = shelfUnit ? readLabelRotation(shelfUnit) : 0;
    const spotLabel = displayCodeForSlot(layoutSlot);
    const offset = absoluteBase
      ? { left: absoluteBase.left + ox, top: absoluteBase.top + oy }
      : { left: ox, top: oy };
    const selected =
      editMode &&
      selectedSlots.length <= 1 &&
      selectedLayoutSlot === layoutSlot;
    const pendingAssign = assignMode && pendingAssignLayoutSlot === layoutSlot;
    const selfPlanned =
      assignMode && selfPlannedLayoutSlots?.has(layoutSlot) === true;
    const spotFocused = focusLayoutSlot === layoutSlot;
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
            ...(pendingAssign
              ? {
                  outline: "3px solid #ea580c",
                  outlineOffset: 2,
                  boxShadow: "0 0 0 2px #fff7ed",
                }
              : {}),
            ...(spotFocused && !pendingAssign
              ? {
                  outline: "3px solid #0a3161",
                  outlineOffset: 2,
                  boxShadow: "0 0 0 2px #dbeafe",
                }
              : {}),
            ...(assignMode && !editMode
              ? { flexDirection: "column", gap: 1 }
              : {}),
          }}
          onMouseEnter={() => !editMode && !assignMode && void onEnter(layoutSlot)}
          onMouseLeave={() => !editMode && !assignMode && setHover(null)}
          onClick={() => onClickSpot(layoutSlot)}
          onPointerDown={(e) => onSpotPointerDown(e, layoutSlot)}
          onPointerMove={onDragPointerMove}
          onPointerUp={onDragPointerUp}
        >
          {shelfUnit ? (
            <span
              data-map-label-rotation-deg={labelRot}
              style={{
                display: "inline-block",
                transform: labelRot ? `rotate(${labelRot}deg)` : undefined,
                transformOrigin: "center center",
              }}
            >
              {spotLabel}
            </span>
          ) : (
            spotLabel
          )}
          {selfPlanned ? (
            <span
              data-testid="map-spot-also-assigned-note"
              style={{
                fontSize: 7,
                fontWeight: 600,
                lineHeight: 1.1,
                color: "#9a3412",
                textAlign: "center",
                maxWidth: "100%",
                overflow: "hidden",
              }}
            >
              Also assigned to this job
            </span>
          ) : null}
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
    if (selectedCatchAll && pendingCatchAll) {
      applyCatchAllGeometry(editOffsetX, editOffsetY, editWidth, editHeight);
      setSelectedCatchAll(false);
    }
    pushUndo();
    setAddingLayout(true);
    setSaveError(null);
    try {
      await action();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Add failed";
      setSaveError(msg);
      throw err;
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
    if (assignMode && assignDeliveryId) {
      if (selfPlannedLayoutSlots?.has(layoutSlot)) {
        return;
      }
      const displayCode = displayCodeForSlot(layoutSlot);
      const key = normalizeStagingCodeKey(displayCode);
      const stock = shopStockByCode[key];
      if (stock) {
        onAssignSpotRefused?.(
          `${displayCode} is reserved for shop stock (${stock.stockItemLabel}).`,
        );
        return;
      }
      const occ = occupancyByZoneCode[key];
      if (occ && occ.deliveryId !== assignDeliveryId) {
        onAssignSpotRefused?.(
          `${displayCode} is assigned to another delivery (${occ.orderNumber}).`,
        );
        return;
      }
      onAssignSpotClick?.(layoutSlot);
      return;
    }
    const displayCode = displayCodeForSlot(layoutSlot);
    const occKey = normalizeStagingCodeKey(displayCode);
    const slotKey = normalizeStagingCodeKey(layoutSlot);
    const occ =
      occupancyByZoneCode[occKey] ?? occupancyByZoneCode[slotKey];
    if (occ) {
      void (async () => {
        try {
          const detail = await firestoreDataService.getDeliveryDetails(
            occ.deliveryId,
          );
          if (detail) {
            onOpenDelivery(occ.deliveryId, displayCode);
            return;
          }
          // Stale occupancy (e.g. CA dual-key bleed / deleted delivery) — no scary banner.
          return;
        } catch {
          // Same: avoid toast spam when map color is ahead of readable delivery docs.
          return;
        }
      })();
    }
  };

  return (
    <div
      data-testid="shop-floor-map"
      className={[
        "shop-floor-map",
        editMode ? "shop-floor-map--edit" : "",
        vendorView ? "shop-floor-map--vendor" : "",
      ]
        .filter(Boolean)
        .join(" ")}
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

      {editMode && (onAddGroundSpot || onAddShelf || onAddCatchAllSpot || onSaveZone) && (
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
          {saveError && (
            <span
              data-testid="shop-map-add-error"
              style={{ color: "#991b1b", fontSize: 12, fontWeight: 700 }}
            >
              {saveError}
            </span>
          )}
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
          {onAddCatchAllSpot && !catchAllMarker && (
            <button
              type="button"
              data-testid="shop-map-add-catch-all"
              disabled={addingLayout || !onSaveZone}
              onClick={() =>
                void runAdd(async () => {
                  await onAddCatchAllSpot!();
                  setCatchAllRemovedInSession(false);
                  const marker = defaultCatchAllMarker();
                  setPendingCatchAll(marker);
                  selectCatchAllForEdit(marker);
                })
              }
              style={addLayoutBtnStyle}
            >
              Add Catch All Location
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
        {catchAllMarker && (
          <div
            className="shop-map-catch-all"
            data-testid="shop-map-catch-all"
            data-spot-catch-all="true"
            data-map-offset-x={catchAllMarker.ox}
            data-map-offset-y={catchAllMarker.oy}
            data-map-width={catchAllMarker.width}
            data-map-height={catchAllMarker.height}
            title={
              editMode
                ? "Drag to place catch-all intake; drag blue corner to resize; then Save"
                : undefined
            }
            onPointerDown={onCatchAllPointerDown}
            onPointerMove={onCatchAllPointerMove}
            onPointerUp={onCatchAllPointerUp}
            style={{
              position: "absolute",
              left: catchAllMarker.ox,
              top: catchAllMarker.oy,
              width: catchAllMarker.width,
              height: catchAllMarker.height,
              boxSizing: "border-box",
              backgroundColor: CATCH_ALL_SPOT_BG,
              color: CATCH_ALL_SPOT_FG,
              border: `2px solid ${CATCH_ALL_SPOT_BORDER}`,
              borderRadius: 4,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              lineHeight: 1.05,
              gap: 1,
              fontFamily: FONT,
              userSelect: "none",
              cursor: editMode ? "grab" : "default",
              touchAction: "none",
              outline: editMode
                ? selectedCatchAll
                  ? "3px solid #2563eb"
                  : "2px dashed #2563eb"
                : undefined,
              outlineOffset: 2,
              zIndex: 6,
            }}
          >
            <span
              data-testid="shop-spot-catch-all-label"
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: CATCH_ALL_SPOT_FG,
              }}
            >
              Catch-all
            </span>
            <span
              data-testid="catch-all-pending-count"
              style={{
                fontSize: 13,
                fontWeight: 800,
                color: CATCH_ALL_SPOT_FG,
              }}
            >
              {catchAllPendingCount}
            </span>
            {editMode && (
              <span
                data-testid="shop-map-catch-all-resize-handle"
                onPointerDown={onCatchAllResizePointerDown}
                onPointerMove={onCatchAllResizePointerMove}
                onPointerUp={onCatchAllResizePointerUp}
                style={{
                  position: "absolute",
                  right: 2,
                  bottom: 2,
                  width: 14,
                  height: 14,
                  borderRadius: 2,
                  backgroundColor: "#2563eb",
                  border: "2px solid #fff",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                  cursor: "nwse-resize",
                  zIndex: 7,
                  touchAction: "none",
                }}
              />
            )}
          </div>
        )}
        {/* Left ground column G1–G4 (visual bottom→top) + entrance markers */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column-reverse",
              gap: 8,
            }}
          >
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
          <div
            className="shop-map-entrance"
            data-testid="shop-map-entrance"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              marginTop: 4,
              position: "relative",
            }}
          >
            {/* Door in-flow — layout anchor; YAH absolute so vendor toggle does not shift door */}
            <div
              className="shop-map-door-wrap"
              data-testid="shop-map-door-wrap"
              data-map-offset-x={door.ox}
              data-map-offset-y={door.oy}
              data-map-size={door.sizePx}
              data-map-rotation-deg={door.rotationDeg}
              title={
                editMode
                  ? "Drag to place the door for this wall sign, then Save"
                  : undefined
              }
              onPointerDown={onDoorPointerDown}
              onPointerMove={onDoorPointerMove}
              onPointerUp={onDoorPointerUp}
              style={{
                display: "block",
                width: door.sizePx,
                height: doorHeightPx,
                boxSizing: "border-box",
                backgroundColor: "rgba(255,255,255,0.01)",
                transform: `translate(${door.ox}px, ${door.oy}px) rotate(${door.rotationDeg}deg)`,
                transformOrigin: "center center",
                cursor: editMode ? "grab" : "default",
                touchAction: "none",
                outline: editMode ? "2px dashed #2563eb" : undefined,
                outlineOffset: 2,
                zIndex: 4,
                position: "relative",
              }}
            >
              <svg
                className="shop-map-door"
                data-testid="shop-map-door"
                width={door.sizePx}
                height={doorHeightPx}
                viewBox="0 0 72 56"
                aria-label="Entrance door"
                style={{
                  display: "block",
                  overflow: "visible",
                  pointerEvents: "none",
                }}
              >
                <line
                  className="shop-map-door-leaf"
                  x1="8"
                  y1="4"
                  x2="8"
                  y2="52"
                  stroke={NAVY}
                  strokeWidth="3"
                  strokeLinecap="square"
                />
                <path
                  className="shop-map-door-swing"
                  d="M 8 4 A 40 40 0 0 1 52 44"
                  fill="none"
                  stroke={NAVY}
                  strokeWidth="2.5"
                  strokeDasharray="5 4"
                />
              </svg>
              {editMode && (
                <>
                  <span
                    className="shop-map-door-resize-handle"
                    data-testid="shop-map-door-resize-handle"
                    onPointerDown={onDoorResizePointerDown}
                    onPointerMove={onDoorResizePointerMove}
                    onPointerUp={onDoorResizePointerUp}
                    style={{
                      position: "absolute",
                      right: 2,
                      bottom: 2,
                      width: 14,
                      height: 14,
                      borderRadius: 2,
                      backgroundColor: "#2563eb",
                      border: "2px solid #fff",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                      cursor: "nwse-resize",
                      zIndex: 6,
                      touchAction: "none",
                    }}
                  />
                  <button
                    type="button"
                    data-testid="shop-map-door-rotate-ccw"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      nudgeDoorRotation(-ROTATE_STEP);
                    }}
                    style={{
                      ...doorRotateBtnStyle,
                      left: -4,
                      transform: "translate(-100%, -50%)",
                    }}
                    title="Rotate left 15°"
                    aria-label="Rotate left 15°"
                  >
                    <span style={doorRotateGlyphStyle} aria-hidden>
                      ↺
                    </span>
                    <span style={doorRotateStepStyle} aria-hidden>
                      15°
                    </span>
                  </button>
                  <button
                    type="button"
                    data-testid="shop-map-door-rotate-cw"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      nudgeDoorRotation(ROTATE_STEP);
                    }}
                    style={{
                      ...doorRotateBtnStyle,
                      right: -4,
                      transform: "translate(100%, -50%)",
                    }}
                    title="Rotate right 15°"
                    aria-label="Rotate right 15°"
                  >
                    <span style={doorRotateGlyphStyle} aria-hidden>
                      ↻
                    </span>
                    <span style={doorRotateStepStyle} aria-hidden>
                      15°
                    </span>
                  </button>
                </>
              )}
            </div>
            <div
              className="shop-map-you-are-here"
              data-testid="shop-map-you-are-here"
              data-map-offset-x={youAreHere.ox}
              data-map-offset-y={youAreHere.oy}
              data-map-size={youAreHere.sizePx}
              title={
                canEditYouAreHere
                  ? "Drag to place; drag blue corner to resize; then Save"
                  : undefined
              }
              onPointerDown={onYouAreHerePointerDown}
              onPointerMove={onYouAreHerePointerMove}
              onPointerUp={onYouAreHerePointerUp}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: youAreHere.sizePx,
                height: youAreHere.sizePx,
                borderRadius: "50%",
                backgroundColor: YOU_ARE_HERE_YELLOW,
                color: "#111",
                fontWeight: 900,
                fontSize: Math.max(11, Math.round(youAreHere.sizePx * 0.135)),
                lineHeight: 1.15,
                letterSpacing: 0.2,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                userSelect: "none",
                cursor: canEditYouAreHere ? "grab" : "default",
                transform: `translate(${youAreHere.ox}px, ${youAreHere.oy}px)`,
                boxShadow: canEditYouAreHere ? "0 0 0 2px #2563eb" : undefined,
                touchAction: "none",
                zIndex: 5,
              }}
            >
              <span>YOU</span>
              <span>ARE</span>
              <span>HERE</span>
              {canEditYouAreHere && (
                <span
                  data-testid="shop-map-yah-resize-handle"
                  onPointerDown={onYouAreHereResizePointerDown}
                  onPointerMove={onYouAreHereResizePointerMove}
                  onPointerUp={onYouAreHereResizePointerUp}
                  style={{
                    position: "absolute",
                    right: 2,
                    bottom: 2,
                    width: 14,
                    height: 14,
                    borderRadius: 2,
                    backgroundColor: "#2563eb",
                    border: "2px solid #fff",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                    cursor: "nwse-resize",
                    zIndex: 6,
                    touchAction: "none",
                  }}
                />
              )}
            </div>
          </div>
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
              const unitLabelRot = readLabelRotation(unit);
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
                    data-map-label-rotation-deg={unitLabelRot}
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
                      ...(unitLabelRot
                        ? {
                            transform: `rotate(${unitLabelRot}deg)`,
                            transformOrigin: "center center",
                          }
                        : {}),
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

      {editMode && (selectedCatchAll || selectedLayoutSlot || selectedSlots.length > 1) && (
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
            color: "#111",
          }}
        >
          <div
            data-testid="shop-map-edit-panel-title"
            style={{ fontWeight: 800, color: NAVY, marginBottom: 10 }}
          >
            {selectedCatchAll
              ? "Edit Catch-all"
              : selectedSlots.length > 1
                ? `${selectedSlots.length} spots selected`
                : isShelfUnitCode(selectedLayoutSlot ?? "")
                  ? `Edit shelf ${selectedLayoutSlot}`
                  : `Edit ${selectedLayoutSlot}`}
          </div>
          {selectedSlots.length <= 1 && (selectedLayoutSlot || selectedCatchAll) && (
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
              {!isShelfUnitCode(selectedLayoutSlot ?? "") &&
                (selectedCatchAll || selectedLayoutSlot) && (
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
                  if (selectedCatchAll && pendingCatchAll) {
                    pushUndo();
                    const defaults = defaultCatchAllMarker();
                    applyCatchAllGeometry(
                      defaults.ox,
                      defaults.oy,
                      defaults.width,
                      defaults.height,
                    );
                    return;
                  }
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
                ●
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
                : selectedCatchAll
                  ? " — or drag the catch-all overlay"
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
            isShelfUnitCode(selectedLayoutSlot) && (
              <div style={{ marginBottom: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#6b7280" }}>
                  Labels
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
                    data-testid="shop-map-label-rotate-ccw"
                    aria-label="Rotate labels counter-clockwise"
                    onClick={() => nudgeLabelRotation(-LABEL_ROTATE_STEP)}
                    style={sizePadBtnStyle}
                  >
                    ↺
                  </button>
                  <span
                    data-testid="shop-map-label-rotation-deg"
                    style={{
                      fontSize: 14,
                      fontWeight: 800,
                      color: NAVY,
                      minWidth: 52,
                      textAlign: "center",
                      fontFamily: FONT,
                    }}
                  >
                    {editLabelRotationDeg}°
                  </span>
                  <button
                    type="button"
                    data-testid="shop-map-label-rotate-cw"
                    aria-label="Rotate labels clockwise"
                    onClick={() => nudgeLabelRotation(LABEL_ROTATE_STEP)}
                    style={sizePadBtnStyle}
                  >
                    ↻
                  </button>
                  <button
                    type="button"
                    data-testid="shop-map-label-rotate-reset"
                    aria-label="Reset label rotation"
                    onClick={() => nudgeLabelRotation(-editLabelRotationDeg)}
                    style={{ ...sizePadBtnStyle, fontSize: 11, minWidth: 40 }}
                    title="Reset labels to 0°"
                  >
                    0°
                  </button>
                </div>
              </div>
            )}
          {selectedSlots.length <= 1 &&
            (selectedCatchAll ||
              (selectedLayoutSlot && !isShelfUnitCode(selectedLayoutSlot))) && (
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
                  !(pendingHidden.length > 0 && onPersistLayoutExtras) &&
                  pendingYouAreHere === null &&
                  pendingDoor === null &&
                  !(pendingCatchAll && catchAllZone && onPersistLayoutExtras) &&
                  !catchAllRemovedInSession)
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
            {selectedSlots.length <= 1 && (selectedLayoutSlot || selectedCatchAll) && (
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
          className="shop-map-unplaced"
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
        className="shop-map-legend"
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
        className="shop-map-last-edited"
        data-testid="shop-map-last-edited"
        style={{
          marginTop: 18,
          textAlign: "right",
          fontSize: 12,
          fontWeight: 700,
          color: "#374151",
        }}
      >
        Last edited: {lastEditedLabel}
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
  color: "#111",
  cursor: "pointer",
  fontFamily: NUDGE_SYMBOL_FONT,
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
  fontSize: 23,
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

const doorRotateBtnStyle: CSSProperties = {
  position: "absolute",
  top: "50%",
  minWidth: 28,
  minHeight: 32,
  padding: "2px 4px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 0,
  fontFamily: NUDGE_SYMBOL_FONT,
  borderRadius: 4,
  border: `2px solid ${NAVY}`,
  background: "#fff",
  boxShadow: "0 1px 4px rgba(10, 49, 97, 0.35)",
  cursor: "pointer",
  zIndex: 6,
  touchAction: "manipulation",
};

const doorRotateGlyphStyle: CSSProperties = {
  fontSize: 16,
  fontWeight: 800,
  lineHeight: 1,
  color: NAVY,
};

const doorRotateStepStyle: CSSProperties = {
  fontSize: 8,
  fontWeight: 800,
  lineHeight: 1,
  color: NAVY,
  marginTop: 1,
  fontFamily: FONT,
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
