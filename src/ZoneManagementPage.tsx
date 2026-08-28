import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  type CSSProperties,
  type FormEvent,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { LocationStatus, StagingLocation, ShopStockLocationMapping, DeliveryDetails, VendorInvoiceImportReview } from "./dispatcher/models";
import { getAllStagingLocationIds, isLocationActive, LOCATION_STATUSES } from "./dispatcher/models";
import {
  formatStagingCodeCanonical,
  normalizeStagingCodeKey,
} from "./dispatcher/stagingCode";
import {
  indexZonesByLayoutKey,
  resolveStagingLocationForLayoutSlot,
} from "./dispatcher/resolveStagingLocationForSlot";
import { isMapSlotPlaceholderStagingLocation } from "./dispatcher/stagingMapSync";
import {
  clearPendingManualItemReceive,
  readPendingManualItemReceive,
} from "./dispatcher/manualItemReceiveStaging";
import {
  listAllZones,
  createZone,
  updateZone,
  deactivateZone,
  mapActiveZoneOccupancyByCode,
  listShopStockMappings,
  getAppSettings,
  updateAppSettings,
  subscribeAppSettings,
  firestoreDataService,
  getVendorInvoiceImport,
  setInvoiceReviewDraftStagingLocations,
  approveVendorInvoiceImport,
  type ZoneOccupancySummary,
} from "./dispatcher/firestoreService";
import {
  buildInvoiceApproveToastMessage,
  INVOICE_APPROVE_FLOW_STORAGE_KEY,
  stashInvoiceApproveDismissedImportId,
  stashInvoiceApproveSuccessToast,
} from "./dispatcher/invoice/invoiceApproveToast";
import { resolveDeliveryPoNumber } from "./dispatcher/invoice/invoiceShellDisplayHelpers";
import { readInvoiceHeaderField } from "./dispatcher/invoice/invoiceReviewHeaderHelpers";
import { mapActiveShopStockReservationsByCode } from "./dispatcher/shopStockMapping";
import {
  buildZoneEslQrUrl,
  buildPermanentLocationUrl,
  formatZoneEslStatusLine,
} from "./receiveQrUrls";
import { EslQrCode } from "./EslQrCode";
import { PortalShell } from "./PortalShell";
import {
  PORTAL_MAIN_CLASS,
  PORTAL_SCROLL_CLASS,
} from "./dispatcherPortalLayout";
import { PortalSidebar } from "./PortalSidebar";
import { ShopStockDirectoryPanel } from "./ShopStockDirectoryPanel";
import { DispatcherPortalTopBar } from "./DispatcherPortalTopBar";
import { useDispatcherPortal } from "./dispatcher/DispatcherPortalContext";
import { useLiveZoneOccupancy } from "./dispatcher/useLiveZoneOccupancy";
import {
  countCatchAllAssignedDeliveries,
  type ZoneOccupancySummaryWithReadiness,
} from "./dispatcher/zoneOccupancyCompute";
import {
  SHOP_MAP_GROUND_CODES,
  SHOP_MAP_GROUND_SPOT_H,
  SHOP_MAP_GROUND_SPOT_W,
  allShopMapSpotCodes,
  defaultLabelForSpotCode,
  inferSpotZoneType,
  isInflatedGroundSpotSize,
  nextGroundSpotCode,
  nextShelfSpotLetter,
  nextShelfUnitCode,
  pruneUnoccupiedVerifyLayoutExtras,
  resolveShopMapLayout,
  withoutCatchAllMarker,
  isDefaultGroundLayoutSlot,
  CATCH_ALL_ZONE_CODE,
  shelfSpotCode,
  withExtraGroundSpot,
  withExtraShelfSpot,
  withExtraShelfUnit,
  withoutHiddenSlots,
  type ShopMapLayoutExtras,
} from "./dispatcher/shopMapLayout";
import type { MapZoneSavePayload, ShopFloorMapHandle } from "./ShopFloorMap";
import { ShopFloorMap } from "./ShopFloorMap";
import { DeliveryDetailDrawer } from "./dispatcher/drawer/DeliveryDetailDrawer";
import { CatchAllStatusDrawer } from "./dispatcher/drawer/CatchAllStatusDrawer";

const NAVY = "#0a3161";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const INVOICE_DRAFT_STAGING_STORAGE_KEY = "sv-invoice-draft-staging";
const RED = "#bf0a30";
const ZONE_TYPES = ["ground", "shelf", "bin", "other"] as const;
type ZoneType = (typeof ZONE_TYPES)[number];

const TYPE_LABELS: Record<ZoneType, string> = {
  ground: "Ground",
  shelf: "Shelf",
  bin: "Bin",
  other: "Other",
};

const ESL_TAG_HINT: Record<ZoneType, string> = {
  ground: "4.2\" Minew DS042Q — scan barcode on physical tag",
  shelf: "3.5\" Minew DS035Q — scan barcode on physical tag",
  bin: "Minew ESL tag barcode",
  other: "Minew ESL tag barcode",
};

function zoneShopStockReservation(
  code: string,
  byCode: Record<string, ShopStockLocationMapping>,
): ShopStockLocationMapping | undefined {
  return byCode[normalizeStagingCodeKey(code)];
}

function zoneOccupancy(
  code: string,
  byCode: Record<string, ZoneOccupancySummary>,
): ZoneOccupancySummary | undefined {
  return byCode[normalizeStagingCodeKey(code)];
}

function sortZones(a: StagingLocation, b: StagingLocation): number {
  const orderA = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
  const orderB = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
  if (orderA !== orderB) return orderA - orderB;
  return a.code.localeCompare(b.code, undefined, { numeric: true });
}

interface ZoneFormState {
  code: string;
  label: string;
  type: ZoneType;
  status: LocationStatus;
  notes: string;
  sortOrder: string;
  eslTagId: string;
  widthFt: string;
  depthFt: string;
  adjacentGroupId: string;
  sizeClass: string;
}

function defaultDimensionsForType(type: ZoneType): {
  widthFt: string;
  depthFt: string;
} {
  if (type === "shelf" || type === "bin") {
    return { widthFt: "3", depthFt: "3" };
  }
  if (type === "ground") {
    return { widthFt: "4", depthFt: "4" };
  }
  return { widthFt: "", depthFt: "" };
}

const EMPTY_FORM: ZoneFormState = {
  code: "",
  label: "",
  type: "ground",
  status: "Planned",
  notes: "",
  sortOrder: "",
  eslTagId: "",
  adjacentGroupId: "",
  sizeClass: "",
  ...defaultDimensionsForType("ground"),
};

function zoneToForm(zone: StagingLocation): ZoneFormState {
  return {
    code: zone.code,
    label: zone.label,
    type: zone.type,
    status: zone.status,
    notes: zone.notes ?? "",
    sortOrder: zone.sortOrder != null ? String(zone.sortOrder) : "",
    eslTagId: zone.eslTagId ?? "",
    widthFt: zone.widthFt != null ? String(zone.widthFt) : "",
    depthFt: zone.depthFt != null ? String(zone.depthFt) : "",
    adjacentGroupId: zone.adjacentGroupId ?? "",
    sizeClass: zone.sizeClass ?? "",
  };
}

function formToZoneData(form: ZoneFormState): Omit<StagingLocation, "id"> {
  const sortOrder = form.sortOrder.trim()
    ? Number(form.sortOrder)
    : undefined;
  const widthFt = form.widthFt.trim() ? Number(form.widthFt) : undefined;
  const depthFt = form.depthFt.trim() ? Number(form.depthFt) : undefined;
  return {
    code: formatStagingCodeCanonical(form.code),
    label: form.label.trim(),
    type: form.type,
    status: form.status,
    notes: form.notes.trim() || undefined,
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : undefined,
    eslTagId: form.eslTagId.trim() || undefined,
    widthFt: Number.isFinite(widthFt) ? widthFt : undefined,
    depthFt: Number.isFinite(depthFt) ? depthFt : undefined,
    adjacentGroupId: form.adjacentGroupId.trim() || undefined,
    sizeClass: form.sizeClass.trim() || undefined,
  };
}

const LOCATION_STATUS_LABEL: Record<LocationStatus, string> = {
  Planned: "Space is assigned",
  Installed: "Installed",
  Tagged: "Tagged",
  Active: "Active",
};

function statusBadgeStyle(status: LocationStatus): CSSProperties {
  const colors: Record<LocationStatus, { bg: string; text: string }> = {
    Planned: { bg: "var(--admin-surface-2)", text: "var(--admin-text-muted)" },
    Installed: { bg: "var(--admin-info-bg)", text: "var(--admin-info-text)" },
    Tagged: { bg: "var(--admin-warning-bg)", text: "var(--admin-warning-text)" },
    Active: { bg: "var(--admin-success-bg)", text: "var(--admin-success-text)" },
  };
  const c = colors[status];
  return {
    display: "inline-flex",
    padding: "2px 8px",
    borderRadius: "var(--admin-radius-pill)",
    fontSize: 11,
    fontWeight: 700,
    backgroundColor: c.bg,
    color: c.text,
    marginLeft: 6,
  };
}

const cardStyle: CSSProperties = {
  backgroundColor: "var(--admin-surface)",
  border: "1px solid var(--admin-border)",
  borderRadius: "var(--admin-radius-lg)",
  boxShadow: "var(--admin-shadow-card)",
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1.5px solid var(--admin-border)",
  minHeight: "var(--admin-control-height)",
  borderRadius: "var(--admin-control-radius)",
  fontSize: 14,
  color: "var(--admin-text)",
  outline: "none",
  backgroundColor: "var(--admin-surface)",
  fontFamily: FONT,
  boxSizing: "border-box",
};

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 700,
  color: "var(--admin-text-muted)",
  marginBottom: 6,
};

function typeBadgeStyle(type: ZoneType): CSSProperties {
  const colors: Record<ZoneType, { bg: string; text: string }> = {
    ground: { bg: "var(--admin-success-bg)", text: "var(--admin-success-text)" },
    shelf: { bg: "var(--admin-info-bg)", text: "var(--admin-info-text)" },
    bin: { bg: "var(--admin-warning-bg)", text: "var(--admin-warning-text)" },
    other: { bg: "var(--admin-surface-2)", text: "var(--admin-text-label)" },
  };
  const c = colors[type];
  return {
    display: "inline-flex",
    padding: "2px 8px",
    borderRadius: "var(--admin-radius-pill)",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    backgroundColor: c.bg,
    color: c.text,
  };
}

export function ZoneManagementPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const assignDeliveryId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("assignDelivery")?.trim() || null;
  }, [location.search]);

  const assignInvoiceImportId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("assignInvoiceImport")?.trim() || null;
  }, [location.search]);

  const approveFlow = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("approveFlow") === "1";
  }, [location.search]);

  const reassignMode = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("reassign") === "1";
  }, [location.search]);

  const pendingItemReceiveId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("pendingItemReceive")?.trim() || null;
  }, [location.search]);

  useEffect(() => {
    if (!assignInvoiceImportId || !assignDeliveryId) return;
    const params = new URLSearchParams(location.search);
    params.delete("assignDelivery");
    params.delete("reassign");
    const search = params.toString();
    navigate(
      { pathname: "/zones", search: search ? `?${search}` : "" },
      { replace: true },
    );
  }, [assignInvoiceImportId, assignDeliveryId, location.search, navigate]);

  const focusSpotCode = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("focusSpot")?.trim() || null;
  }, [location.search]);

  const [mapFocusSpotCode, setMapFocusSpotCode] = useState<string | null>(null);

  useEffect(() => {
    setMapFocusSpotCode(null);
  }, [focusSpotCode]);

  const effectiveFocusSpotCode = mapFocusSpotCode ?? focusSpotCode;

  const lastRefreshGeneration = useRef(0);
  const {
    refreshBusy,
    gmailSyncMessage,
    lastUpdated,
    setLastUpdated,
    handleRefreshNow,
    zonesSnapshot,
    refreshGeneration,
    refreshPortalData,
  } = useDispatcherPortal();
  const [zones, setZones] = useState<StagingLocation[]>([]);
  const [occupancyByZoneCode, setOccupancyByZoneCode] = useState<
    Record<string, ZoneOccupancySummaryWithReadiness>
  >({});
  const [shopStockByCode, setShopStockByCode] = useState<
    Record<string, ShopStockLocationMapping>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ZoneFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [eslDrafts, setEslDrafts] = useState<Record<string, string>>({});
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(
    null,
  );
  const [showZoneTools, setShowZoneTools] = useState(false);
  const [mapEditMode, setMapEditMode] = useState(false);
  /** Session-only wall-sign preview — YOU ARE HERE shows here (not on live dispatcher). */
  const [vendorView, setVendorView] = useState(false);
  const mapRef = useRef<ShopFloorMapHandle>(null);
  const [layoutExtras, setLayoutExtras] = useState<ShopMapLayoutExtras>({});
  const [catchAllStagingLocationId, setCatchAllStagingLocationId] = useState<
    string | null
  >(null);
  const [catchAllStatusOpen, setCatchAllStatusOpen] = useState(false);
  const liveOccupancy = useLiveZoneOccupancy(true);
  const catchAllPendingCount = useMemo(
    () =>
      countCatchAllAssignedDeliveries(
        liveOccupancy.zones,
        liveOccupancy.deliveries,
        catchAllStagingLocationId,
      ),
    [
      catchAllStagingLocationId,
      liveOccupancy.deliveries,
      liveOccupancy.zones,
    ],
  );
  /** Once live occupancy has connected, never fall back to a stale one-shot paint. */
  const [preferLiveOccupancy, setPreferLiveOccupancy] = useState(false);
  useEffect(() => {
    if (liveOccupancy.ready) setPreferLiveOccupancy(true);
  }, [liveOccupancy.ready]);
  const mapOccupancyByZoneCode = preferLiveOccupancy
    ? liveOccupancy.occupancyByZoneCode
    : occupancyByZoneCode;
  const mapShopStockByCode = preferLiveOccupancy
    ? liveOccupancy.shopStockByCode
    : shopStockByCode;
  const [assignDetails, setAssignDetails] = useState<DeliveryDetails | null>(
    null,
  );
  const [assignImportDetails, setAssignImportDetails] =
    useState<VendorInvoiceImportReview | null>(null);
  const [pendingAssignSpot, setPendingAssignSpot] = useState<{
    layoutSlot: string;
    zoneId: string;
    code: string;
  } | null>(null);
  const [assignSaving, setAssignSaving] = useState(false);
  const [assignToast, setAssignToast] = useState<{
    message: string;
    tone: "success" | "error";
  } | null>(null);

  const assignMode =
    Boolean(assignDeliveryId || assignInvoiceImportId) && !mapEditMode;
  /** Spots render from layout before Firestore zones hydrate — block picks until both are ready. */
  const assignReady =
    assignMode &&
    zones.length > 0 &&
    (assignInvoiceImportId
      ? assignImportDetails !== null
      : assignDetails !== null);

  const handleMapOpenDelivery = useCallback(
    (deliveryId: string, spotCode?: string) => {
      setCatchAllStatusOpen(false);
      setSelectedDeliveryId(deliveryId);
      const code = spotCode?.trim();
      if (code && !mapEditMode && !assignMode) {
        setMapFocusSpotCode(code);
      }
    },
    [mapEditMode, assignMode],
  );

  const handleCatchAllClick = useCallback(() => {
    setSelectedDeliveryId(null);
    setCatchAllStatusOpen(true);
  }, []);

  const exitAssignMode = useCallback(() => {
    setPendingAssignSpot(null);
    if (assignInvoiceImportId && approveFlow) {
      try {
        const raw = sessionStorage.getItem(INVOICE_APPROVE_FLOW_STORAGE_KEY);
        let correctionNote: string | undefined;
        if (raw) {
          const parsed = JSON.parse(raw) as {
            importId?: string;
            correctionNote?: string;
          };
          if (parsed.importId === assignInvoiceImportId) {
            correctionNote = parsed.correctionNote;
          }
        }
        sessionStorage.setItem(
          INVOICE_APPROVE_FLOW_STORAGE_KEY,
          JSON.stringify({
            importId: assignInvoiceImportId,
            phase: "dropoff_staging",
            correctionNote,
          }),
        );
      } catch {
        sessionStorage.removeItem(INVOICE_APPROVE_FLOW_STORAGE_KEY);
      }
      navigate(
        `/dispatcher?focus=needs-review&inspectInvoiceImport=${encodeURIComponent(assignInvoiceImportId)}`,
        { replace: true },
      );
      return;
    }
    if (assignInvoiceImportId) {
      navigate(
        `/dispatcher?focus=needs-review&inspectInvoiceImport=${encodeURIComponent(assignInvoiceImportId)}`,
        { replace: true },
      );
      return;
    }
    const params = new URLSearchParams(location.search);
    params.delete("assignDelivery");
    params.delete("assignInvoiceImport");
    params.delete("reassign");
    if (params.get("pendingItemReceive")?.trim()) {
      clearPendingManualItemReceive();
    }
    params.delete("pendingItemReceive");
    const search = params.toString();
    navigate(
      { pathname: "/zones", search: search ? `?${search}` : "" },
      { replace: true },
    );
  }, [assignInvoiceImportId, approveFlow, location.search, navigate]);

  useEffect(() => {
    setPendingAssignSpot(null);
    if (!assignDeliveryId || mapEditMode) {
      if (!assignDeliveryId) {
        setAssignDetails(null);
      }
      return;
    }
    let cancelled = false;
    setAssignDetails(null);
    void firestoreDataService
      .getDeliveryDetails(assignDeliveryId)
      .then((detail) => {
        if (!cancelled) setAssignDetails(detail);
      })
      .catch(() => {
        if (!cancelled) setAssignDetails(null);
      });
    return () => {
      cancelled = true;
    };
  }, [assignDeliveryId, mapEditMode]);

  useEffect(() => {
    setPendingAssignSpot(null);
    if (!assignInvoiceImportId || mapEditMode) {
      if (!assignInvoiceImportId) {
        setAssignImportDetails(null);
      }
      return;
    }
    let cancelled = false;
    setAssignImportDetails(null);
    void getVendorInvoiceImport(assignInvoiceImportId)
      .then((detail) => {
        if (!cancelled) setAssignImportDetails(detail);
      })
      .catch(() => {
        if (!cancelled) setAssignImportDetails(null);
      });
    return () => {
      cancelled = true;
    };
  }, [assignInvoiceImportId, mapEditMode]);

  useEffect(() => {
    if (mapEditMode && (assignDeliveryId || assignInvoiceImportId)) {
      exitAssignMode();
    }
  }, [mapEditMode, assignDeliveryId, assignInvoiceImportId, exitAssignMode]);

  const mapLayout = useMemo(
    () => resolveShopMapLayout(layoutExtras),
    [layoutExtras],
  );

  const assignResolveZones = useMemo(
    () => (liveOccupancy.ready ? liveOccupancy.zones : zones),
    [liveOccupancy.ready, liveOccupancy.zones, zones],
  );

  const zonesByLayoutSlot = useMemo(
    () => indexZonesByLayoutKey(assignResolveZones),
    [assignResolveZones],
  );

  const handleMapZoneSave = useCallback(
    async ({ code: layoutSlot, zoneId, patch }: MapZoneSavePayload) => {
      const canonicalCode = formatStagingCodeCanonical(
        patch.code ?? layoutSlot,
      );
      const type = inferSpotZoneType(canonicalCode);
      const layoutSlotCanonical = formatStagingCodeCanonical(layoutSlot);
      // Firestore rejects undefined field values — omit optional size for shelf units.
      const savePatch: Partial<StagingLocation> = {
        code: canonicalCode,
        label: patch.label,
        mapLayoutSlot: layoutSlotCanonical,
        ...(patch.mapOffsetX !== undefined
          ? { mapOffsetX: patch.mapOffsetX }
          : {}),
        ...(patch.mapOffsetY !== undefined
          ? { mapOffsetY: patch.mapOffsetY }
          : {}),
        ...(patch.mapWidth !== undefined ? { mapWidth: patch.mapWidth } : {}),
        ...(patch.mapHeight !== undefined ? { mapHeight: patch.mapHeight } : {}),
        ...(patch.mapRotationDeg !== undefined
          ? { mapRotationDeg: patch.mapRotationDeg }
          : {}),
        ...(patch.mapLabelRotationDeg !== undefined
          ? { mapLabelRotationDeg: patch.mapLabelRotationDeg }
          : {}),
      };
      if (zoneId) {
        await updateZone(zoneId, savePatch);
        setZones((prev) =>
          prev.map((z) =>
            z.id === zoneId ? { ...z, ...savePatch } : z,
          ),
        );
      } else {
        const label = patch.label ?? defaultLabelForSpotCode(layoutSlot);
        const id = await createZone({
          code: canonicalCode,
          label,
          type,
          status: "Active",
          mapLayoutSlot: layoutSlotCanonical,
          ...(patch.mapOffsetX !== undefined
            ? { mapOffsetX: patch.mapOffsetX }
            : {}),
          ...(patch.mapOffsetY !== undefined
            ? { mapOffsetY: patch.mapOffsetY }
            : {}),
          ...(patch.mapWidth !== undefined ? { mapWidth: patch.mapWidth } : {}),
          ...(patch.mapHeight !== undefined
            ? { mapHeight: patch.mapHeight }
            : {}),
          ...(patch.mapRotationDeg !== undefined
            ? { mapRotationDeg: patch.mapRotationDeg }
            : {}),
          ...(patch.mapLabelRotationDeg !== undefined
            ? { mapLabelRotationDeg: patch.mapLabelRotationDeg }
            : {}),
        });
        const newZone: StagingLocation = {
          id,
          code: canonicalCode,
          label,
          type,
          status: "Active",
          mapLayoutSlot: layoutSlotCanonical,
          ...(patch.mapOffsetX !== undefined
            ? { mapOffsetX: patch.mapOffsetX }
            : {}),
          ...(patch.mapOffsetY !== undefined
            ? { mapOffsetY: patch.mapOffsetY }
            : {}),
          ...(patch.mapWidth !== undefined ? { mapWidth: patch.mapWidth } : {}),
          ...(patch.mapHeight !== undefined
            ? { mapHeight: patch.mapHeight }
            : {}),
          ...(patch.mapRotationDeg !== undefined
            ? { mapRotationDeg: patch.mapRotationDeg }
            : {}),
          ...(patch.mapLabelRotationDeg !== undefined
            ? { mapLabelRotationDeg: patch.mapLabelRotationDeg }
            : {}),
        };
        setZones((prev) => [...prev, newZone]);
      }
    },
    [],
  );

  const persistLayoutExtras = useCallback(
    async (next: ShopMapLayoutExtras) => {
      await updateAppSettings({ shopMapLayoutExtras: next });
      setLayoutExtras(next);
    },
    [],
  );

  const handleAddGroundSpot = useCallback(async () => {
    const layout = resolveShopMapLayout(layoutExtras);
    const code = nextGroundSpotCode(layout, layoutExtras);
    const codeKey = normalizeStagingCodeKey(code);
    const existing = zones.find(
      (z) => normalizeStagingCodeKey(z.code) === codeKey,
    );
    const nextExtras = withoutHiddenSlots(
      withExtraGroundSpot(layoutExtras, code),
      [code],
    );
    await persistLayoutExtras(nextExtras);
    if (existing) {
      if (!isLocationActive(existing)) {
        await updateZone(existing.id, { status: "Active" });
        setZones((prev) =>
          prev.map((z) =>
            z.id === existing.id ? { ...z, status: "Active" as LocationStatus } : z,
          ),
        );
      }
      return;
    }
    await handleMapZoneSave({
      code,
      patch: {
        code,
        label: defaultLabelForSpotCode(code),
        mapOffsetX: 0,
        mapOffsetY: 0,
        mapWidth: SHOP_MAP_GROUND_SPOT_W,
        mapHeight: SHOP_MAP_GROUND_SPOT_H,
        mapRotationDeg: 0,
      },
    });
  }, [handleMapZoneSave, layoutExtras, persistLayoutExtras, zones]);

  const handleAddShelf = useCallback(async () => {
    const layout = resolveShopMapLayout(layoutExtras);
    const unit = nextShelfUnitCode(layout, layoutExtras);
    const unitKey = normalizeStagingCodeKey(unit);
    const existing = zones.find(
      (z) => normalizeStagingCodeKey(z.code) === unitKey,
    );
    const nextExtras = withoutHiddenSlots(
      withExtraShelfUnit(layoutExtras, unit),
      [unit],
    );
    await persistLayoutExtras(nextExtras);
    if (existing) {
      if (!isLocationActive(existing)) {
        await updateZone(existing.id, { status: "Active" });
        setZones((prev) =>
          prev.map((z) =>
            z.id === existing.id ? { ...z, status: "Active" as LocationStatus } : z,
          ),
        );
      }
      return;
    }
    await handleMapZoneSave({
      code: unit,
      patch: {
        code: unit,
        label: defaultLabelForSpotCode(unit),
        mapOffsetX: 0,
        mapOffsetY: 0,
        mapRotationDeg: 0,
      },
    });
  }, [handleMapZoneSave, layoutExtras, persistLayoutExtras, zones]);

  const handleAddSpotToShelf = useCallback(
    async (unit: string) => {
      const layout = resolveShopMapLayout(layoutExtras);
      const letter = nextShelfSpotLetter(layout, unit);
      if (!letter) {
        throw new Error(`No free letters left on ${unit}`);
      }
      const code = shelfSpotCode(unit, letter);
      const nextExtras = withExtraShelfSpot(layoutExtras, unit, letter);
      await persistLayoutExtras(nextExtras);
      await handleMapZoneSave({
        code,
        patch: {
          code,
          label: defaultLabelForSpotCode(code),
          mapOffsetX: 0,
          mapOffsetY: 0,
          mapWidth: 40,
          mapHeight: 32,
        },
      });
    },
    [handleMapZoneSave, layoutExtras, persistLayoutExtras],
  );

  const handleDesignateCatchAll = useCallback(async (zoneId: string) => {
    await updateAppSettings({
      catchAllStagingLocationId: zoneId,
      parcelIntakeEnabled: true,
    });
  }, []);

  const migrateCatchAllFromDefaultGround = useCallback(
    async (
      settings: Awaited<ReturnType<typeof getAppSettings>>,
      loadedZones: StagingLocation[],
    ): Promise<{
      settings: Awaited<ReturnType<typeof getAppSettings>>;
      extras: ShopMapLayoutExtras;
      zones: StagingLocation[];
    }> => {
      let extras = settings.shopMapLayoutExtras ?? {};
      let zones = [...loadedZones];
      const caKey = normalizeStagingCodeKey(CATCH_ALL_ZONE_CODE);

      const patchZoneLocal = (id: string, patch: Partial<StagingLocation>) => {
        zones = zones.map((z) => (z.id === id ? { ...z, ...patch } : z));
      };

      const caId = settings.catchAllStagingLocationId?.trim();
      if (caId) {
        const designated = zones.find((z) => z.id === caId);
        const layoutSlot = designated?.mapLayoutSlot?.trim() ?? "";
        const needsCaSlotRepair =
          designated &&
          layoutSlot &&
          isDefaultGroundLayoutSlot(layoutSlot);
        if (needsCaSlotRepair) {
          await updateZone(designated.id, {
            code: CATCH_ALL_ZONE_CODE,
            mapLayoutSlot: CATCH_ALL_ZONE_CODE,
          });
          patchZoneLocal(designated.id, {
            code: CATCH_ALL_ZONE_CODE,
            mapLayoutSlot: CATCH_ALL_ZONE_CODE,
          });
        }
        if (settings.parcelIntakeEnabled !== true) {
          await updateAppSettings({
            catchAllStagingLocationId: caId,
            parcelIntakeEnabled: true,
          });
          settings = {
            ...settings,
            catchAllStagingLocationId: caId,
            parcelIntakeEnabled: true,
          };
        }
      }

      for (const zone of zones) {
        const slot = zone.mapLayoutSlot?.trim();
        if (
          !slot ||
          !isDefaultGroundLayoutSlot(slot) ||
          normalizeStagingCodeKey(zone.code) !== caKey
        ) {
          continue;
        }
        await updateZone(zone.id, {
          code: CATCH_ALL_ZONE_CODE,
          mapLayoutSlot: CATCH_ALL_ZONE_CODE,
        });
        patchZoneLocal(zone.id, {
          code: CATCH_ALL_ZONE_CODE,
          mapLayoutSlot: CATCH_ALL_ZONE_CODE,
        });
      }

      for (const slot of SHOP_MAP_GROUND_CODES) {
        const slotKey = normalizeStagingCodeKey(slot);
        const onSlot = zones.find(
          (z) =>
            isLocationActive(z) &&
            normalizeStagingCodeKey(z.mapLayoutSlot ?? z.code) === slotKey,
        );
        if (onSlot) {
          if (normalizeStagingCodeKey(onSlot.code) === caKey) {
            // Keep CA identity — never remap a catch-all zone onto G*.
            await updateZone(onSlot.id, {
              code: CATCH_ALL_ZONE_CODE,
              mapLayoutSlot: CATCH_ALL_ZONE_CODE,
            });
            patchZoneLocal(onSlot.id, {
              code: CATCH_ALL_ZONE_CODE,
              mapLayoutSlot: CATCH_ALL_ZONE_CODE,
            });
          } else if (
            !onSlot.mapLayoutSlot ||
            normalizeStagingCodeKey(onSlot.mapLayoutSlot) !== slotKey
          ) {
            await updateZone(onSlot.id, { mapLayoutSlot: slot });
            patchZoneLocal(onSlot.id, { mapLayoutSlot: slot });
          }
          continue;
        }
        const byCode = zones.find(
          (z) =>
            isLocationActive(z) &&
            normalizeStagingCodeKey(z.code) === slotKey,
        );
        if (byCode) {
          await updateZone(byCode.id, { mapLayoutSlot: slot });
          patchZoneLocal(byCode.id, { mapLayoutSlot: slot });
        }
      }

      return { settings, extras, zones };
    },
    [],
  );

  /** One-time cleanup: verify-harness extra G/S spots + inflated G* chip sizes. */
  const pruneVerifyMapPollution = useCallback(
    async (
      extras: ShopMapLayoutExtras,
      loadedZones: StagingLocation[],
      occupancy: Record<string, ZoneOccupancySummary>,
    ): Promise<{ extras: ShopMapLayoutExtras; zones: StagingLocation[] }> => {
      const occupiedKeys = new Set(
        Object.keys(occupancy).map((k) => normalizeStagingCodeKey(k)),
      );
      const isOccupied = (slotOrCode: string) =>
        occupiedKeys.has(normalizeStagingCodeKey(slotOrCode));

      const pruned = pruneUnoccupiedVerifyLayoutExtras(extras, isOccupied);
      let nextExtras = pruned.extras;
      let zones = [...loadedZones];

      if (pruned.changed) {
        await updateAppSettings({ shopMapLayoutExtras: nextExtras });
        const removeKeys = new Set(
          pruned.removedSlots.map((s) => normalizeStagingCodeKey(s)),
        );
        for (const zone of zones) {
          if (!isLocationActive(zone)) continue;
          const slotKey = normalizeStagingCodeKey(
            zone.mapLayoutSlot?.trim() || zone.code,
          );
          const codeKey = normalizeStagingCodeKey(zone.code);
          if (!removeKeys.has(slotKey) && !removeKeys.has(codeKey)) continue;
          // Never deactivate occupied (safety) or catch-all.
          if (
            isOccupied(slotKey) ||
            isOccupied(codeKey) ||
            codeKey === normalizeStagingCodeKey(CATCH_ALL_ZONE_CODE)
          ) {
            continue;
          }
          await deactivateZone(zone.id);
          zones = zones.map((z) =>
            z.id === zone.id ? { ...z, status: "Planned" as const } : z,
          );
        }
      }

      for (const zone of zones) {
        if (!isLocationActive(zone)) continue;
        const slot = (zone.mapLayoutSlot ?? zone.code).trim();
        if (!/^G\d+$/i.test(slot)) continue;
        if (!isInflatedGroundSpotSize(zone.mapWidth, zone.mapHeight)) continue;
        await updateZone(zone.id, {
          mapWidth: SHOP_MAP_GROUND_SPOT_W,
          mapHeight: SHOP_MAP_GROUND_SPOT_H,
        });
        zones = zones.map((z) =>
          z.id === zone.id
            ? {
                ...z,
                mapWidth: SHOP_MAP_GROUND_SPOT_W,
                mapHeight: SHOP_MAP_GROUND_SPOT_H,
              }
            : z,
        );
      }

      return { extras: nextExtras, zones };
    },
    [],
  );

  const handleRemoveCatchAllSpot = useCallback(async () => {
    const nextExtras = withoutCatchAllMarker(layoutExtras);
    await updateAppSettings({
      catchAllStagingLocationId: undefined,
      parcelIntakeEnabled: false,
      shopMapLayoutExtras: nextExtras,
    });
    setLayoutExtras(nextExtras);
  }, [layoutExtras]);

  const handleAddCatchAllSpot = useCallback(async () => {
    const caKey = normalizeStagingCodeKey(CATCH_ALL_ZONE_CODE);
    let caZone = zones.find(
      (z) => normalizeStagingCodeKey(z.code) === caKey,
    );
    let zoneId = caZone?.id;
    if (!zoneId) {
      zoneId = await createZone({
        code: CATCH_ALL_ZONE_CODE,
        label: "Catch-all intake",
        type: "ground",
        status: "Active",
      });
      caZone = {
        id: zoneId,
        code: CATCH_ALL_ZONE_CODE,
        label: "Catch-all intake",
        type: "ground",
        status: "Active",
      };
      setZones((prev) => [...prev, caZone!]);
    }
    await handleDesignateCatchAll(zoneId);
  }, [zones, handleDesignateCatchAll]);

  const handleDeactivateSlots = useCallback(
    async (slots: string[]) => {
      const byKey = new Map(
        zones.map((z) => [normalizeStagingCodeKey(z.code), z]),
      );
      for (const slot of slots) {
        const zone =
          byKey.get(normalizeStagingCodeKey(slot)) ??
          zones.find(
            (z) =>
              z.mapLayoutSlot &&
              normalizeStagingCodeKey(z.mapLayoutSlot) ===
                normalizeStagingCodeKey(slot),
          );
        if (!zone || !isLocationActive(zone)) continue;
        await deactivateZone(zone.id);
        setZones((prev) =>
          prev.map((z) =>
            z.id === zone.id ? { ...z, status: "Inactive" as LocationStatus } : z,
          ),
        );
      }
    },
    [zones],
  );

  const loadZones = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [loaded, occupancy, mappings, settingsRaw] = await Promise.all([
        listAllZones(),
        mapActiveZoneOccupancyByCode(),
        listShopStockMappings(),
        getAppSettings(),
      ]);
      const { settings, extras, zones: repairedZones } =
        await migrateCatchAllFromDefaultGround(
        settingsRaw,
        loaded,
      );
      const { extras: prunedExtras, zones: prunedZones } =
        await pruneVerifyMapPollution(extras, repairedZones, occupancy);
      setZones(prunedZones);
      setLayoutExtras(prunedExtras);
      setCatchAllStagingLocationId(
        settings.catchAllStagingLocationId?.trim() || null,
      );
      setOccupancyByZoneCode(occupancy);
      setShopStockByCode(mapActiveShopStockReservationsByCode(mappings));
      setEslDrafts(
        Object.fromEntries(
          loaded.map((z) => [z.id, z.eslTagId ?? ""]),
        ),
      );
      setLastUpdated(new Date().toLocaleString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load zones");
    } finally {
      setLoading(false);
    }
  }, [migrateCatchAllFromDefaultGround, pruneVerifyMapPollution, setLastUpdated]);

  useEffect(() => {
    return subscribeAppSettings((settings) => {
      setCatchAllStagingLocationId(
        settings.catchAllStagingLocationId?.trim() || null,
      );
      setLayoutExtras(settings.shopMapLayoutExtras ?? {});
    });
  }, []);

  useEffect(() => {
    if (
      zonesSnapshot &&
      refreshGeneration > lastRefreshGeneration.current
    ) {
      lastRefreshGeneration.current = refreshGeneration;
      setZones(zonesSnapshot.zones);
      setOccupancyByZoneCode(zonesSnapshot.occupancyByZoneCode);
      setShopStockByCode(zonesSnapshot.shopStockByCode);
      setEslDrafts(
        Object.fromEntries(
          zonesSnapshot.zones.map((z) => [z.id, z.eslTagId ?? ""]),
        ),
      );
      setLoading(false);
      setError(null);
      return;
    }
    if (refreshGeneration === 0 && zonesSnapshot == null) {
      void loadZones();
    }
  }, [zonesSnapshot, refreshGeneration, loadZones]);

  const selfPlannedLayoutSlots = useMemo(() => {
    const slots = new Set<string>();
    const plannedIds = new Set<string>();

    if (assignInvoiceImportId && assignImportDetails) {
      for (const id of assignImportDetails.draftPlannedStagingLocationIds ?? []) {
        plannedIds.add(id);
      }
    } else if (assignDetails) {
      for (const id of [
        ...(assignDetails.delivery.plannedStagingLocationIds ?? []),
        ...getAllStagingLocationIds(assignDetails.delivery),
      ]) {
        plannedIds.add(id);
      }
    } else {
      return slots;
    }

    for (const layoutSlot of allShopMapSpotCodes(mapLayout)) {
      const zone = resolveStagingLocationForLayoutSlot(
        assignResolveZones,
        layoutSlot,
      );
      if (zone && plannedIds.has(zone.id)) {
        slots.add(layoutSlot);
      }
    }
    return slots;
  }, [
    assignInvoiceImportId,
    assignImportDetails,
    assignDetails,
    mapLayout,
    assignResolveZones,
  ]);

  const zoneForLayoutSlot = useCallback(
    (layoutSlot: string): StagingLocation | undefined =>
      resolveStagingLocationForLayoutSlot(assignResolveZones, layoutSlot),
    [assignResolveZones],
  );

  const displayCodeForLayoutSlot = useCallback(
    (layoutSlot: string): string => {
      const zone = zoneForLayoutSlot(layoutSlot);
      return zone?.code ?? formatStagingCodeCanonical(layoutSlot);
    },
    [zoneForLayoutSlot],
  );

  const showAssignToast = useCallback(
    (message: string, tone: "success" | "error" = "success") => {
      setAssignToast({ message, tone });
      window.setTimeout(() => setAssignToast(null), 3500);
    },
    [],
  );

  const handleAssignSpotClick = useCallback(
    (layoutSlot: string) => {
      if (!assignDeliveryId && !assignInvoiceImportId) return;
      void (async () => {
        const existing = resolveStagingLocationForLayoutSlot(
          assignResolveZones,
          layoutSlot,
        );
        if (existing && !isLocationActive(existing)) {
          showAssignToast("That location is no longer available.", "error");
          setPendingAssignSpot(null);
          return;
        }
        let zone = existing;
        if (!zone?.id || isMapSlotPlaceholderStagingLocation(zone)) {
          try {
            const canonicalCode = formatStagingCodeCanonical(layoutSlot);
            const layoutSlotCanonical = formatStagingCodeCanonical(layoutSlot);
            const createdId = await createZone({
              code: canonicalCode,
              label: defaultLabelForSpotCode(layoutSlot),
              type: inferSpotZoneType(canonicalCode),
              status: "Active",
              mapLayoutSlot: layoutSlotCanonical,
            });
            zone = {
              id: createdId,
              code: canonicalCode,
              label: defaultLabelForSpotCode(layoutSlot),
              type: inferSpotZoneType(canonicalCode),
              status: "Active",
              mapLayoutSlot: layoutSlotCanonical,
            };
            setZones((prev) =>
              prev.some((row) => row.id === createdId) ? prev : [...prev, zone!],
            );
          } catch {
            showAssignToast(
              "Could not resolve that spot — try another.",
              "error",
            );
            return;
          }
        }
        const code = zone.code || displayCodeForLayoutSlot(layoutSlot);
        // Assign merge: refuse re-clicking already-self spots.
        // Change Location (reassign): allow own spots for promote/collapse/no-op.
        if (!reassignMode && selfPlannedLayoutSlots.has(layoutSlot)) {
          return;
        }
        setPendingAssignSpot({ layoutSlot, zoneId: zone.id, code });
      })();
    },
    [
      assignDeliveryId,
      assignInvoiceImportId,
      assignResolveZones,
      displayCodeForLayoutSlot,
      reassignMode,
      selfPlannedLayoutSlots,
      showAssignToast,
    ],
  );

  const handleAssignConfirm = useCallback(async () => {
    if (!pendingAssignSpot || assignSaving) return;

    if (assignInvoiceImportId) {
      setAssignSaving(true);
      try {
        if (approveFlow) {
          let correctionNote: string | undefined;
          try {
            const raw = sessionStorage.getItem(INVOICE_APPROVE_FLOW_STORAGE_KEY);
            if (raw) {
              const parsed = JSON.parse(raw) as {
                importId?: string;
                correctionNote?: string;
              };
              if (parsed.importId === assignInvoiceImportId) {
                correctionNote = parsed.correctionNote;
              }
            }
          } catch {
            sessionStorage.removeItem(INVOICE_APPROVE_FLOW_STORAGE_KEY);
          }

          const result = await approveVendorInvoiceImport({
            vendorInvoiceImportId: assignInvoiceImportId,
            action: "approve",
            fulfillmentDecision: "delivery",
            plannedStagingLocationIds: [pendingAssignSpot.zoneId],
            ...(correctionNote?.trim()
              ? { correctionNote: correctionNote.trim() }
              : {}),
          });
          sessionStorage.removeItem(INVOICE_APPROVE_FLOW_STORAGE_KEY);
          stashInvoiceApproveSuccessToast(
            buildInvoiceApproveToastMessage(result, "delivery"),
          );
          stashInvoiceApproveDismissedImportId(assignInvoiceImportId);
          setPendingAssignSpot(null);
          await refreshPortalData();
          navigate("/dispatcher?focus=needs-review", { replace: true });
          return;
        }

        const result = await setInvoiceReviewDraftStagingLocations({
          vendorInvoiceImportId: assignInvoiceImportId,
          stagingLocationIds: [pendingAssignSpot.zoneId],
        });
        sessionStorage.setItem(
          INVOICE_DRAFT_STAGING_STORAGE_KEY,
          JSON.stringify({
            importId: assignInvoiceImportId,
            draftPlannedStagingLocationIds: result.draftPlannedStagingLocationIds,
          }),
        );
        showAssignToast(
          `${pendingAssignSpot.code} saved as draft — shop occupancy starts on Approve.`,
        );
        setPendingAssignSpot(null);
        navigate(
          `/dispatcher?focus=needs-review&inspectInvoiceImport=${encodeURIComponent(assignInvoiceImportId)}`,
          { replace: true },
        );
      } catch (err) {
        const message =
          err && typeof err === "object" && "message" in err
            ? String((err as { message?: unknown }).message ?? "")
            : "";
        const unavailable = /no longer available/i.test(message);
        const cleaned = message
          .replace(/^Firebase:\s*/i, "")
          .replace(/^Error:\s*/i, "")
          .trim();
        showAssignToast(
          unavailable
            ? "That location is no longer available."
            : approveFlow
              ? cleaned || "Approve failed — import is still pending review."
              : "Failed to save draft staging location.",
          "error",
        );
        if (unavailable) {
          setPendingAssignSpot(null);
          await loadZones();
        }
      } finally {
        setAssignSaving(false);
      }
      return;
    }

    if (!assignDeliveryId || !assignDetails) {
      return;
    }
    setAssignSaving(true);
    const pendingReceive = readPendingManualItemReceive(assignDeliveryId);
    const pendingReceiveMatches = Boolean(
      pendingReceive &&
        pendingItemReceiveId &&
        pendingReceive.itemId === pendingItemReceiveId,
    );
    try {
      if (reassignMode) {
        const result = await firestoreDataService.reassignStagingLocation(
          assignDeliveryId,
          pendingAssignSpot.zoneId,
        );
        if (pendingReceiveMatches && pendingReceive) {
          try {
            await firestoreDataService.updateItemQty(
              pendingReceive.deliveryId,
              pendingReceive.itemId,
              pendingReceive.qtyOrdered,
              pendingReceive.qtyReceived,
              pendingReceive.qtyMissing,
            );
            clearPendingManualItemReceive();
            showAssignToast(
              result.unchanged
                ? `${result.toLocationCode} — item marked received`
                : `Item marked received at ${result.toLocationCode}`,
            );
          } catch (receiveErr) {
            const receiveMessage =
              receiveErr &&
              typeof receiveErr === "object" &&
              "message" in receiveErr
                ? String((receiveErr as { message?: unknown }).message ?? "")
                : "";
            showAssignToast(
              receiveMessage.trim() ||
                "Location saved but marking the item received failed — reopen the delivery and try again.",
              "error",
            );
          }
        } else {
          showAssignToast(
            result.unchanged
              ? `${result.toLocationCode} already assigned`
              : `Changed location to ${result.toLocationCode}`,
          );
        }
        setPendingAssignSpot(null);
        await loadZones();
        exitAssignMode();
      } else if (pendingReceiveMatches && pendingReceive) {
        const updated = await firestoreDataService.updateStagingLocation(
          assignDeliveryId,
          pendingAssignSpot.zoneId,
        );
        if (!updated) {
          showAssignToast("Failed to save staging location.", "error");
          return;
        }
        const spotCode =
          updated.stagingLocation?.code?.trim() || pendingAssignSpot.code;
        try {
          await firestoreDataService.updateItemQty(
            pendingReceive.deliveryId,
            pendingReceive.itemId,
            pendingReceive.qtyOrdered,
            pendingReceive.qtyReceived,
            pendingReceive.qtyMissing,
          );
          clearPendingManualItemReceive();
          showAssignToast(`Item marked received at ${spotCode}`);
        } catch (receiveErr) {
          const receiveMessage =
            receiveErr &&
            typeof receiveErr === "object" &&
            "message" in receiveErr
              ? String((receiveErr as { message?: unknown }).message ?? "")
              : "";
          showAssignToast(
            receiveMessage.trim() ||
              "Location saved but marking the item received failed — reopen the delivery and try again.",
            "error",
          );
        }
        setPendingAssignSpot(null);
        await loadZones();
        exitAssignMode();
      } else {
        const existing = assignDetails.delivery.plannedStagingLocationIds ?? [];
        const merged = [...new Set([...existing, pendingAssignSpot.zoneId])];
        const plannedCode = pendingAssignSpot.code;
        const updated = await firestoreDataService.updatePlannedStagingLocations(
          assignDeliveryId,
          merged,
        );
        if (updated) {
          const jobLabel =
            updated.job?.jobNumber ??
            resolveDeliveryPoNumber(
              updated.delivery.customerPoOrReference,
              updated.purchaseOrder?.poNumber,
            ) ??
            updated.delivery.orderNumber;
          showAssignToast(`${plannedCode} planned for ${jobLabel}`);
          setPendingAssignSpot(null);
          await loadZones();
          // Exit assign mode immediately — clear banner + assignDelivery query so
          // refresh returns to normal Staging Map browse (no manual X required).
          exitAssignMode();
        } else {
          showAssignToast("Failed to save planned location.", "error");
        }
      }
    } catch (err) {
      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message?: unknown }).message ?? "")
          : "";
      // Only the exact destination-race copy maps to "no longer available".
      // Other failed-precondition messages (Will-Call, empty staging, etc.) pass through.
      const unavailable = /no longer available/i.test(message);
      const cleaned = message
        .replace(/^Firebase:\s*/i, "")
        .replace(/^Error:\s*/i, "")
        .trim();
      showAssignToast(
        unavailable
          ? "That location is no longer available."
          : reassignMode
            ? cleaned || "Failed to change location."
            : "Failed to save planned location.",
        "error",
      );
      if (unavailable) {
        setPendingAssignSpot(null);
        await loadZones();
      }
    } finally {
      setAssignSaving(false);
    }
  }, [
    assignDeliveryId,
    assignInvoiceImportId,
    approveFlow,
    assignDetails,
    assignSaving,
    exitAssignMode,
    loadZones,
    navigate,
    pendingAssignSpot,
    refreshPortalData,
    reassignMode,
    showAssignToast,
    pendingItemReceiveId,
    loadZones,
  ]);

  const assignIdentityLabel = useMemo(() => {
    if (assignInvoiceImportId && assignImportDetails) {
      const header = assignImportDetails.parsedHeader;
      const jobNumber = readInvoiceHeaderField(header, "jobNumberRaw");
      const po = readInvoiceHeaderField(header, "customerPoOrReference");
      const invoiceNum = readInvoiceHeaderField(header, "vendorInvoiceNumber");
      const parts: string[] = [];
      if (jobNumber) parts.push(`Job ${jobNumber}`);
      if (po) parts.push(`PO ${po}`);
      if (invoiceNum && parts.length < 2) parts.push(`Invoice ${invoiceNum}`);
      if (parts.length > 0) return parts.join(" / ");
      if (invoiceNum) return `Invoice ${invoiceNum}`;
      return assignImportDetails.id;
    }
    if (!assignDetails) return "this delivery";
    const po = resolveDeliveryPoNumber(
      assignDetails.delivery.customerPoOrReference,
      assignDetails.purchaseOrder?.poNumber,
    );
    if (assignDetails.job?.jobNumber) {
      return po
        ? `${assignDetails.job.jobNumber} / PO ${po}`
        : assignDetails.job.jobNumber;
    }
    return po ?? assignDetails.delivery.orderNumber;
  }, [assignDetails, assignImportDetails, assignInvoiceImportId]);

  const assignSelfPlannedNote = assignInvoiceImportId
    ? "Draft for this invoice"
    : reassignMode
      ? "Current assignment will move to the new spot"
      : "Also assigned to this job";

  const assignDraftNote = assignInvoiceImportId
    ? approveFlow
      ? "Confirm approves this invoice and assigns the selected staging spot."
      : "Selection is saved as a draft after Confirm. Shop occupancy starts only on Approve."
    : pendingItemReceiveId
      ? "Select where received material was physically placed. The line item is marked Delivered only after Confirm — planned spots are suggestions, not automatic confirmation."
      : reassignMode
        ? "Confirm required — Cancel keeps the current location. Reassignment releases the old spot."
        : null;

  const pendingAssignLayoutSlot = pendingAssignSpot?.layoutSlot ?? null;

  const visibleZones = useMemo(
    () => (showInactive ? zones : zones.filter(isLocationActive)),
    [zones, showInactive],
  );

  const groupedZones = useMemo(() => {
    const groups: Record<ZoneType, StagingLocation[]> = {
      ground: [],
      shelf: [],
      bin: [],
      other: [],
    };
    for (const zone of visibleZones) {
      groups[zone.type].push(zone);
    }
    for (const type of ZONE_TYPES) {
      groups[type].sort(sortZones);
    }
    return groups;
  }, [visibleZones]);

  const openEditForm = (zone: StagingLocation) => {
    setEditingId(zone.id);
    setForm(zoneToForm(zone));
    setShowForm(true);
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.code.trim() || !form.label.trim() || saving) return;

    setSaving(true);
    try {
      const data = formToZoneData(form);
      if (editingId) {
        await updateZone(editingId, data);
        setZones((prev) =>
          prev.map((z) => (z.id === editingId ? { ...z, ...data, id: editingId } : z)),
        );
        setEslDrafts((prev) => ({
          ...prev,
          [editingId]: data.eslTagId ?? "",
        }));
      } else {
        const id = await createZone(data);
        const newZone: StagingLocation = { ...data, id };
        setZones((prev) => [...prev, newZone]);
        setEslDrafts((prev) => ({ ...prev, [id]: data.eslTagId ?? "" }));
      }
      cancelForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save zone");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActivePlanned = async (zone: StagingLocation) => {
    const nextStatus: LocationStatus = isLocationActive(zone)
      ? "Planned"
      : "Active";
    try {
      if (nextStatus === "Planned") {
        await deactivateZone(zone.id);
      } else {
        await updateZone(zone.id, { status: "Active" });
      }
      setZones((prev) =>
        prev.map((z) =>
          z.id === zone.id ? { ...z, status: nextStatus } : z,
        ),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update zone status",
      );
    }
  };

  const saveEslTagId = async (zone: StagingLocation) => {
    const value = (eslDrafts[zone.id] ?? "").trim();
    if (value === (zone.eslTagId ?? "")) return;
    try {
      await updateZone(zone.id, { eslTagId: value || undefined });
      setZones((prev) =>
        prev.map((z) =>
          z.id === zone.id ? { ...z, eslTagId: value || undefined } : z,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update ESL tag");
    }
  };

  const activeCount = zones.filter(isLocationActive).length;

  return (
    <PortalShell style={{ fontFamily: FONT }}>

      <PortalSidebar className="print:hidden" />

      {/* Main content — do NOT print:hidden the shell; that blanks Print map */}
      <div
        className={PORTAL_MAIN_CLASS}
        style={{ backgroundColor: "var(--admin-bg)" }}
      >
        <div className="print:hidden">
          <DispatcherPortalTopBar
            title="Staging Map"
            subtitle="Live shop floor"
            lastUpdated={lastUpdated}
            refreshBusy={refreshBusy}
            gmailSyncMessage={gmailSyncMessage}
            onRefreshNow={handleRefreshNow}
          />
        </div>

        <div
          className={PORTAL_SCROLL_CLASS}
          style={{ backgroundColor: "var(--admin-bg)" }}
        >
        <div
          style={{
            padding: "30px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            width: "100%",
            maxWidth: 1440,
            margin: "0 auto",
          }}
        >
          <div className="print:hidden">
            <h1
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: "var(--admin-accent-soft)",
                margin: 0,
                lineHeight: "1.2",
              }}
            >
              Staging Map
            </h1>
            <p style={{ fontSize: 13, color: "var(--admin-text-muted)", marginTop: 4 }}>
              Live floor map — green available, yellow assigned/planned, purple ready
              for pickup, gray shop stock. Click a spot to open the delivery
              drawer.
            </p>
          </div>

          {liveOccupancy.error && (
            <div
              style={{
                ...cardStyle,
                backgroundColor: "var(--admin-danger-bg)",
                color: "var(--admin-danger-text)",
                fontSize: 13,
              }}
            >
              Live map error: {liveOccupancy.error}
            </div>
          )}

          {assignToast ? (
            <div
              data-testid="assign-location-toast"
              data-toast-tone={assignToast.tone}
              role="status"
              style={{
                ...cardStyle,
                padding: "12px 16px",
                backgroundColor:
                  assignToast.tone === "error"
                    ? "var(--admin-danger-bg)"
                    : "var(--admin-success-bg)",
                borderColor:
                  assignToast.tone === "error" ? "#fca5a5" : "#86efac",
                color:
                  assignToast.tone === "error"
                    ? "var(--admin-danger-text)"
                    : "var(--admin-success-text)",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              {assignToast.message}
            </div>
          ) : null}

          {assignMode ? (
            <div
              data-testid="assign-mode-banner"
              data-assign-ready={assignReady ? "true" : "false"}
              data-reassign-mode={reassignMode ? "true" : "false"}
              style={{
                ...cardStyle,
                position: "sticky",
                top: 0,
                zIndex: 20,
                padding: "14px 18px",
                border: "2px solid #ea580c",
                backgroundColor: "var(--admin-warning-bg)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              <div style={{ flex: 1, minWidth: 200 }}>
                {pendingAssignSpot ? (
                  <p
                    style={{
                      margin: 0,
                      fontSize: 16,
                      fontWeight: 700,
                      color: "var(--admin-warning-text)",
                      fontFamily: FONT,
                    }}
                  >
                    {reassignMode ? "Change " : "Assign "}
                    {assignIdentityLabel} to{" "}
                    <strong
                      data-testid="assign-mode-pending-code"
                      style={{ fontFamily: "monospace", fontSize: 20 }}
                    >
                      {pendingAssignSpot.code}
                    </strong>
                    ?
                  </p>
                ) : (
                  <p
                    style={{
                      margin: 0,
                      fontSize: 15,
                      fontWeight: 700,
                      color: "var(--admin-warning-text)",
                      fontFamily: FONT,
                    }}
                  >
                    {assignReady
                      ? reassignMode
                        ? "Click an open spot to change location for "
                        : "Click an open spot to assign "
                      : assignInvoiceImportId
                        ? "Loading invoice and spots for "
                        : "Loading job and spots for "}
                    <span style={{ fontFamily: "monospace" }}>
                      {assignIdentityLabel}
                    </span>
                  </p>
                )}
                {assignDraftNote ? (
                  <p
                    data-testid={
                      reassignMode
                        ? "assign-mode-reassign-note"
                        : "assign-mode-invoice-draft-note"
                    }
                    style={{
                      margin: "8px 0 0",
                      fontSize: 12,
                      lineHeight: 1.45,
                      fontWeight: 500,
                      color: "var(--admin-warning-text)",
                      fontFamily: FONT,
                    }}
                  >
                    {assignDraftNote}
                  </p>
                ) : null}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {pendingAssignSpot ? (
                  <>
                    <button
                      type="button"
                      data-testid="assign-mode-confirm"
                      disabled={assignSaving}
                      onClick={() => void handleAssignConfirm()}
                      style={{
                        padding: "10px 18px",
                        borderRadius: 6,
                        border: "none",
                        backgroundColor: assignSaving ? "#fdba74" : "#ea580c",
                        color: "#1c1917",
                        fontWeight: 800,
                        fontSize: 14,
                        cursor: assignSaving ? "not-allowed" : "pointer",
                        fontFamily: FONT,
                      }}
                    >
                      {assignSaving
                        ? "Saving…"
                        : reassignMode
                          ? "Confirm New Location"
                          : "Confirm"}
                    </button>
                    <button
                      type="button"
                      data-testid="assign-mode-cancel"
                      disabled={assignSaving}
                      onClick={() => setPendingAssignSpot(null)}
                      style={{
                        padding: "10px 18px",
                        borderRadius: 6,
                        border: "1.5px solid #ea580c",
                        backgroundColor: "var(--admin-surface)",
                        color: "var(--admin-warning-text)",
                        fontWeight: 700,
                        fontSize: 14,
                        cursor: assignSaving ? "not-allowed" : "pointer",
                        fontFamily: FONT,
                      }}
                    >
                      Cancel
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  data-testid="assign-mode-exit"
                  aria-label="Exit assign mode"
                  onClick={exitAssignMode}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 6,
                    border: "1.5px solid var(--admin-border)",
                    backgroundColor: "var(--admin-surface)",
                    color: "var(--admin-text-muted)",
                    fontWeight: 700,
                    fontSize: 14,
                    cursor: "pointer",
                    fontFamily: FONT,
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          ) : null}

          <div
            className="shop-floor-map-host admin-card"
            style={{
              ...cardStyle,
              padding: 16,
              maxWidth: "100%",
              minWidth: 0,
              boxSizing: "border-box",
              overflow: "hidden",
            }}
          >
            <ShopFloorMap
              ref={mapRef}
              occupancyByZoneCode={mapOccupancyByZoneCode}
              shopStockByCode={mapShopStockByCode}
              onOpenDelivery={handleMapOpenDelivery}
              editMode={mapEditMode}
              vendorView={vendorView}
              zonesByLayoutSlot={zonesByLayoutSlot}
              onSaveZone={handleMapZoneSave}
              layout={mapLayout}
              onAddGroundSpot={handleAddGroundSpot}
              onAddShelf={handleAddShelf}
              onAddSpotToShelf={handleAddSpotToShelf}
              onPersistLayoutExtras={persistLayoutExtras}
              onDeactivateSlots={handleDeactivateSlots}
              assignMode={assignReady}
              reassignMode={reassignMode}
              assignDeliveryId={
                assignInvoiceImportId ? undefined : (assignDeliveryId ?? undefined)
              }
              pendingAssignLayoutSlot={pendingAssignLayoutSlot}
              selfPlannedLayoutSlots={selfPlannedLayoutSlots}
              selfPlannedNote={assignSelfPlannedNote}
              onAssignSpotClick={handleAssignSpotClick}
              onAssignSpotRefused={(msg) => showAssignToast(msg, "error")}
              focusSpotCode={effectiveFocusSpotCode}
              catchAllPendingCount={catchAllPendingCount}
              onAddCatchAllSpot={handleAddCatchAllSpot}
              onRemoveCatchAllSpot={handleRemoveCatchAllSpot}
              onSpotDeliveryUnavailable={(msg) => showAssignToast(msg, "error")}
              onCatchAllClick={handleCatchAllClick}
              headerActions={
                <>
                  <button
                    type="button"
                    data-testid="staging-map-print-all-location-labels"
                    onClick={() => navigate("/zones/print-labels")}
                    style={{
                      padding: "8px 18px",
                      borderRadius: 4,
                      border: `1px solid ${NAVY}`,
                      backgroundColor: "var(--admin-surface)",
                      color: "var(--admin-accent-soft)",
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: "pointer",
                      fontFamily: FONT,
                    }}
                  >
                    Print location labels
                  </button>
                  <button
                    type="button"
                    data-testid="staging-map-print-map"
                    onClick={() => window.print()}
                    style={{
                      padding: "8px 18px",
                      borderRadius: 4,
                      border: `1px solid ${NAVY}`,
                      backgroundColor: "var(--admin-surface)",
                      color: "var(--admin-accent-soft)",
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: "pointer",
                      fontFamily: FONT,
                    }}
                  >
                    Print map
                  </button>
                  <button
                    type="button"
                    data-testid="shop-map-vendor-view-toggle"
                    aria-pressed={vendorView}
                    title={
                      vendorView
                        ? "Vendor view on — click to return to live map"
                        : "Show wall-sign preview (YOU ARE HERE)"
                    }
                    onClick={() => setVendorView((v) => !v)}
                    style={{
                      padding: "8px 18px",
                      borderRadius: 4,
                      border: vendorView
                        ? "2px solid #ca8a04"
                        : "1px solid var(--admin-border)",
                      backgroundColor: vendorView
                        ? "var(--admin-warning-bg)"
                        : "var(--admin-surface)",
                      color: vendorView
                        ? "var(--admin-warning-text)"
                        : "var(--admin-text)",
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: "pointer",
                      fontFamily: FONT,
                      minWidth: 118,
                    }}
                  >
                    Vendor view
                  </button>
                  <button
                    type="button"
                    data-testid="shop-map-edit-mode-toggle"
                    aria-pressed={mapEditMode}
                    title={
                      mapEditMode
                        ? "Edit mode on — click to finish and save pending changes"
                        : "Edit spot positions and labels"
                    }
                    onClick={() => {
                      if (mapEditMode) {
                        void (async () => {
                          const ok = mapRef.current
                            ? await mapRef.current.persistAllPendingEdits()
                            : true;
                          if (!ok) return;
                          setSelectedDeliveryId(null);
                          setMapEditMode(false);
                        })();
                      } else if (assignMode) {
                        showAssignToast(
                          "Exit assign mode before editing map locations.",
                        );
                      } else {
                        setMapEditMode(true);
                      }
                    }}
                    style={{
                      padding: "8px 18px",
                      borderRadius: 4,
                      border: mapEditMode
                        ? "2px solid #2563eb"
                        : "1px solid var(--admin-border)",
                      backgroundColor: mapEditMode
                        ? "var(--admin-info-bg)"
                        : "var(--admin-surface)",
                      color: mapEditMode
                        ? "var(--admin-info-text)"
                        : "var(--admin-text)",
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: "pointer",
                      fontFamily: FONT,
                      minWidth: 96,
                    }}
                  >
                    {mapEditMode ? "Done editing" : "Edit Locations"}
                  </button>
                  <button
                    type="button"
                    data-testid="shop-map-zone-tools-toggle"
                    aria-pressed={showZoneTools}
                    onClick={() => setShowZoneTools((v) => !v)}
                    style={{
                      padding: "8px 18px",
                      borderRadius: 4,
                      border: showZoneTools
                        ? "2px solid #64748b"
                        : "1px solid var(--admin-border)",
                      backgroundColor: showZoneTools
                        ? "#e8eef5"
                        : "var(--admin-surface)",
                      color: "var(--admin-text)",
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: "pointer",
                      fontFamily: FONT,
                      minWidth: 96,
                    }}
                  >
                    Zone tools
                  </button>
                </>
              }
            />
            {!liveOccupancy.ready && (
              <p style={{ fontSize: 12, color: "var(--admin-text-muted)", marginTop: 8 }}>
                Connecting live occupancy…
              </p>
            )}
          </div>

          {showZoneTools && (
          <>
          <div
            className="flex items-center gap-3 print:hidden"
            style={{ ...cardStyle, padding: "12px 16px" }}
          >
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                color: "var(--admin-text)",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
              />
              Show inactive zones
            </label>
            <span style={{ fontSize: 12, color: "var(--admin-text-muted)" }}>
              {activeCount} active · {zones.length} total
            </span>
          </div>

          {error && (
            <div
              style={{
                ...cardStyle,
                padding: "16px 20px",
                borderColor: "#fca5a5",
                backgroundColor: "var(--admin-danger-bg)",
                color: "var(--admin-danger-text)",
                fontSize: 14,
              }}
            >
              {error}
              <button
                type="button"
                onClick={() => void loadZones()}
                style={{
                  marginLeft: 12,
                  padding: "4px 10px",
                  borderRadius: 4,
                  border: "1px solid #b91c1c",
                  backgroundColor: "var(--admin-surface)",
                  color: "var(--admin-danger-text)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: FONT,
                }}
              >
                Retry
              </button>
            </div>
          )}

          {showForm && (
            <div style={{ ...cardStyle, padding: "20px" }}>
              <h2
                style={{
                  margin: "0 0 16px",
                  fontSize: 15,
                  fontWeight: 700,
                  color: "var(--admin-accent-soft)",
                }}
              >
                Edit Zone
              </h2>
              <form onSubmit={(e) => void handleSubmit(e)}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: 16,
                    marginBottom: 16,
                  }}
                >
                  <div>
                    <label style={labelStyle}>
                      Code <span style={{ color: RED }}>*</span>
                    </label>
                    <input
                      style={inputStyle}
                      value={form.code}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, code: e.target.value }))
                      }
                      required
                      placeholder="G1"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>
                      Label <span style={{ color: RED }}>*</span>
                    </label>
                    <input
                      style={inputStyle}
                      value={form.label}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, label: e.target.value }))
                      }
                      required
                      placeholder="Ground 1"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Type</label>
                    <select
                      style={inputStyle}
                      value={form.type}
                      onChange={(e) => {
                        const type = e.target.value as ZoneType;
                        const defaults = defaultDimensionsForType(type);
                        setForm((f) => ({
                          ...f,
                          type,
                          widthFt: defaults.widthFt,
                          depthFt: defaults.depthFt,
                        }));
                      }}
                    >
                      {ZONE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Status</label>
                    <select
                      style={inputStyle}
                      value={form.status}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          status: e.target.value as LocationStatus,
                        }))
                      }
                    >
                      {LOCATION_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {LOCATION_STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Sort Order</label>
                    <input
                      style={inputStyle}
                      type="number"
                      value={form.sortOrder}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, sortOrder: e.target.value }))
                      }
                      placeholder="1"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Minew ESL Tag ID</label>
                    <input
                      style={inputStyle}
                      value={form.eslTagId}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, eslTagId: e.target.value }))
                      }
                      placeholder="E0000001BC48"
                    />
                    <p style={{ fontSize: 11, color: "var(--admin-text-muted)", marginTop: 4 }}>
                      {ESL_TAG_HINT[form.type]}
                    </p>
                  </div>
                  <div>
                    <label style={labelStyle}>Width (ft)</label>
                    <input
                      style={inputStyle}
                      type="number"
                      min={0}
                      step={0.5}
                      value={form.widthFt}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, widthFt: e.target.value }))
                      }
                      placeholder="3"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Depth (ft)</label>
                    <input
                      style={inputStyle}
                      type="number"
                      min={0}
                      step={0.5}
                      value={form.depthFt}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, depthFt: e.target.value }))
                      }
                      placeholder="3"
                    />
                    <p style={{ fontSize: 11, color: "var(--admin-text-muted)", marginTop: 4 }}>
                      Used to suggest spot sizes during check-in
                    </p>
                  </div>
                  <div>
                    <label style={labelStyle}>Adjacent Group ID</label>
                    <input
                      style={inputStyle}
                      data-testid="zone-adjacent-group-id"
                      value={form.adjacentGroupId}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          adjacentGroupId: e.target.value,
                        }))
                      }
                      placeholder="pipe-row-a"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Size Class</label>
                    <input
                      style={inputStyle}
                      data-testid="zone-size-class"
                      value={form.sizeClass}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, sizeClass: e.target.value }))
                      }
                      placeholder="standard / large"
                    />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={labelStyle}>Notes</label>
                    <input
                      style={inputStyle}
                      value={form.notes}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, notes: e.target.value }))
                      }
                      placeholder="Near dock entrance"
                    />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="submit"
                    disabled={
                      saving || !form.code.trim() || !form.label.trim()
                    }
                    style={{
                      padding: "8px 18px",
                      borderRadius: 4,
                      border: "none",
                      backgroundColor:
                        saving || !form.code.trim() || !form.label.trim()
                          ? "var(--admin-surface-2)"
                          : NAVY,
                      color:
                        saving || !form.code.trim() || !form.label.trim()
                          ? "var(--admin-text-muted)"
                          : "#fff",
                      fontWeight: 700,
                      fontSize: 13,
                      cursor:
                        saving || !form.code.trim() || !form.label.trim()
                          ? "not-allowed"
                          : "pointer",
                      fontFamily: FONT,
                    }}
                  >
                    {saving ? "Saving…" : editingId ? "Save Changes" : "Create Zone"}
                  </button>
                  <button
                    type="button"
                    onClick={cancelForm}
                    style={{
                      padding: "8px 18px",
                      borderRadius: 4,
                      border: "1.5px solid var(--admin-border)",
                      backgroundColor: "var(--admin-surface)",
                      color: "var(--admin-text-muted)",
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: "pointer",
                      fontFamily: FONT,
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {loading ? (
            <div
              style={{
                ...cardStyle,
                padding: "40px 20px",
                textAlign: "center",
                color: "var(--admin-text-muted)",
                fontSize: 14,
              }}
            >
              Loading zones…
            </div>
          ) : visibleZones.length === 0 ? (
            <div
              style={{
                ...cardStyle,
                padding: "40px 20px",
                textAlign: "center",
                color: "var(--admin-text-muted)",
                fontSize: 14,
              }}
            >
              No zones found. Add a zone to get started.
            </div>
          ) : (
            ZONE_TYPES.map((type) => {
              const typeZones = groupedZones[type];
              if (typeZones.length === 0) return null;
              return (
                <div key={type} style={{ ...cardStyle, overflow: "hidden" }}>
                  <div
                    style={{
                      padding: "15px 20px",
                      borderBottom: "1px solid var(--admin-border)",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <span style={{ fontWeight: 700, fontSize: 15, color: "var(--admin-accent-soft)" }}>
                      {TYPE_LABELS[type]}
                    </span>
                    <span style={typeBadgeStyle(type)}>{type}</span>
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--admin-text-muted)",
                        fontWeight: 500,
                      }}
                    >
                      {typeZones.length}{" "}
                      {typeZones.length === 1 ? "zone" : "zones"}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fill, minmax(320px, 1fr))",
                      gap: 16,
                      padding: 20,
                    }}
                  >
                    {typeZones.map((zone) => {
                      const occupancy = zoneOccupancy(
                        zone.code,
                        mapOccupancyByZoneCode,
                      );
                      const shopStock = zoneShopStockReservation(
                        zone.code,
                        mapShopStockByCode,
                      );
                      const qrUrl = buildZoneEslQrUrl(zone.code, occupancy);
                      const permanentSignUrl = buildPermanentLocationUrl(
                        zone.code,
                        { forPrint: true },
                      );
                      const eslStatus = formatZoneEslStatusLine(occupancy);
                      const tagLinked = Boolean(zone.eslTagId?.trim());
                      return (
                        <div
                          key={zone.id}
                          style={{
                            border: "1px solid var(--admin-border)",
                            borderRadius: "var(--admin-radius-md)",
                            padding: 16,
                            backgroundColor: isLocationActive(zone)
                              ? "var(--admin-surface)"
                              : "var(--admin-surface-2)",
                            opacity: isLocationActive(zone) ? 1 : 0.75,
                          }}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div
                                style={{
                                  fontSize: 28,
                                  fontWeight: 900,
                                  color: "var(--admin-accent-soft)",
                                  lineHeight: 1,
                                  letterSpacing: "-0.02em",
                                }}
                              >
                                {zone.code}
                              </div>
                              <div
                                style={{
                                  fontSize: 14,
                                  fontWeight: 600,
                                  color: "var(--admin-text)",
                                  marginTop: 4,
                                  display: "flex",
                                  alignItems: "center",
                                  flexWrap: "wrap",
                                  gap: 4,
                                }}
                              >
                                {zone.label}
                                <span style={statusBadgeStyle(zone.status)}>
                                  {LOCATION_STATUS_LABEL[zone.status]}
                                </span>
                              </div>
                              <div style={{ marginTop: 6 }}>
                                <span style={typeBadgeStyle(zone.type)}>
                                  {TYPE_LABELS[zone.type]}
                                </span>
                              </div>
                            </div>
                            <div style={{ textAlign: "center", flexShrink: 0 }}>
                              <p
                                style={{
                                  fontSize: 9,
                                  fontWeight: 700,
                                  color: "var(--admin-text-muted)",
                                  margin: "0 0 4px",
                                  textTransform: "uppercase",
                                  letterSpacing: "0.06em",
                                }}
                              >
                                E-ink QR preview
                              </p>
                              <EslQrCode value={qrUrl} variant="preview" />
                            </div>
                          </div>

                          <div
                            data-testid="permanent-location-sign"
                            style={{
                              marginTop: 14,
                              padding: "12px 14px",
                              borderRadius: 8,
                              border: `1.5px solid ${NAVY}`,
                              backgroundColor: "var(--admin-surface-2)",
                            }}
                          >
                            <p
                              style={{
                                fontSize: 9,
                                fontWeight: 700,
                                color: "var(--admin-accent-soft)",
                                margin: "0 0 8px",
                                textTransform: "uppercase",
                                letterSpacing: "0.06em",
                              }}
                            >
                              Permanent location sign (print)
                            </p>
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                gap: 10,
                              }}
                            >
                              <p
                                style={{
                                  fontSize: 36,
                                  fontWeight: 900,
                                  color: "#000",
                                  margin: 0,
                                  fontFamily: FONT,
                                  lineHeight: 1,
                                }}
                              >
                                {zone.code}
                              </p>
                              <div
                                style={{
                                  padding: 8,
                                  border: "2px solid #000",
                                  backgroundColor: "var(--admin-surface)",
                                  lineHeight: 0,
                                }}
                              >
                                <EslQrCode
                                  value={permanentSignUrl}
                                  variant="preview"
                                />
                              </div>
                              <p
                                style={{
                                  fontSize: 32,
                                  lineHeight: 1,
                                  margin: 0,
                                  color: "#000",
                                  fontWeight: 900,
                                }}
                                aria-hidden
                              >
                                ↓
                              </p>
                              <button
                                type="button"
                                data-testid="permanent-location-print-letter"
                                onClick={() =>
                                  navigate(
                                    `/zones/print-label?loc=${encodeURIComponent(zone.code)}`,
                                  )
                                }
                                style={{
                                  marginTop: 4,
                                  padding: "6px 12px",
                                  borderRadius: 4,
                                  border: `1px solid ${NAVY}`,
                                  backgroundColor: "var(--admin-surface)",
                                  color: "var(--admin-accent-soft)",
                                  fontWeight: 700,
                                  fontSize: 12,
                                  cursor: "pointer",
                                  fontFamily: FONT,
                                }}
                              >
                                Print letter label
                              </button>
                            </div>
                            <p
                              style={{
                                fontSize: 10,
                                color: "var(--admin-text-muted)",
                                marginTop: 8,
                                marginBottom: 0,
                                wordBreak: "break-all",
                              }}
                            >
                              Permanent URL: {permanentSignUrl}
                            </p>
                          </div>

                          <div
                            style={{
                              marginTop: 12,
                              padding: "10px 12px",
                              borderRadius: 6,
                              backgroundColor: occupancy ? "var(--admin-success-bg)" : "var(--admin-surface-2)",
                              border: `1px solid ${occupancy ? "var(--admin-success-border)" : "var(--admin-border)"}`,
                            }}
                          >
                            <div
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                color: occupancy ? "var(--admin-success-text)" : "var(--admin-text-muted)",
                                textTransform: "uppercase",
                                letterSpacing: "0.05em",
                              }}
                            >
                              {occupancy ? "Occupied on tag" : "Available on tag"}
                            </div>
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: "var(--admin-text-data)",
                                marginTop: 4,
                              }}
                            >
                              {eslStatus}
                            </div>
                          </div>

                          {shopStock && (
                            <div
                              data-testid="zone-shop-stock-reserved"
                              style={{
                                marginTop: 10,
                                padding: "10px 12px",
                                borderRadius: 6,
                                backgroundColor: "var(--admin-warning-bg)",
                                border: "1px solid #fdba74",
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  color: "var(--admin-warning-text)",
                                  textTransform: "uppercase",
                                  letterSpacing: "0.05em",
                                }}
                              >
                                Permanent shop stock
                              </div>
                              <div
                                style={{
                                  fontSize: 12,
                                  color: "var(--admin-warning-text)",
                                  marginTop: 4,
                                  lineHeight: 1.4,
                                }}
                              >
                                {shopStock.stockItemLabel}
                              </div>
                            </div>
                          )}

                          {zone.notes && (
                            <p
                              style={{
                                fontSize: 12,
                                color: "var(--admin-text-muted)",
                                marginTop: 10,
                                marginBottom: 0,
                              }}
                            >
                              {zone.notes}
                            </p>
                          )}

                          <div style={{ marginTop: 12 }}>
                            <label style={{ ...labelStyle, fontSize: 11 }}>
                              Minew ESL Tag ID
                            </label>
                            <input
                              style={{
                                ...inputStyle,
                                padding: "6px 10px",
                                fontSize: 13,
                              }}
                              value={eslDrafts[zone.id] ?? ""}
                              onChange={(e) =>
                                setEslDrafts((d) => ({
                                  ...d,
                                  [zone.id]: e.target.value,
                                }))
                              }
                              onBlur={() => void saveEslTagId(zone)}
                              placeholder="E0000001BC48"
                            />
                            <p style={{ fontSize: 10, color: "var(--admin-text-muted)", marginTop: 4 }}>
                              {ESL_TAG_HINT[zone.type]}
                              {!tagLinked && " · Required to push to Minew"}
                            </p>
                          </div>

                          <p
                            style={{
                              fontSize: 10,
                              color: "var(--admin-text-muted)",
                              marginTop: 8,
                              wordBreak: "break-all",
                            }}
                          >
                            Tag QR: {qrUrl}
                          </p>

                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              marginTop: 12,
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => openEditForm(zone)}
                              style={{
                                padding: "4px 12px",
                                borderRadius: 4,
                                border: `1.5px solid ${NAVY}`,
                                backgroundColor: "var(--admin-surface)",
                                color: "var(--admin-accent-soft)",
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: "pointer",
                                fontFamily: FONT,
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleToggleActivePlanned(zone)}
                              style={{
                                padding: "4px 12px",
                                borderRadius: 4,
                                border: isLocationActive(zone)
                                  ? "1.5px solid #fca5a5"
                                  : `1.5px solid ${NAVY}`,
                                backgroundColor: "var(--admin-surface)",
                                color: isLocationActive(zone) ? "var(--admin-danger-text)" : NAVY,
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: "pointer",
                                fontFamily: FONT,
                              }}
                            >
                              {isLocationActive(zone)
                                ? "Space is assigned"
                                : "Set Active"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}

          </>
          )}

          <div style={{ marginTop: 24 }} className="print:hidden">
            <ShopStockDirectoryPanel />
          </div>

        </div>
        </div>
      </div>

      <DeliveryDetailDrawer
        deliveryId={selectedDeliveryId}
        onClose={() => setSelectedDeliveryId(null)}
        onDataChanged={() => void loadZones()}
        onOpenDelivery={(id) => {
          setCatchAllStatusOpen(false);
          setSelectedDeliveryId(id);
        }}
      />

      <CatchAllStatusDrawer
        open={catchAllStatusOpen}
        pendingCount={catchAllPendingCount}
        onClose={() => setCatchAllStatusOpen(false)}
      />

      <style>{`
        /* Dispatcher: door visible; YOU ARE HERE only in Vendor view (and print) */
        .shop-map-you-are-here { display: none !important; }
        .shop-floor-map--vendor .shop-map-you-are-here {
          display: flex !important;
        }
        .shop-map-last-edited { display: none !important; }
        .shop-map-door { display: block; }

        @media print {
          @page {
            size: letter landscape;
            margin: 0.4in;
          }
          .print\\:hidden { display: none !important; }
          html, body {
            background: #fff !important;
            margin: 0 !important;
            padding: 0 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .portal-shell {
            display: block !important;
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            background: #fff !important;
          }
          .portal-main,
          .portal-scroll {
            display: block !important;
            overflow: visible !important;
            height: auto !important;
            max-height: none !important;
            background: #fff !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .shop-floor-map-host {
            position: static !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 12px !important;
            border: none !important;
            box-shadow: none !important;
            background: #fff !important;
            break-inside: avoid;
          }
          [data-testid="shop-map-edit-panel"],
          [data-testid="shop-map-edit-mode-banner"],
          [data-testid="shop-map-resize-handle"],
          [data-testid="shop-map-yah-resize-handle"],
          [data-testid="shop-map-door-resize-handle"],
          [data-testid="shop-map-door-rotate-cw"],
          [data-testid="shop-map-door-rotate-ccw"],
          [data-testid="shop-map-marquee"],
          [data-testid="shop-map-add-bar"],
          [data-testid="shop-map-view-controls"],
          .shop-map-unplaced,
          .shop-map-legend {
            display: none !important;
          }
          [data-testid="shop-map-viewport"] {
            overflow: visible !important;
            max-height: none !important;
            border: none !important;
            background: transparent !important;
          }
          [data-testid="shop-map-zoom-spacer"] {
            width: auto !important;
            height: auto !important;
          }
          [data-testid="shop-map-canvas"] {
            position: relative !important;
            transform: none !important;
            width: auto !important;
            height: auto !important;
            min-height: 420px !important;
          }

          /* Bold wall-poster guide — location only, no live status colors */
          .shop-floor-map h2 {
            font-size: 28px !important;
            font-weight: 900 !important;
            letter-spacing: 0.6px !important;
            color: #0a3161 !important;
          }
          .shop-floor-map [data-testid^="shop-spot-"] {
            background-color: #fff !important;
            color: #0a3161 !important;
            border: 3px solid #0a3161 !important;
            font-weight: 900 !important;
            font-size: 16px !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .shop-floor-map [data-testid^="shop-shelf-"][data-testid$="-title"] {
            font-size: 20px !important;
            font-weight: 900 !important;
            color: #0a3161 !important;
          }
          .shop-floor-map [data-testid="shop-map-canvas"] {
            background: #fff !important;
            border: 3px solid #0a3161 !important;
            border-radius: 0 !important;
          }
          .shop-map-you-are-here {
            display: flex !important;
            border-radius: 50% !important;
            background: #ffe600 !important;
            color: #111 !important;
            font-weight: 900 !important;
            line-height: 1.15 !important;
            box-shadow: none !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .shop-map-door-wrap {
            outline: none !important;
          }
          .shop-map-door {
            display: block !important;
          }
          .shop-map-door line,
          .shop-map-door-leaf {
            stroke: #0a3161 !important;
            stroke-width: 4 !important;
          }
          .shop-map-door-swing {
            stroke: #0a3161 !important;
            stroke-width: 3 !important;
            stroke-dasharray: 5 4 !important;
          }
          .shop-map-last-edited {
            display: block !important;
            position: fixed !important;
            right: 0.45in !important;
            bottom: 0.35in !important;
            margin: 0 !important;
            font-size: 11px !important;
            font-weight: 700 !important;
            color: #111 !important;
            text-align: right !important;
          }
        }
      `}</style>
    </PortalShell>
  );
}
