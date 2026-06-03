import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  firestoreDataService,
  getAppSettings,
  getDeliveryDetailsPublic,
  loadPickupReadyDeliveriesPublic,
  markDeliveryInstalled,
} from "./dispatcher/firestoreService";
import {
  DELIVERY_STATUS_LABEL,
  getAllStagingLocationIds,
  type DeliveryDetails,
  type DeliveryStatus,
  type StagingLocation,
} from "./dispatcher/models";
import {
  hasShopStockPickList,
  shopStockItemKey,
} from "./dispatcher/shopStockPickList";
import { formatPickupError } from "./dispatcher/pickupErrors";
import {
  resolveZoneScanDisposition,
  syncScanIntent,
} from "./scanRouting";
import { parseScannedQr } from "./receiveQrUrls";
import { QrScannerOverlay } from "./QrScannerOverlay";
import { PortalNavBar } from "./PortalNavBar";
import { normalizeStagingCodeKey } from "./dispatcher/stagingCode";

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
    status === "complete" ||
    status === "partial"
  );
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

function StagingLocationsDisplay({
  locations,
  compact = false,
}: {
  locations: { code: string; label: string; isPrimary: boolean }[];
  compact?: boolean;
}) {
  if (locations.length === 0) {
    return <span className="text-text-secondary">—</span>;
  }

  if (compact) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        {locations.map((loc, idx) => (
          <span key={`${loc.code}-${idx}`}>
            {idx > 0 && <span className="text-text-secondary">, </span>}
            <span
              className={
                loc.isPrimary
                  ? "font-bold text-accent"
                  : "text-text-primary"
              }
            >
              {loc.code}
            </span>
          </span>
        ))}
      </span>
    );
  }

  return (
    <span className="text-text-primary font-medium text-right inline-flex flex-wrap items-center justify-end gap-1.5">
      {locations.map((loc, idx) => (
        <span
          key={`${loc.code}-${idx}`}
          className={`rounded-full px-2 py-0.5 text-xs ${
            loc.isPrimary
              ? "bg-accent/10 font-bold text-accent"
              : "bg-bg-surface border border-border text-text-primary"
          }`}
          title={loc.label}
        >
          {loc.code}
        </span>
      ))}
    </span>
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
  const navigate = useNavigate();
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
        navigate(`/receive?id=${encodeURIComponent(resolved.deliveryId)}`, {
          replace: true,
        });
        return;
      }
      setNotFoundCode(null);
      setIsScanning(false);
      setShowManualEntry(false);
      setManualZoneCode("");
      onJobResolved(resolved.jobId, resolved.deliveryId);
    },
    [onJobResolved, navigate],
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
      <div className="mb-8">
        <PortalNavBar active="pickup" />
      </div>

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

function JobPickupScreen({
  jobId,
  highlightDeliveryId = null,
  onStartOver,
}: {
  jobId: string;
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
  const [pulsingId, setPulsingId] = useState<string | null>(null);
  const submittedRef = useRef(false);
  const checkedRef = useRef(checked);
  const cardRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const initialHighlightDone = useRef(false);

  checkedRef.current = checked;

  const highlightCard = useCallback((deliveryId: string) => {
    setPulsingId(deliveryId);
    const el = cardRefs.current.get(deliveryId);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => setPulsingId(null), 1500);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    initialHighlightDone.current = false;

    void (async () => {
      try {
        const [settings, loaded, stagingLocs] = await Promise.all([
          getAppSettings(),
          loadPickupReadyDeliveriesPublic(jobId),
          firestoreDataService.listStagingLocations(),
        ]);
        if (cancelled) return;
        setAllStagingLocations(stagingLocs);
        setAutoSubmitMinutes(settings.autoSubmitMinutes);
        if (settings.autoSubmitMinutes > 0) {
          setAutoSubmitSecondsLeft(settings.autoSubmitMinutes * 60);
        }
        setDeliveries(loaded);
        setCheckedItemIds(new Set());
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
        if (!cancelled) setError("Failed to load deliveries. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [jobId]);

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
    [notes],
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
      const items = d.delivery.shopStockPickListItems ?? [];
      if (items.length === 0) return true;
      return items.every((_, index) =>
        checkedShopStockKeys.has(shopStockItemKey(d.delivery.id, index)),
      );
    },
    [checkedShopStockKeys],
  );

  const isDeliveryChecklistComplete = useCallback(
    (d: DeliveryDetails): boolean =>
      isStagedItemsCheckedOff(d, checkedItemIds) &&
      isShopStockCompleteForDelivery(d),
    [checkedItemIds, isShopStockCompleteForDelivery],
  );

  const readyToFinish =
    deliveries.length > 0 &&
    deliveries.every(isDeliveryChecklistComplete);

  const handleDone = useCallback(async () => {
    if (submittedRef.current || submitting || !readyToFinish) return;

    submittedRef.current = true;
    setSubmitting(true);
    setError(null);

    const needsPickupRecord = deliveries.filter(
      (d) =>
        !checkedRef.current.has(d.delivery.id) &&
        !isDeliveryAlreadyPickedUp(d),
    );

    try {
      for (const d of needsPickupRecord) {
        await firestoreDataService.recordPickupEvent(
          d.delivery.id,
          "Technician",
          `${d.items.length} item${d.items.length === 1 ? "" : "s"}`,
          notes || undefined,
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
  }, [deliveries, notes, readyToFinish, submitting]);

  const handleAutoSubmit = useCallback(async () => {
    if (submittedRef.current || submitting) return;

    const blockedByChecklist = deliveries.some(
      (d) =>
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
        !checkedRef.current.has(d.delivery.id) &&
        isDeliveryChecklistComplete(d),
    );

    try {
      for (const d of unchecked) {
        await firestoreDataService.recordPickupEvent(
          d.delivery.id,
          "Technician",
          `${d.items.length} item${d.items.length === 1 ? "" : "s"}`,
          notes || undefined,
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
  }, [deliveries, notes, submitting, isDeliveryChecklistComplete]);

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

  const toggleCheckedItem = useCallback((itemId: string) => {
    setCheckedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

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
        <div className="mb-8 w-full max-w-sm">
          <PortalNavBar active="pickup" />
        </div>
        <p className="text-text-primary font-medium mb-6">
          No pickup-ready deliveries for this job. Check with your dispatcher.
        </p>
        <button onClick={onStartOver} className="action-btn action-btn-secondary">
          Scan Another Job
        </button>
      </div>
    );
  }

  const jobName = deliveries[0]?.job?.jobName ?? "Job";

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="shrink-0 px-6 pt-6 pb-2">
        <PortalNavBar active="pickup" />
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <p className="text-center text-text-secondary text-sm mb-6">
          {jobName}
        </p>

        <div className="space-y-3 mb-4">
          {deliveries.map((d) => {
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
            const shopStockItems = d.delivery.shopStockPickListItems ?? [];
            const showShopStock = hasShopStockPickList(d.delivery);
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
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <p
                            className={`font-bold ${
                              isInstalled
                                ? "text-text-secondary"
                                : "text-text-primary"
                            }`}
                          >
                            Staging:{" "}
                            <StagingLocationsDisplay
                              locations={stagingLocations}
                              compact
                            />
                          </p>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                              isInstalled
                                ? "bg-text-secondary/15 text-text-secondary"
                                : deliveryStatus === "picked_up"
                                  ? "bg-accent-green/15 text-accent-green"
                                  : "bg-accent/10 text-accent"
                            }`}
                          >
                            {DELIVERY_STATUS_LABEL[deliveryStatus]}
                          </span>
                        </div>
                        <p className="text-text-secondary text-sm">
                          {d.vendor.name} ·{" "}
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
                      </div>
                    </div>
                </button>
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
                        ["Vendor", d.vendor.name],
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
                      <div className="flex items-center justify-between gap-4 text-xs">
                        <span className="text-text-secondary">Staging</span>
                        <StagingLocationsDisplay locations={stagingLocations} />
                      </div>
                    </div>

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
                              onClick={() => toggleCheckedItem(item.id)}
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
                                    {item.description}
                                  </span>
                                  <span
                                    className={`mt-1 block text-xs ${
                                      itemChecked
                                        ? "text-text-secondary/70 line-through"
                                        : "text-text-secondary"
                                    }`}
                                  >
                                    Qty {item.qtyOrdered}
                                    {item.sku ? ` · SKU ${item.sku}` : ""}
                                  </span>
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
                        <div className="space-y-2">
                          {shopStockItems.map((label, index) => {
                            const key = shopStockItemKey(deliveryId, index);
                            const stockChecked = checkedShopStockKeys.has(key);
                            return (
                              <button
                                key={key}
                                type="button"
                                onClick={() => toggleShopStockItem(key)}
                                className="w-full rounded-xl border border-border bg-bg-surface px-3 py-3 text-left"
                              >
                                <div className="flex items-start gap-3">
                                  <span
                                    className={`mt-0.5 shrink-0 ${
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
                                    className={`text-sm font-medium ${
                                      stockChecked
                                        ? "text-text-secondary line-through"
                                        : "text-text-primary"
                                    }`}
                                  >
                                    {label}
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                        {d.delivery.shopStockLocationNote?.trim() && (
                          <p className="mt-3 text-xs text-text-secondary">
                            Location: {d.delivery.shopStockLocationNote.trim()}
                          </p>
                        )}
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
            All items picked up — tap Done to finish
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
          {submitting ? "Submitting…" : "Done — All Picked Up ✓"}
        </button>
      </div>
    </div>
  );
}

export default function PickupPortalPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const jobIdFromUrl = searchParams.get("job");
  const deliveryFromUrl = searchParams.get("delivery");
  const zoneFromUrl = searchParams.get("zone");
  const [discoveredJobId, setDiscoveredJobId] = useState<string | null>(null);
  const [highlightDeliveryId, setHighlightDeliveryId] = useState<
    string | null
  >(deliveryFromUrl);
  const [zoneDeepLinkPending, setZoneDeepLinkPending] = useState(
    Boolean(zoneFromUrl && !jobIdFromUrl),
  );
  const [zoneDeepLinkError, setZoneDeepLinkError] = useState<string | null>(
    null,
  );

  const activeJobId = jobIdFromUrl ?? discoveredJobId;

  useEffect(() => {
    if (!zoneFromUrl || jobIdFromUrl) return;
    let cancelled = false;
    void (async () => {
      const resolved = await resolveZoneScanDisposition(zoneFromUrl);
      if (cancelled) return;
      if (resolved?.kind === "receive") {
        navigate(`/receive?id=${encodeURIComponent(resolved.deliveryId)}`, {
          replace: true,
        });
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
  }, [zoneFromUrl, jobIdFromUrl, setSearchParams, navigate]);

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
    setHighlightDeliveryId(null);
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  return (
    <div className="app-container flex flex-col h-screen h-dvh bg-bg-primary overflow-hidden">
      {zoneDeepLinkPending ? (
        <div className="flex flex-1 items-center justify-center text-text-secondary text-sm">
          Loading pickup for zone {zoneFromUrl}…
        </div>
      ) : activeJobId ? (
        <JobPickupScreen
          key={`${activeJobId}-${highlightDeliveryId ?? "link"}`}
          jobId={activeJobId}
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
