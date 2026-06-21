import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  firestoreDataService,
  getAppSettings,
  getDeliveryDetailsPublic,
  loadPickupReadyDeliveriesPublic,
  markDeliveryInstalled,
  reportMaterialIssue,
} from "./dispatcher/firestoreService";
import {
  getAllStagingLocationIds,
  MATERIAL_ISSUE_TYPE_LABEL,
  type DeliveryDetails,
  type DeliveryStatus,
  type MaterialIssueType,
  type StagingLocation,
} from "./dispatcher/models";
import {
  hasShopStockPickList,
  shopStockItemKey,
} from "./dispatcher/shopStockPickList";
import { shopStockPickListLabels } from "./dispatcher/shopStockMapping";
import { formatPickupError } from "./dispatcher/pickupErrors";
import {
  resolveZoneScanDisposition,
  syncScanIntent,
} from "./scanRouting";
import { normalizePickupHash, parseScannedQr, readPickupParams } from "./receiveQrUrls";
import { validatePickupTokenClient } from "./validatePickupTokenClient";
import { QrScannerOverlay } from "./QrScannerOverlay";
import { normalizeStagingCodeKey } from "./dispatcher/stagingCode";
import { PublicNetworkErrorPanel } from "./PublicNetworkErrorPanel";

const icons = {
  check: "M5 13l4 4L19 7",
  camera:
    "M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z M15 13a3 3 0 11-6 0 3 3 0 016 0z",
  square: "M4 4h16v16H4z",
  checkSquare:
    "M9 11l3 3L22 4 M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11",
};

function Svg({ d, size = 24 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

function isPickupReady(status: DeliveryStatus): boolean {
  return (
    status === "ready_for_pickup" ||
    status === "picked_up" ||
    status === "installed"
  );
}

function pickupQueueSortRank(status: DeliveryStatus): number {
  if (status === "ready_for_pickup") return 0;
  if (status === "picked_up" || status === "installed") return 1;
  if (status === "partial" || status === "arrived") return 2;
  return 3;
}

function publicNotReadyDetailLabel(status: DeliveryStatus): string | null {
  if (status === "partial") return "Not ready — partial receipt";
  if (status === "arrived") return "Not ready — awaiting staging";
  return null;
}

function isStagedItemsCheckedOff(
  delivery: DeliveryDetails,
  checkedItemIds: Set<string>,
): boolean {
  return (
    delivery.items.length === 0 ||
    delivery.items.every((item) => checkedItemIds.has(item.id))
  );
}

function isDeliveryAlreadyPickedUp(delivery: DeliveryDetails): boolean {
  const status = delivery.delivery.status;
  return status === "picked_up" || status === "installed";
}

function shopStockPullStateLabel(
  stockChecked: boolean,
  deliveryPickedUp: boolean,
): string {
  if (deliveryPickedUp) return "Staged";
  if (stockChecked) return "Pulled";
  return "Not Pulled";
}

function formatCountdown(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function zoneSummary(deliveries: DeliveryDetails[]): string {
  const zones = deliveries
    .flatMap((d) => {
      const ids = getAllStagingLocationIds(d.delivery);
      if (ids.length === 0) return [d.stagingLocation?.code ?? "—"];
      return ids.map((id) => {
        if (id === d.stagingLocation?.id) return d.stagingLocation?.code ?? "—";
        return id;
      });
    })
    .join(", ");
  const vendors = [...new Set(deliveries.map((d) => d.vendor.name))].join(", ");
  return `${zones} · ${vendors}`;
}

function resolveStagingLocations(
  delivery: DeliveryDetails,
  allLocations: StagingLocation[],
): { code: string; label: string; isPrimary: boolean }[] {
  const ids = getAllStagingLocationIds(delivery.delivery);
  return ids.map((id, idx) => {
    const loc =
      allLocations.find((l) => l.id === id) ??
      (delivery.stagingLocation?.id === id
        ? delivery.stagingLocation
        : undefined);
    return {
      code: loc?.code ?? id,
      label: loc?.label ?? loc?.code ?? id,
      isPrimary: idx === 0,
    };
  });
}

function primaryStagingCode(
  delivery: DeliveryDetails,
  allLocations: StagingLocation[],
): string {
  const stagingLocations = resolveStagingLocations(delivery, allLocations);
  const primary =
    stagingLocations.find((loc) => loc.isPrimary) ?? stagingLocations[0];
  return primary?.code ?? "—";
}

/** Public pickup status — hide internal workflow labels (Partial, Complete, etc.). */
function publicPickupStatusLabel(status: DeliveryStatus): string | null {
  if (status === "ready_for_pickup") return "Ready for pickup";
  if (status === "picked_up") return "Picked up";
  if (status === "installed") return "Installed";
  return null;
}

function formatPickupItemLine(
  poNumber: string | undefined,
  description: string,
  qty: number,
): string {
  const po = poNumber?.trim();
  const poPrefix = po ? `${po} · ` : "";
  return `${poPrefix}${description} · Qty ${qty}`;
}

/** Show vendor on cards only when the same SKU appears on multiple deliveries. */
function deliveryIdsWithDuplicateSkus(
  deliveries: DeliveryDetails[],
): Set<string> {
  const skuOwners = new Map<string, Set<string>>();
  for (const d of deliveries) {
    for (const item of d.items) {
      const sku = item.sku?.trim();
      if (!sku) continue;
      const owners = skuOwners.get(sku) ?? new Set<string>();
      owners.add(d.delivery.id);
      skuOwners.set(sku, owners);
    }
  }
  const duplicateDeliveryIds = new Set<string>();
  for (const owners of skuOwners.values()) {
    if (owners.size > 1) {
      for (const id of owners) duplicateDeliveryIds.add(id);
    }
  }
  return duplicateDeliveryIds;
}

function usefulLocationNote(note: string | undefined): string | null {
  const trimmed = note?.trim();
  return trimmed ? trimmed : null;
}

function shopStockLocationGroupHeader(delivery: {
  shopStockLocationNote?: string;
  shopStockLines?: { shopStockLocationCode?: string }[];
}): string | null {
  const note = usefulLocationNote(delivery.shopStockLocationNote);
  if (note) return note;
  const code = delivery.shopStockLines?.[0]?.shopStockLocationCode?.trim();
  return code ? code : null;
}

function PickupLocationBlock({
  stagingLocations,
  currentLocationNote,
  shopStockLocationNote,
}: {
  stagingLocations: { code: string; label: string; isPrimary: boolean }[];
  currentLocationNote?: string;
  shopStockLocationNote?: string;
}) {
  const primary = stagingLocations.find((loc) => loc.isPrimary) ?? stagingLocations[0];
  const additional = stagingLocations.filter((loc) => !loc.isPrimary);
  const findAt = usefulLocationNote(currentLocationNote);
  const shopStockAt = usefulLocationNote(shopStockLocationNote);

  return (
    <div className="space-y-1.5 text-sm leading-snug" data-testid="pickup-location-block">
      <p className="text-text-primary">
        <span className="text-text-secondary">Pickup at: </span>
        <span
          className="text-lg font-bold text-accent"
          data-testid="pickup-at-primary"
          title={primary?.label}
        >
          {primary?.code ?? "—"}
        </span>
      </p>
      {additional.length > 0 && (
        <p className="text-text-primary" data-testid="pickup-also-check">
          <span className="text-text-secondary">Also check: </span>
          <span className="font-semibold">
            {additional.map((loc) => loc.code).join(", ")}
          </span>
        </p>
      )}
      {findAt && (
        <p className="text-text-primary" data-testid="pickup-find-at">
          <span className="text-text-secondary">Find it at: </span>
          <span className="font-medium">{findAt}</span>
        </p>
      )}
      {shopStockAt && (
        <p className="text-text-primary" data-testid="pickup-shop-stock-location">
          <span className="text-text-secondary">Shop stock: </span>
          <span className="font-medium">{shopStockAt}</span>
        </p>
      )}
    </div>
  );
}

function extractJobIdFromPickupUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.includes("pickup") || !trimmed.includes("job=")) {
    return null;
  }

  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const url = new URL(trimmed);
      const fromHash = url.hash.match(/[?&]job=([^&]+)/);
      if (fromHash) return decodeURIComponent(fromHash[1]);
      const fromSearch = url.searchParams.get("job");
      if (fromSearch) return fromSearch;
    }
  } catch {
    // fall through to string parsing
  }

  const match = trimmed.match(/[#?&]job=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function WalkUpEntry({
  onJobResolved,
  initialNotFoundCode = null,
}: {
  onJobResolved: (jobId: string, highlightDeliveryId: string | null) => void;
  initialNotFoundCode?: string | null;
}) {
  const [isScanning, setIsScanning] = useState(false);
  const [notFoundCode, setNotFoundCode] = useState<string | null>(
    initialNotFoundCode,
  );
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualZoneCode, setManualZoneCode] = useState("");
  const [resolving, setResolving] = useState(false);

  const handleDecodedText = useCallback(
    async (text: string) => {
      const parsed = parseScannedQr(text);
      const intent = syncScanIntent(parsed);
      if (intent.kind === "navigate" && parsed.kind === "pickup" && parsed.jobId) {
        setNotFoundCode(null);
        setIsScanning(false);
        setShowManualEntry(false);
        setManualZoneCode("");
        onJobResolved(parsed.jobId, parsed.deliveryId);
        return;
      }

      const trimmed = text.trim();
      const jobId = extractJobIdFromPickupUrl(trimmed);
      if (jobId) {
        setNotFoundCode(null);
        setIsScanning(false);
        setShowManualEntry(false);
        setManualZoneCode("");
        onJobResolved(jobId, null);
        return;
      }

      setResolving(true);
      const zoneCode =
        intent.kind === "resolve-zone"
          ? intent.zoneCode
          : normalizeStagingCodeKey(trimmed);
      const resolved =
        intent.kind === "resolve-zone" || trimmed
          ? await resolveZoneScanDisposition(zoneCode)
          : null;
      setResolving(false);
      if (!resolved) {
        setNotFoundCode(trimmed);
        setIsScanning(false);
        return;
      }
      if (resolved.kind === "receive") {
        setNotFoundCode(
          "Not ready for pickup — scan again after the zone tag shows a pickup QR.",
        );
        setIsScanning(false);
        return;
      }
      setNotFoundCode(null);
      setIsScanning(false);
      setShowManualEntry(false);
      setManualZoneCode("");
      onJobResolved(resolved.jobId, resolved.deliveryId);
    },
    [onJobResolved],
  );

  const handleScanDecode = useCallback(
    (text: string) => {
      void handleDecodedText(text);
    },
    [handleDecodedText],
  );

  const handleCancelScan = useCallback(() => {
    setIsScanning(false);
  }, []);

  if (isScanning) {
    return (
      <QrScannerOverlay
        readerId="entry-reader"
        title="Pickup Portal"
        onDecode={handleScanDecode}
        onCancel={handleCancelScan}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col px-6 py-12">
      {notFoundCode && (
        <div className="mb-6 rounded-xl border border-accent-red/30 bg-accent-red/10 px-4 py-3 text-accent-red">
          <p className="font-medium">
            No pickup-ready delivery at zone {notFoundCode}
          </p>
          <button
            onClick={() => setNotFoundCode(null)}
            className="mt-3 action-btn action-btn-secondary text-sm py-2"
          >
            Try Again
          </button>
        </div>
      )}

      <div
        onClick={() => {
          if (resolving) return;
          setNotFoundCode(null);
          setIsScanning(true);
        }}
        className="flex-1 bg-bg-surface rounded-2xl flex flex-col items-center justify-center gap-4 cursor-pointer active:scale-[0.98] transition-transform border border-border"
      >
        <div className="size-24 rounded-full bg-accent/10 text-accent flex items-center justify-center">
          <Svg d={icons.camera} size={48} />
        </div>
        <span className="text-xl font-bold text-text-primary">
          Scan Zone QR
        </span>
        <span className="text-sm text-text-secondary">
          Tap to scan a staging zone label
        </span>
      </div>

      <div className="mt-8 text-center">
        {!showManualEntry ? (
          <button
            type="button"
            onClick={() => setShowManualEntry(true)}
            className="text-text-secondary text-sm underline bg-transparent border-none cursor-pointer"
          >
            Enter zone code manually
          </button>
        ) : (
          <div className="space-y-3">
            <input
              type="text"
              value={manualZoneCode}
              onChange={(e) => setManualZoneCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleDecodedText(manualZoneCode);
              }}
              placeholder="Zone code (e.g. s1a or G2)"
              className="w-full bg-bg-surface border border-border rounded-xl px-4 py-3 text-text-primary text-base focus:outline-none focus:border-accent"
              autoFocus
            />
            <button
              onClick={() => void handleDecodedText(manualZoneCode)}
              disabled={!manualZoneCode.trim() || resolving}
              className="action-btn action-btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {resolving ? "Finding…" : "Find"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const MATERIAL_ISSUE_TYPES: MaterialIssueType[] = [
  "missing",
  "wrong_item",
  "damaged",
  "backordered",
  "other",
];

function ReportIssueModal({
  deliveryLabel,
  issueType,
  description,
  submitting,
  error,
  onTypeChange,
  onDescriptionChange,
  onCancel,
  onSubmit,
}: {
  deliveryLabel: string;
  issueType: MaterialIssueType;
  description: string;
  submitting: boolean;
  error: string | null;
  onTypeChange: (type: MaterialIssueType) => void;
  onDescriptionChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-8">
      <div className="w-full max-w-md rounded-2xl border border-border bg-bg-primary p-5 shadow-xl">
        <h3 className="text-lg font-bold text-text-primary mb-1">Report Issue</h3>
        <p className="text-sm text-text-secondary mb-4">{deliveryLabel}</p>
        <label
          htmlFor="issue-type-select"
          className="mb-2 block text-sm font-medium text-text-secondary"
        >
          Issue type
        </label>
        <select
          id="issue-type-select"
          data-testid="issue-type-select"
          value={issueType}
          onChange={(e) => onTypeChange(e.target.value as MaterialIssueType)}
          className="mb-4 w-full rounded-xl border border-border bg-bg-surface px-3 py-2 text-text-primary"
        >
          {MATERIAL_ISSUE_TYPES.map((t) => (
            <option key={t} value={t}>
              {MATERIAL_ISSUE_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <label
          htmlFor="issue-description"
          className="mb-2 block text-sm font-medium text-text-secondary"
        >
          Description (optional)
        </label>
        <textarea
          id="issue-description"
          data-testid="issue-description"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          rows={3}
          placeholder="What is wrong with the material?"
          className="mb-4 w-full resize-none rounded-xl border border-border bg-bg-surface px-3 py-2 text-text-primary"
        />
        {error && (
          <p className="mb-3 text-sm text-accent-red">{error}</p>
        )}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="action-btn action-btn-secondary flex-1"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="issue-submit"
            onClick={onSubmit}
            disabled={submitting}
            className="action-btn action-btn-delivered flex-1"
          >
            {submitting ? "Submitting…" : "Submit Issue"}
          </button>
        </div>
      </div>
    </div>
  );
}

function JobPickupScreen({
  jobId,
  pickupToken = null,
  highlightDeliveryId = null,
  onStartOver,
}: {
  jobId: string;
  pickupToken?: string | null;
  highlightDeliveryId?: string | null;
  onStartOver: () => void;
}) {
  const [deliveries, setDeliveries] = useState<DeliveryDetails[]>([]);
  const [allStagingLocations, setAllStagingLocations] = useState<
    StagingLocation[]
  >([]);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [notes, setNotes] = useState("");
  const [autoSubmitMinutes, setAutoSubmitMinutes] = useState(0);
  const [autoSubmitSecondsLeft, setAutoSubmitSecondsLeft] = useState<
    number | null
  >(null);
  const [isScanning, setIsScanning] = useState(false);
  const [zoneScanError, setZoneScanError] = useState<string | null>(null);
  const [checkingIds, setCheckingIds] = useState<Set<string>>(() => new Set());
  const [installingIds, setInstallingIds] = useState<Set<string>>(() => new Set());
  const [checkedItemIds, setCheckedItemIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [checkedShopStockKeys, setCheckedShopStockKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [cardErrors, setCardErrors] = useState<Map<string, string>>(
    () => new Map(),
  );
  const pickupOperationIds = useRef<Map<string, string>>(new Map());
  const [pulsingId, setPulsingId] = useState<string | null>(null);
  const [issueModalDeliveryId, setIssueModalDeliveryId] = useState<string | null>(
    null,
  );
  const [issueType, setIssueType] = useState<MaterialIssueType>("missing");
  const [issueDescription, setIssueDescription] = useState("");
  const [issueSubmitting, setIssueSubmitting] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [issueSuccess, setIssueSuccess] = useState<string | null>(null);
  const [runningLowSubmitting, setRunningLowSubmitting] = useState<Set<string>>(
    () => new Set(),
  );
  const submittedRef = useRef(false);
  const checkedRef = useRef(checked);
  const cardRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const initialHighlightDone = useRef(false);

  checkedRef.current = checked;

  const loadJobDeliveries = useCallback(async () => {
    setLoading(true);
    setError(null);
    initialHighlightDone.current = false;

    try {
      const [settings, loaded, stagingLocs] = await Promise.all([
        getAppSettings(),
        loadPickupReadyDeliveriesPublic(jobId, {
          includeDeliveryId: highlightDeliveryId ?? undefined,
        }),
        firestoreDataService.listStagingLocations(),
      ]);
      setAllStagingLocations(stagingLocs);
      setAutoSubmitMinutes(settings.autoSubmitMinutes);
      if (settings.autoSubmitMinutes > 0) {
        setAutoSubmitSecondsLeft(settings.autoSubmitMinutes * 60);
      }
      setDeliveries(
        [...loaded].sort(
          (a, b) =>
            pickupQueueSortRank(a.delivery.status) -
            pickupQueueSortRank(b.delivery.status),
        ),
      );
      setCheckedItemIds(() => {
        const initial = new Set<string>();
        for (const d of loaded) {
          for (const itemId of d.delivery.pickupCheckedItemIds ?? []) {
            initial.add(itemId);
          }
        }
        return initial;
      });
      setCheckedShopStockKeys(new Set());
      setChecked(
        new Set(
          loaded
            .filter(
              (d) =>
                d.delivery.status === "picked_up" ||
                d.delivery.status === "installed",
            )
            .map((d) => d.delivery.id),
        ),
      );
    } catch {
      setError("Failed to load deliveries. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [jobId, highlightDeliveryId]);

  const highlightCard = useCallback((deliveryId: string) => {
    setPulsingId(deliveryId);
    const el = cardRefs.current.get(deliveryId);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => setPulsingId(null), 1500);
  }, []);

  useEffect(() => {
    void loadJobDeliveries();
  }, [loadJobDeliveries]);

  useEffect(() => {
    if (
      loading ||
      !highlightDeliveryId ||
      initialHighlightDone.current ||
      !deliveries.some((d) => d.delivery.id === highlightDeliveryId)
    ) {
      return;
    }
    initialHighlightDone.current = true;
    window.setTimeout(() => highlightCard(highlightDeliveryId), 100);
  }, [loading, highlightDeliveryId, deliveries, highlightCard]);

  const checkOffDelivery = useCallback(
    async (delivery: DeliveryDetails) => {
      const deliveryId = delivery.delivery.id;
      if (checkedRef.current.has(deliveryId)) return;

      let operationId = pickupOperationIds.current.get(deliveryId);
      if (!operationId) {
        operationId = `pickup-${deliveryId}-${crypto.randomUUID()}`;
        pickupOperationIds.current.set(deliveryId, operationId);
      }

      setCheckingIds((prev) => new Set([...prev, deliveryId]));
      setCardErrors((prev) => {
        const next = new Map(prev);
        next.delete(deliveryId);
        return next;
      });

      try {
        await firestoreDataService.recordPickupEvent(
          deliveryId,
          "Technician",
          `${delivery.items.length} item${delivery.items.length === 1 ? "" : "s"}`,
          notes || undefined,
          operationId,
          undefined,
          pickupToken ?? undefined,
        );
        setChecked((prev) => new Set([...prev, deliveryId]));
        const refreshed = await getDeliveryDetailsPublic(deliveryId);
        if (refreshed) {
          setDeliveries((prev) =>
            prev.map((d) =>
              d.delivery.id === deliveryId ? refreshed : d,
            ),
          );
        }
      } catch (err) {
        setCardErrors((prev) =>
          new Map(prev).set(deliveryId, formatPickupError(err)),
        );
      } finally {
        setCheckingIds((prev) => {
          const next = new Set(prev);
          next.delete(deliveryId);
          return next;
        });
      }
    },
    [notes, pickupToken],
  );

  const handleMarkInstalled = useCallback(async (deliveryId: string) => {
    setInstallingIds((prev) => new Set([...prev, deliveryId]));
    setCardErrors((prev) => {
      const next = new Map(prev);
      next.delete(deliveryId);
      return next;
    });

    try {
      await markDeliveryInstalled(deliveryId);
      const refreshed = await getDeliveryDetailsPublic(deliveryId);
      if (refreshed) {
        setDeliveries((prev) =>
          prev.map((d) =>
            d.delivery.id === deliveryId ? refreshed : d,
          ),
        );
      }
    } catch {
      setCardErrors((prev) =>
        new Map(prev).set(
          deliveryId,
          "Failed to mark installed. Tap to retry.",
        ),
      );
    } finally {
      setInstallingIds((prev) => {
        const next = new Set(prev);
        next.delete(deliveryId);
        return next;
      });
    }
  }, []);

  const toggleShopStockItem = useCallback((key: string) => {
    setCheckedShopStockKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const isShopStockCompleteForDelivery = useCallback(
    (d: DeliveryDetails): boolean => {
      const items = shopStockPickListLabels(d.delivery);
      if (items.length === 0) return true;
      return items.every((_, index) =>
        checkedShopStockKeys.has(shopStockItemKey(d.delivery.id, index)),
      );
    },
    [checkedShopStockKeys],
  );

  const isDeliveryChecklistComplete = useCallback(
    (d: DeliveryDetails): boolean => {
      if (!isPickupReady(d.delivery.status)) return true;
      return (
        isStagedItemsCheckedOff(d, checkedItemIds) &&
        isShopStockCompleteForDelivery(d)
      );
    },
    [checkedItemIds, isShopStockCompleteForDelivery],
  );

  const pickupQueueDeliveries = deliveries.filter((d) =>
    isPickupReady(d.delivery.status),
  );

  const readyToFinish =
    pickupQueueDeliveries.length > 0 &&
    pickupQueueDeliveries.every(isDeliveryChecklistComplete);

  const handleDone = useCallback(async () => {
    if (submittedRef.current || submitting || !readyToFinish) return;

    submittedRef.current = true;
    setSubmitting(true);
    setError(null);

    const needsPickupRecord = deliveries.filter(
      (d) =>
        isPickupReady(d.delivery.status) &&
        !checkedRef.current.has(d.delivery.id) &&
        !isDeliveryAlreadyPickedUp(d),
    );

    try {
      for (const d of needsPickupRecord) {
        let operationId = pickupOperationIds.current.get(d.delivery.id);
        if (!operationId) {
          operationId = `pickup-${d.delivery.id}-${crypto.randomUUID()}`;
          pickupOperationIds.current.set(d.delivery.id, operationId);
        }
        await firestoreDataService.recordPickupEvent(
          d.delivery.id,
          "Technician",
          `${d.items.length} item${d.items.length === 1 ? "" : "s"}`,
          notes || undefined,
          operationId,
          undefined,
          pickupToken ?? undefined,
        );
      }
      setChecked(new Set(deliveries.map((d) => d.delivery.id)));
      setSubmitted(true);
    } catch (err) {
      submittedRef.current = false;
      setError(formatPickupError(err));
    } finally {
      setSubmitting(false);
    }
  }, [deliveries, notes, pickupToken, readyToFinish, submitting]);

  const handleAutoSubmit = useCallback(async () => {
    if (submittedRef.current || submitting) return;

    const blockedByChecklist = deliveries.some(
      (d) =>
        isPickupReady(d.delivery.status) &&
        !checkedRef.current.has(d.delivery.id) &&
        !isDeliveryChecklistComplete(d),
    );
    if (blockedByChecklist) {
      setError(
        "Auto-submit cancelled — check off all staged items and shop stock first.",
      );
      setAutoSubmitSecondsLeft(null);
      return;
    }

    submittedRef.current = true;
    setSubmitting(true);
    setError(null);

    const unchecked = deliveries.filter(
      (d) =>
        isPickupReady(d.delivery.status) &&
        !checkedRef.current.has(d.delivery.id) &&
        isDeliveryChecklistComplete(d),
    );

    try {
      for (const d of unchecked) {
        let operationId = pickupOperationIds.current.get(d.delivery.id);
        if (!operationId) {
          operationId = `pickup-${d.delivery.id}-${crypto.randomUUID()}`;
          pickupOperationIds.current.set(d.delivery.id, operationId);
        }
        await firestoreDataService.recordPickupEvent(
          d.delivery.id,
          "Technician",
          `${d.items.length} item${d.items.length === 1 ? "" : "s"}`,
          notes || undefined,
          operationId,
          undefined,
          pickupToken ?? undefined,
        );
      }
      setChecked(new Set(deliveries.map((d) => d.delivery.id)));
      setSubmitted(true);
    } catch (err) {
      submittedRef.current = false;
      setError(formatPickupError(err));
    } finally {
      setSubmitting(false);
    }
  }, [deliveries, notes, pickupToken, submitting, isDeliveryChecklistComplete]);

  useEffect(() => {
    if (
      autoSubmitSecondsLeft === null ||
      autoSubmitSecondsLeft <= 0 ||
      submitted ||
      loading ||
      deliveries.length === 0
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      setAutoSubmitSecondsLeft((prev) => {
        if (prev === null || prev <= 1) {
          window.clearInterval(timer);
          if (prev === 1) void handleAutoSubmit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [
    autoSubmitSecondsLeft,
    submitted,
    loading,
    deliveries.length,
    handleAutoSubmit,
  ]);

  const handleCheckOffScan = useCallback(
    (zoneCode: string) => {
      const normalized = normalizeStagingCodeKey(zoneCode);
      const match = deliveries.find((d) => {
        const ids = getAllStagingLocationIds(d.delivery);
        return ids.some((locId) => {
          const loc =
            allStagingLocations.find((l) => l.id === locId) ??
            (d.stagingLocation?.id === locId ? d.stagingLocation : undefined);
          return (
            loc?.code !== undefined &&
            normalizeStagingCodeKey(loc.code) === normalized
          );
        });
      });
      setIsScanning(false);
      if (!match) {
        setZoneScanError("Zone not in this job");
        window.setTimeout(() => setZoneScanError(null), 3000);
        return;
      }
      setZoneScanError(null);
      highlightCard(match.delivery.id);
    },
    [deliveries, allStagingLocations, highlightCard],
  );

  const handleCancelScan = useCallback(() => {
    setIsScanning(false);
  }, []);

  const toggleCheckedItem = useCallback(
    (deliveryId: string, itemId: string) => {
      const delivery = deliveries.find((d) => d.delivery.id === deliveryId);
      if (!delivery) return;

      const previousArray = delivery.delivery.pickupCheckedItemIds ?? [];
      const previousChecked = new Set(checkedItemIds);
      const nextChecked = new Set(previousChecked);
      if (nextChecked.has(itemId)) nextChecked.delete(itemId);
      else nextChecked.add(itemId);
      const nextArray = delivery.items
        .map((item) => item.id)
        .filter((id) => nextChecked.has(id));

      if (!pickupToken) return;

      setCheckedItemIds(nextChecked);
      setDeliveries((prev) =>
        prev.map((d) =>
          d.delivery.id === deliveryId
            ? {
                ...d,
                delivery: {
                  ...d.delivery,
                  pickupCheckedItemIds: nextArray,
                },
              }
            : d,
        ),
      );

      void firestoreDataService
        .updatePickupChecklist(
          deliveryId,
          jobId,
          nextArray,
          pickupToken,
        )
        .catch(() => {
          setCheckedItemIds(previousChecked);
          setDeliveries((prev) =>
            prev.map((d) =>
              d.delivery.id === deliveryId
                ? {
                    ...d,
                    delivery: {
                      ...d.delivery,
                      pickupCheckedItemIds: previousArray,
                    },
                  }
                : d,
            ),
          );
        });
    },
    [checkedItemIds, deliveries, jobId, pickupToken],
  );

  const reloadDeliveries = useCallback(async () => {
    const loaded = await loadPickupReadyDeliveriesPublic(jobId, {
      includeDeliveryId: highlightDeliveryId ?? undefined,
    });
    setDeliveries(loaded);
    return loaded;
  }, [jobId, highlightDeliveryId]);

  const openIssueModal = useCallback((deliveryId: string) => {
    setIssueModalDeliveryId(deliveryId);
    setIssueType("missing");
    setIssueDescription("");
    setIssueError(null);
  }, []);

  const closeIssueModal = useCallback(() => {
    if (issueSubmitting) return;
    setIssueModalDeliveryId(null);
    setIssueError(null);
  }, [issueSubmitting]);

  const submitIssueReport = useCallback(async () => {
    if (!issueModalDeliveryId) return;
    const target = deliveries.find((d) => d.delivery.id === issueModalDeliveryId);
    if (!target) return;

    setIssueSubmitting(true);
    setIssueError(null);
    try {
      const result = await reportMaterialIssue({
        deliveryOrderId: issueModalDeliveryId,
        jobId,
        type: issueType,
        description: issueDescription.trim() || undefined,
        reportedBy: "Technician",
        clientRequestId: crypto.randomUUID(),
      });
      if (result.blocking) {
        setDeliveries((prev) =>
          prev.map((d) =>
            d.delivery.id === issueModalDeliveryId
              ? {
                  ...d,
                  delivery: {
                    ...d.delivery,
                    openBlockingIssueCount: Math.max(
                      d.delivery.openBlockingIssueCount ?? 0,
                      1,
                    ),
                  },
                }
              : d,
          ),
        );
      }
      await reloadDeliveries();
      setIssueModalDeliveryId(null);
      setIssueDescription("");
      setIssueSuccess(
        result.duplicate
          ? "Issue already recorded for this delivery."
          : `Issue reported${result.blocking ? " — pickup warning shown below" : ""}.`,
      );
      window.setTimeout(() => setIssueSuccess(null), 5000);
    } catch (err) {
      setIssueError(formatPickupError(err));
    } finally {
      setIssueSubmitting(false);
    }
  }, [
    issueModalDeliveryId,
    deliveries,
    jobId,
    issueType,
    issueDescription,
    reloadDeliveries,
  ]);

  const reportShopStockRunningLow = useCallback(
    async (deliveryId: string, lineIndex: number, label: string) => {
      const lineKey = shopStockItemKey(deliveryId, lineIndex);
      if (runningLowSubmitting.has(lineKey)) return;

      setRunningLowSubmitting((prev) => new Set(prev).add(lineKey));
      setIssueError(null);
      try {
        const result = await reportMaterialIssue({
          deliveryOrderId: deliveryId,
          jobId,
          type: "running_low",
          description: label.trim() || undefined,
          reportedBy: "Technician",
          clientRequestId: crypto.randomUUID(),
          shopStockLineKey: lineKey,
        });
        await reloadDeliveries();
        setIssueSuccess(
          result.duplicate
            ? "Running low already reported for this item."
            : "Running low reported — restock alert sent to dispatcher.",
        );
        window.setTimeout(() => setIssueSuccess(null), 5000);
      } catch (err) {
        setIssueError(formatPickupError(err));
      } finally {
        setRunningLowSubmitting((prev) => {
          const next = new Set(prev);
          next.delete(lineKey);
          return next;
        });
      }
    },
    [jobId, reloadDeliveries, runningLowSubmitting],
  );

  const hasBlockingIssues = deliveries.some(
    (d) => (d.delivery.openBlockingIssueCount ?? 0) > 0,
  );

  if (isScanning) {
    return (
      <QrScannerOverlay
        readerId="checkoff-reader"
        title="Pickup Portal"
        onDecode={handleCheckOffScan}
        onCancel={handleCancelScan}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <p className="text-text-secondary">Loading pickup list…</p>
      </div>
    );
  }

  if (error && deliveries.length === 0) {
    return (
      <PublicNetworkErrorPanel
        message={error}
        onRetry={() => void loadJobDeliveries()}
      />
    );
  }

  if (submitted) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center">
        <div className="size-24 rounded-full bg-accent-green/10 text-accent-green flex items-center justify-center mb-8">
          <Svg d={icons.check} size={48} />
        </div>
        <h2 className="text-3xl font-bold text-text-primary mb-4">
          All Items Picked Up!
        </h2>
        <p className="text-base text-text-secondary mb-2">
          Staged materials and shop stock are complete for this job.
        </p>
        <p className="text-sm text-text-secondary mb-12">
          {zoneSummary(deliveries)}
        </p>
        <button
          onClick={onStartOver}
          className="action-btn action-btn-secondary w-full"
        >
          Scan Another Job
        </button>
      </div>
    );
  }

  if (deliveries.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center">
        <p className="text-text-primary font-medium mb-6">
          No pickup-ready deliveries for this job. Check with your dispatcher.
        </p>
        <button onClick={onStartOver} className="action-btn action-btn-secondary">
          Scan Another Job
        </button>
      </div>
    );
  }

  const job = deliveries[0]?.job;
  const jobName = job?.jobName ?? "Job";
  const jobNumber = job?.jobNumber ?? "";
  const siteLabel = job?.siteNumber?.trim() || jobName;
  const customerLabel = job?.materialOwnerName?.trim();
  const poNumbers = [
    ...new Set(
      deliveries
        .map((d) => d.purchaseOrder?.poNumber?.trim())
        .filter((po): po is string => Boolean(po)),
    ),
  ].join(", ");
  const issueModalDelivery = issueModalDeliveryId
    ? deliveries.find((d) => d.delivery.id === issueModalDeliveryId)
    : null;

  const readyDeliveries = deliveries.filter((d) =>
    isPickupReady(d.delivery.status),
  );
  const notReadyDeliveries = deliveries.filter(
    (d) => !isPickupReady(d.delivery.status),
  );

  const stagingSectionMap = new Map<string, DeliveryDetails[]>();
  for (const d of readyDeliveries) {
    const code = primaryStagingCode(d, allStagingLocations);
    const list = stagingSectionMap.get(code) ?? [];
    list.push(d);
    stagingSectionMap.set(code, list);
  }

  const stagingSections = [...stagingSectionMap.entries()].sort(([a], [b]) => {
    if (a === "—") return 1;
    if (b === "—") return -1;
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });

  for (const [, sectionDeliveries] of stagingSections) {
    sectionDeliveries.sort(
      (a, b) =>
        pickupQueueSortRank(a.delivery.status) -
        pickupQueueSortRank(b.delivery.status),
    );
  }

  const vendorVisibleDeliveryIds = deliveryIdsWithDuplicateSkus(deliveries);
  const showVendorOnCard = (id: string) => vendorVisibleDeliveryIds.has(id);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {issueModalDelivery && (
        <ReportIssueModal
          deliveryLabel={`${issueModalDelivery.vendor.name} · ${issueModalDelivery.delivery.orderNumber}`}
          issueType={issueType}
          description={issueDescription}
          submitting={issueSubmitting}
          error={issueError}
          onTypeChange={setIssueType}
          onDescriptionChange={setIssueDescription}
          onCancel={closeIssueModal}
          onSubmit={() => void submitIssueReport()}
        />
      )}
      <div className="flex-1 overflow-y-auto px-6 py-4 pt-6">
        <div
          data-testid="pickup-job-header"
          className="mb-4 rounded-xl border border-border bg-bg-surface px-4 py-3 text-left text-sm space-y-1"
        >
          <p>
            <span className="text-text-secondary">Site: </span>
            <span className="text-text-primary font-medium">{siteLabel}</span>
          </p>
          {customerLabel ? (
            <p>
              <span className="text-text-secondary">Customer: </span>
              <span className="text-text-primary font-medium">{customerLabel}</span>
            </p>
          ) : null}
          <p>
            <span className="text-text-secondary">Job: </span>
            <span className="text-text-primary font-medium">{jobName}</span>
          </p>
          {jobNumber ? (
            <p>
              <span className="text-text-secondary">Job Number: </span>
              <span className="text-text-primary font-medium">{jobNumber}</span>
            </p>
          ) : null}
          {poNumbers ? (
            <p>
              <span className="text-text-secondary">PO Numbers: </span>
              <span className="text-text-primary font-medium">{poNumbers}</span>
            </p>
          ) : null}
        </div>

        {hasBlockingIssues && (
          <div
            data-testid="blocking-issue-warning"
            className="mb-4 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent"
          >
            <p className="font-semibold">Open material issue on this job</p>
            <p className="mt-1 text-text-secondary">
              A blocking issue was reported. You can still complete pickup, but
              dispatch has been notified — confirm with your material owner before
              leaving if anything is still missing.
            </p>
          </div>
        )}

        {issueSuccess && (
          <div className="mb-4 rounded-xl border border-accent-green/40 bg-accent-green/10 px-4 py-3 text-sm text-accent-green">
            {issueSuccess}
          </div>
        )}

        <div className="space-y-6 mb-4">
          {stagingSections.map(([code, sectionDeliveries]) => (
            <section
              key={code}
              data-testid="pickup-location-section"
              data-staging-code={code}
              className="space-y-3"
            >
              <p className="text-sm font-semibold text-text-primary">
                <span className="text-text-secondary">Pickup at </span>
                <span className="text-lg font-bold text-accent">{code}</span>
              </p>
              <div className="space-y-3">
                {sectionDeliveries.map((d) => {
            const deliveryId = d.delivery.id;
            const deliveryStatus = d.delivery.status;
            const isInstalled = deliveryStatus === "installed";
            const isPickedUp =
              deliveryStatus === "picked_up" || checked.has(deliveryId);
            const isChecked = isPickedUp || isInstalled;
            const isChecking = checkingIds.has(deliveryId);
            const isInstalling = installingIds.has(deliveryId);
            const isPulsing = pulsingId === deliveryId;
            const cardError = cardErrors.get(deliveryId);
            const stagingLocations = resolveStagingLocations(
              d,
              allStagingLocations,
            );
            const shopStockItems = shopStockPickListLabels(d.delivery);
            const showShopStock = hasShopStockPickList(d.delivery);
            const shopStockGroupHeader = shopStockLocationGroupHeader(d.delivery);
            const shopStockComplete = isShopStockCompleteForDelivery(d);
            const canCheckOff =
              isPickupReady(deliveryStatus) &&
              !isChecked &&
              shopStockComplete;

            return (
              <div
                key={deliveryId}
                className={`w-full text-left bg-bg-surface rounded-2xl border overflow-hidden transition-colors ${
                  isInstalled
                    ? "border-border opacity-60"
                    : isChecked
                      ? "border-accent-green shadow-[0_0_0_1px_rgba(34,197,94,0.3)]"
                      : isPulsing
                        ? "border-accent animate-zone-pulse"
                        : cardError
                          ? "border-accent-red/50"
                          : "border-border"
                }`}
              >
                <button
                  ref={(el) => {
                    if (el) cardRefs.current.set(deliveryId, el);
                    else cardRefs.current.delete(deliveryId);
                  }}
                  type="button"
                  disabled={!canCheckOff || isChecking}
                  onClick={() => void checkOffDelivery(d)}
                  className="w-full p-4 text-left disabled:cursor-default"
                >
                    <div className="flex items-start gap-3">
                      {(isChecked || isInstalled) && (
                        <span
                          className={`shrink-0 mt-0.5 ${
                            isInstalled
                              ? "text-text-secondary"
                              : "text-accent-green"
                          }`}
                        >
                          <Svg d={icons.check} size={24} />
                        </span>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="mb-2">
                          <PickupLocationBlock
                            stagingLocations={stagingLocations}
                            currentLocationNote={d.delivery.currentLocationNote}
                            shopStockLocationNote={d.delivery.shopStockLocationNote}
                          />
                          {publicPickupStatusLabel(deliveryStatus) && (
                            <span
                              className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                                deliveryStatus === "picked_up" ||
                                deliveryStatus === "installed"
                                  ? "bg-accent-green/15 text-accent-green"
                                  : "bg-accent-green/10 text-accent-green"
                              }`}
                              data-testid="pickup-public-status"
                            >
                              {publicPickupStatusLabel(deliveryStatus)}
                            </span>
                          )}
                        </div>
                        <p className="text-text-secondary text-sm">
                          {showVendorOnCard(deliveryId)
                            ? `${d.vendor.name} · `
                            : d.purchaseOrder?.poNumber
                              ? `${d.purchaseOrder.poNumber} · `
                              : ""}
                          {d.items.length === 1
                            ? "1 item"
                            : `${d.items.length} items`}
                        </p>
                        {isChecking && (
                          <p className="mt-2 text-xs text-text-secondary">
                            Recording…
                          </p>
                        )}
                        {cardError && (
                          <p className="mt-2 text-xs text-accent-red">
                            {cardError}
                          </p>
                        )}
                        {showShopStock && !isChecked && !shopStockComplete && (
                          <p className="mt-2 text-xs text-accent">
                            Check all shop stock items below before confirming
                            pickup.
                          </p>
                        )}
                        {(d.delivery.openBlockingIssueCount ?? 0) > 0 && (
                          <p className="mt-2 text-xs font-semibold text-accent">
                            Blocking material issue open
                          </p>
                        )}
                      </div>
                    </div>
                </button>
                {!isInstalled && isPickupReady(deliveryStatus) && !isChecked && (
                  <div className="border-t border-border px-4 py-3">
                    <button
                      type="button"
                      data-testid="report-issue-btn"
                      onClick={() => openIssueModal(deliveryId)}
                      className="action-btn action-btn-secondary w-full text-sm"
                    >
                      Report Issue
                    </button>
                  </div>
                )}
                {deliveryStatus === "picked_up" && (
                  <div className="border-t border-border px-4 py-3">
                    <button
                      type="button"
                      disabled={isInstalling}
                      onClick={() => void handleMarkInstalled(deliveryId)}
                      className="action-btn action-btn-secondary w-full text-sm disabled:opacity-40"
                    >
                      {isInstalling ? "Updating…" : "Mark Installed"}
                    </button>
                  </div>
                )}
                <div className="border-t border-border bg-bg-secondary/40 px-4 py-4">
                    <div className="space-y-2 mb-4">
                      {[
                        ["Order #", d.delivery.orderNumber],
                        ...(showVendorOnCard(deliveryId)
                          ? ([["Vendor", d.vendor.name]] as const)
                          : []),
                        ["PO #", d.purchaseOrder?.poNumber ?? "—"],
                      ].map(([label, value]) => (
                        <div
                          key={label}
                          className="flex items-center justify-between gap-4 text-xs"
                        >
                          <span className="text-text-secondary">{label}</span>
                          <span className="text-text-primary font-medium text-right">
                            {value}
                          </span>
                        </div>
                      ))}
                    </div>

                    {d.items.length > 0 && (
                      <div
                        className="mb-4"
                        data-testid="expected-materials"
                      >
                        <p className="mb-2 text-xs font-semibold text-text-primary">
                          Expected Materials
                        </p>
                        <ul className="space-y-1">
                          {d.items.map((item) => (
                            <li
                              key={item.id}
                              className="text-xs text-text-secondary"
                            >
                              <span className="text-text-primary">
                                {formatPickupItemLine(
                                  d.purchaseOrder?.poNumber,
                                  item.description,
                                  item.qtyOrdered,
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <p className="mb-3 text-xs text-text-secondary">
                      Mark off items as you pick them up — optional
                    </p>

                    {d.items.length === 0 ? (
                      <p className="rounded-xl border border-border bg-bg-surface px-3 py-3 text-sm text-text-secondary">
                        No items on record
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {d.items.map((item) => {
                          const itemChecked = checkedItemIds.has(item.id);
                          return (
                            <button
                              key={item.id}
                              type="button"
                              data-testid="pickup-item-row"
                              data-po-number={d.purchaseOrder?.poNumber ?? ""}
                              data-checked={itemChecked ? "true" : "false"}
                              onClick={() => toggleCheckedItem(deliveryId, item.id)}
                              className="w-full rounded-xl border border-border bg-bg-surface px-3 py-3 text-left"
                            >
                              <div className="flex items-start gap-3">
                                <span
                                  className={`mt-0.5 shrink-0 ${
                                    itemChecked
                                      ? "text-accent-green"
                                      : "text-text-secondary"
                                  }`}
                                >
                                  <Svg
                                    d={
                                      itemChecked
                                        ? icons.checkSquare
                                        : icons.square
                                    }
                                    size={22}
                                  />
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span
                                    className={`block text-sm font-medium ${
                                      itemChecked
                                        ? "text-text-secondary line-through"
                                        : "text-text-primary"
                                    }`}
                                  >
                                    {formatPickupItemLine(
                                      d.purchaseOrder?.poNumber,
                                      item.description,
                                      item.qtyOrdered,
                                    )}
                                  </span>
                                  {item.sku ? (
                                    <span
                                      className={`mt-1 block text-xs ${
                                        itemChecked
                                          ? "text-text-secondary/70 line-through"
                                          : "text-text-secondary"
                                      }`}
                                    >
                                      SKU {item.sku}
                                    </span>
                                  ) : null}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {showShopStock && (
                      <div className="mt-5 pt-4 border-t border-border">
                        <p className="mb-1 text-sm font-semibold text-text-primary">
                          Additional Shop Stock
                        </p>
                        <p className="mb-3 text-xs text-text-secondary">
                          Check each item as you grab it from shop stock.
                        </p>
                        <div
                          className="space-y-2"
                          data-testid="shop-stock-location-group"
                        >
                          {shopStockGroupHeader && (
                            <p
                              className="text-xs font-bold uppercase tracking-wide text-text-secondary"
                              data-testid="shop-stock-location-group-header"
                            >
                              {shopStockGroupHeader}
                            </p>
                          )}
                          {shopStockItems.map((label, index) => {
                            const key = shopStockItemKey(deliveryId, index);
                            const stockChecked = checkedShopStockKeys.has(key);
                            const runningLowBusy = runningLowSubmitting.has(key);
                            return (
                              <div
                                key={key}
                                className="flex items-stretch gap-2"
                              >
                                <button
                                  type="button"
                                  onClick={() => toggleShopStockItem(key)}
                                  className="flex-1 rounded-xl border border-border bg-bg-surface px-3 py-3 text-left"
                                >
                                  <div className="flex items-center gap-3 w-full">
                                    <span
                                      className={`mt-0.5 shrink-0 self-start ${
                                        stockChecked
                                          ? "text-accent-green"
                                          : "text-text-secondary"
                                      }`}
                                    >
                                      <Svg
                                        d={
                                          stockChecked
                                            ? icons.checkSquare
                                            : icons.square
                                        }
                                        size={22}
                                      />
                                    </span>
                                    <span
                                      className={`flex-1 text-sm font-medium ${
                                        stockChecked
                                          ? "text-text-secondary line-through"
                                          : "text-text-primary"
                                      }`}
                                    >
                                      {label}
                                    </span>
                                    <span
                                      className="shrink-0 text-xs font-semibold text-text-secondary"
                                      data-testid="shop-stock-pull-state"
                                    >
                                      {shopStockPullStateLabel(
                                        stockChecked,
                                        isChecked || isInstalled,
                                      )}
                                    </span>
                                  </div>
                                </button>
                                <button
                                  type="button"
                                  data-testid="shop-stock-running-low"
                                  disabled={runningLowBusy}
                                  onClick={() =>
                                    void reportShopStockRunningLow(
                                      deliveryId,
                                      index,
                                      label,
                                    )
                                  }
                                  className="shrink-0 rounded-xl border border-border bg-bg-primary px-3 py-2 text-xs font-semibold text-text-primary disabled:opacity-50"
                                >
                                  {runningLowBusy ? "…" : "Running Low"}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                        {shopStockComplete && (
                          <p className="mt-3 text-sm font-semibold text-accent-green">
                            Shop Stock Complete ✓
                          </p>
                        )}
                      </div>
                    )}
                </div>
              </div>
            );
                })}
              </div>
            </section>
          ))}
          {notReadyDeliveries.length > 0 && (
            <div className="space-y-3 pt-2 border-t border-border/60">
              {notReadyDeliveries.map((d) => {
                const deliveryId = d.delivery.id;
                const deliveryStatus = d.delivery.status;
                const notReadyLabel = publicNotReadyDetailLabel(deliveryStatus);

                return (
                  <div
                    key={deliveryId}
                    data-testid="pickup-not-ready-row"
                    className="w-full rounded-2xl border border-dashed border-border/80 bg-bg-surface/70 opacity-75 overflow-hidden"
                  >
                    <div className="p-4">
                      <p className="text-text-primary text-sm font-medium">
                        {showVendorOnCard(deliveryId)
                          ? `${d.vendor.name} · `
                          : d.purchaseOrder?.poNumber
                            ? `${d.purchaseOrder.poNumber} · `
                            : ""}
                        {d.delivery.orderNumber}
                      </p>
                      {notReadyLabel && (
                        <p className="mt-2 text-xs font-semibold text-text-secondary">
                          {notReadyLabel}
                        </p>
                      )}
                      <p className="mt-2 text-xs text-text-secondary">
                        Not available for pickup yet — shown for reference only.
                      </p>
                    </div>
                    {d.items.length > 0 && (
                      <div
                        className="border-t border-border/60 px-4 py-4"
                        data-testid="expected-materials"
                      >
                        <p className="mb-2 text-xs font-semibold text-text-primary">
                          Expected Materials
                        </p>
                        <ul className="space-y-1">
                          {d.items.map((item) => (
                            <li
                              key={item.id}
                              className="text-xs text-text-secondary"
                            >
                              <span className="text-text-primary">
                                {formatPickupItemLine(
                                  d.purchaseOrder?.poNumber,
                                  item.description,
                                  item.qtyOrdered,
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {zoneScanError && (
          <div className="mb-4 rounded-xl border border-accent-red/30 bg-accent-red/10 px-4 py-3 text-accent-red text-sm">
            {zoneScanError}
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            setZoneScanError(null);
            setIsScanning(true);
          }}
          className="text-accent text-sm font-medium mb-6 flex items-center gap-1"
        >
          Scan to check off ↗
        </button>

        <div className="mb-4">
          <label
            htmlFor="pickup-notes"
            className="mb-2 block text-sm font-medium text-text-secondary"
          >
            Notes (optional)
          </label>
          <textarea
            id="pickup-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any notes about this pickup?"
            rows={2}
            className="w-full bg-bg-surface border border-border rounded-xl px-4 py-3 text-text-primary text-base focus:outline-none focus:border-accent resize-none"
          />
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-accent-red/30 bg-accent-red/10 px-4 py-3 text-accent-red text-sm">
            {error}
          </div>
        )}
      </div>

      <div
        className={`shrink-0 px-6 pb-[calc(env(safe-area-inset-bottom,16px)+16px)] pt-3 border-t bg-bg-primary transition-colors ${
          readyToFinish ? "border-accent-green/50 bg-accent-green/5" : "border-border"
        }`}
      >
        {readyToFinish && (
          <p className="text-center text-sm font-semibold text-accent-green mb-2">
            All items picked up — tap Order Pickup Complete to finish
          </p>
        )}
        {autoSubmitMinutes > 0 &&
          autoSubmitSecondsLeft !== null &&
          autoSubmitSecondsLeft > 0 &&
          !readyToFinish && (
            <p className="text-center text-xs text-text-secondary mb-2">
              Auto-submitting in {formatCountdown(autoSubmitSecondsLeft)}
            </p>
          )}
        <button
          type="button"
          onClick={() => void handleDone()}
          disabled={submitting || !readyToFinish}
          className={`action-btn action-btn-delivered w-full transition-all duration-300 ${
            readyToFinish
              ? "ring-4 ring-accent-green/50 shadow-[0_0_28px_rgba(34,197,94,0.35)] scale-[1.02] animate-pulse"
              : "opacity-50 cursor-not-allowed"
          }`}
        >
          {submitting ? "Submitting…" : "Order Pickup Complete"}
        </button>
      </div>
    </div>
  );
}

export default function PickupPortalPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const pickupParams = readPickupParams(searchParams);
  const jobIdFromUrl = pickupParams.job;
  const tokenFromUrl = pickupParams.token;
  const deliveryFromUrl = pickupParams.delivery;
  const zoneFromUrl = pickupParams.zone;
  const [discoveredJobId, setDiscoveredJobId] = useState<string | null>(null);
  const [tokenResolvedJobId, setTokenResolvedJobId] = useState<string | null>(
    null,
  );
  const [tokenValidating, setTokenValidating] = useState(
    Boolean(tokenFromUrl && !jobIdFromUrl),
  );
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [highlightDeliveryId, setHighlightDeliveryId] = useState<
    string | null
  >(deliveryFromUrl);
  const [zoneDeepLinkPending, setZoneDeepLinkPending] = useState(
    Boolean(zoneFromUrl && !jobIdFromUrl && !tokenFromUrl),
  );
  const [zoneDeepLinkError, setZoneDeepLinkError] = useState<string | null>(
    null,
  );

  const activeJobId =
    jobIdFromUrl ?? tokenResolvedJobId ?? discoveredJobId;

  useEffect(() => {
    normalizePickupHash();
  }, []);

  useEffect(() => {
    if (!tokenFromUrl || jobIdFromUrl) return;
    let cancelled = false;
    void (async () => {
      setTokenValidating(true);
      setTokenError(null);
      try {
        const result = await validatePickupTokenClient(tokenFromUrl);
        if (cancelled) return;
        setTokenResolvedJobId(result.jobId);
      } catch (err) {
        if (cancelled) return;
        setTokenError(
          err instanceof Error
            ? err.message
            : "Invalid or expired pickup link. Ask dispatch for a new link.",
        );
      } finally {
        if (!cancelled) setTokenValidating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tokenFromUrl, jobIdFromUrl]);

  useEffect(() => {
    if (!zoneFromUrl || jobIdFromUrl || tokenFromUrl) return;
    let cancelled = false;
    void (async () => {
      const resolved = await resolveZoneScanDisposition(zoneFromUrl);
      if (cancelled) return;
      if (resolved?.kind === "receive") {
        setZoneDeepLinkError(
          "Not ready for pickup — the zone tag QR switches to pickup when staging is complete.",
        );
        setZoneDeepLinkPending(false);
        return;
      }
      if (resolved?.kind === "pickup") {
        setDiscoveredJobId(resolved.jobId);
        setHighlightDeliveryId(resolved.deliveryId);
        setSearchParams(
          {
            job: resolved.jobId,
            delivery: resolved.deliveryId,
          },
          { replace: true },
        );
      } else {
        setZoneDeepLinkError(`No active delivery at zone ${zoneFromUrl}`);
      }
      setZoneDeepLinkPending(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [zoneFromUrl, jobIdFromUrl, tokenFromUrl, setSearchParams]);

  const handleJobResolved = useCallback(
    (jobId: string, deliveryId: string | null) => {
      setDiscoveredJobId(jobId);
      setHighlightDeliveryId(deliveryId);
      if (deliveryId) {
        setSearchParams({ job: jobId, delivery: deliveryId }, { replace: true });
      } else {
        setSearchParams({ job: jobId }, { replace: true });
      }
    },
    [setSearchParams],
  );

  const handleStartOver = useCallback(() => {
    setDiscoveredJobId(null);
    setTokenResolvedJobId(null);
    setTokenError(null);
    setHighlightDeliveryId(null);
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  return (
    <div className="app-container flex flex-col h-screen h-dvh bg-bg-primary overflow-hidden">
      {tokenValidating ? (
        <div
          className="flex flex-1 items-center justify-center text-text-secondary text-sm"
          data-testid="pickup-token-validating"
        >
          Opening pickup link…
        </div>
      ) : tokenError ? (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
          data-testid="pickup-token-error"
        >
          <p className="text-accent-red text-sm font-semibold">{tokenError}</p>
          <button
            type="button"
            onClick={handleStartOver}
            className="text-sm text-accent-blue underline"
          >
            Enter a different link
          </button>
        </div>
      ) : zoneDeepLinkPending ? (
        <div className="flex flex-1 items-center justify-center text-text-secondary text-sm">
          Loading pickup for zone {zoneFromUrl}…
        </div>
      ) : activeJobId ? (
        <JobPickupScreen
          key={`${activeJobId}-${highlightDeliveryId ?? "link"}`}
          jobId={activeJobId}
          pickupToken={tokenFromUrl}
          highlightDeliveryId={highlightDeliveryId}
          onStartOver={handleStartOver}
        />
      ) : (
        <WalkUpEntry
          onJobResolved={handleJobResolved}
          initialNotFoundCode={zoneDeepLinkError}
        />
      )}
    </div>
  );
}
