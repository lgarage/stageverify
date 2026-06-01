import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  firestoreDataService,
  getAppSettings,
  getDeliveryDetailsPublic,
  markDeliveryInstalled,
} from "./dispatcher/firestoreService";
import {
  DELIVERY_STATUS_LABEL,
  getAllStagingLocationIds,
  type DeliveryDetails,
  type DeliveryStatus,
  type StagingLocation,
} from "./dispatcher/models";

const normalizeZoneCode = (code: string): string =>
  code.replace(/[^A-Z0-9]/gi, "").toUpperCase();

const icons = {
  check: "M5 13l4 4L19 7",
  chevronDown: "M6 9l6 6 6-6",
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

const PORTAL_STATUSES: DeliveryStatus[] = [
  "ready_for_pickup",
  "complete",
  "partial",
  "picked_up",
  "installed",
];

function isPortalDelivery(status: DeliveryStatus): boolean {
  return PORTAL_STATUSES.includes(status);
}

function isPickupReady(status: DeliveryStatus): boolean {
  return (
    status === "ready_for_pickup" ||
    status === "complete" ||
    status === "partial"
  );
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

async function loadPickupReadyDeliveries(
  jobId: string,
): Promise<DeliveryDetails[]> {
  const result = await firestoreDataService.listDeliveries({
    jobId,
    pageSize: 100,
  });
  const pickupReady = result.items.filter((d) => isPortalDelivery(d.status));
  const detailsList = await Promise.all(
    pickupReady.map((d) => getDeliveryDetailsPublic(d.deliveryId)),
  );
  return detailsList.filter((d): d is DeliveryDetails => d !== null);
}

async function resolveJobFromZoneCode(
  zoneCode: string,
): Promise<{ jobId: string; deliveryId: string } | null> {
  const trimmed = zoneCode.trim();
  if (!trimmed) return null;

  const result = await firestoreDataService.listDeliveries({ pageSize: 100 });
  const normalized = normalizeZoneCode(trimmed);
  const match = result.items.find(
    (d) =>
      d.stagingLocationCode &&
      normalizeZoneCode(d.stagingLocationCode) === normalized &&
      isPickupReady(d.status),
  );
  if (!match) return null;

  const details = await getDeliveryDetailsPublic(match.deliveryId);
  if (!details) return null;

  return { jobId: details.delivery.jobId, deliveryId: details.delivery.id };
}

function QrScannerOverlay({
  readerId,
  onDecode,
  onCancel,
}: {
  readerId: string;
  onDecode: (text: string) => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    let isMounted = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let html5QrCode: any = null;
    let handledDecode = false;

    import("html5-qrcode").then(({ Html5Qrcode }) => {
      if (!isMounted) return;
      html5QrCode = new Html5Qrcode(readerId);
      html5QrCode
        .start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText: string) => {
            if (handledDecode || !isMounted) return;
            handledDecode = true;
            onDecode(decodedText);
          },
          () => {
            // ignore continuous scan errors
          },
        )
        .catch((err: unknown) => {
          console.error("Error starting scanner", err);
          if (isMounted) onCancel();
        });
    });

    return () => {
      isMounted = false;
      if (html5QrCode) {
        try {
          html5QrCode
            .stop()
            .then(() => {
              html5QrCode.clear();
            })
            .catch(() => {});
        } catch {
          // ignore
        }
      }
    };
  }, [readerId, onDecode, onCancel]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div className="flex-1 flex flex-col bg-bg-primary">
      <div className="flex-1 flex flex-col items-center justify-center p-6 animate-slide-up">
        <p className="text-[10px] font-mono text-accent/80 tracking-[0.3em] uppercase mb-8">
          Pickup Portal
        </p>

        <div className="relative w-full max-w-[280px] aspect-square mb-8">
          <div className="absolute inset-0 border-2 border-accent rounded-3xl overflow-hidden bg-bg-secondary/50">
            <div
              id={readerId}
              className="w-full h-full overflow-hidden rounded-2xl"
            />

            <div className="absolute left-0 right-0 h-0.5 bg-accent shadow-[0_0_8px_2px_rgba(59,130,246,0.5)] animate-scan-line z-10" />

            <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-accent rounded-tl-3xl z-20" />
            <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-accent rounded-tr-3xl z-20" />
            <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-accent rounded-bl-3xl z-20" />
            <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-accent rounded-br-3xl z-20" />

            <div className="absolute bottom-4 left-0 right-0 text-center z-20">
              <span className="text-[10px] font-mono text-accent/80 tracking-[0.3em] uppercase">
                Align QR
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={onCancel}
          className="text-text-secondary text-sm font-medium py-2 px-4"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function WalkUpEntry({
  onJobResolved,
}: {
  onJobResolved: (jobId: string, highlightDeliveryId: string | null) => void;
}) {
  const [isScanning, setIsScanning] = useState(false);
  const [notFoundCode, setNotFoundCode] = useState<string | null>(null);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualZoneCode, setManualZoneCode] = useState("");
  const [resolving, setResolving] = useState(false);

  const handleDecodedText = useCallback(
    async (text: string) => {
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
      const resolved = await resolveJobFromZoneCode(normalizeZoneCode(trimmed));
      setResolving(false);
      if (!resolved) {
        setNotFoundCode(trimmed);
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
        onDecode={handleScanDecode}
        onCancel={handleCancelScan}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col px-6 py-12">
      <p className="text-[10px] font-mono text-accent/80 tracking-[0.3em] uppercase text-center mb-12">
        Pickup Portal
      </p>

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
              placeholder="Zone code (e.g. G2)"
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
  const [expandedDeliveryIds, setExpandedDeliveryIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [checkedItemIds, setCheckedItemIds] = useState<Set<string>>(
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
          loadPickupReadyDeliveries(jobId),
          firestoreDataService.listStagingLocations(),
        ]);
        if (cancelled) return;
        setAllStagingLocations(stagingLocs);
        setAutoSubmitMinutes(settings.autoSubmitMinutes);
        if (settings.autoSubmitMinutes > 0) {
          setAutoSubmitSecondsLeft(settings.autoSubmitMinutes * 60);
        }
        setDeliveries(loaded);
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
      } catch {
        setCardErrors((prev) =>
          new Map(prev).set(
            deliveryId,
            "Failed to record pickup. Tap to retry.",
          ),
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

  const handleDone = useCallback(() => {
    if (submittedRef.current) return;
    const allChecked =
      deliveries.length > 0 &&
      deliveries.every((d) => checkedRef.current.has(d.delivery.id));
    if (!allChecked) return;
    submittedRef.current = true;
    setSubmitted(true);
  }, [deliveries]);

  const handleAutoSubmit = useCallback(async () => {
    if (submittedRef.current || submitting) return;
    submittedRef.current = true;
    setSubmitting(true);
    setError(null);

    const unchecked = deliveries.filter(
      (d) => !checkedRef.current.has(d.delivery.id),
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
    } catch {
      submittedRef.current = false;
      setError("Failed to auto-submit pickups. Please check off remaining items.");
    } finally {
      setSubmitting(false);
    }
  }, [deliveries, notes, submitting]);

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
      const normalized = normalizeZoneCode(zoneCode.trim());
      const match = deliveries.find(
        (d) =>
          d.stagingLocation?.code &&
          normalizeZoneCode(d.stagingLocation.code) === normalized,
      );
      setIsScanning(false);
      if (!match) {
        setZoneScanError("Zone not in this job");
        window.setTimeout(() => setZoneScanError(null), 3000);
        return;
      }
      setZoneScanError(null);
      highlightCard(match.delivery.id);
    },
    [deliveries, highlightCard],
  );

  const handleCancelScan = useCallback(() => {
    setIsScanning(false);
  }, []);

  const allItems = deliveries.flatMap((d) => d.items);

  const toggleExpandedDelivery = useCallback((deliveryId: string) => {
    setExpandedDeliveryIds((prev) => {
      const next = new Set(prev);
      if (next.has(deliveryId)) {
        next.delete(deliveryId);
      } else {
        next.add(deliveryId);
      }
      return next;
    });
  }, []);

  const checkOffItem = useCallback((itemId: string) => {
    setCheckedItemIds((prev) => {
      if (prev.has(itemId)) return prev;
      return new Set([...prev, itemId]);
    });
  }, []);

  const allChecked =
    deliveries.length > 0 &&
    deliveries.every(
      (d) =>
        checked.has(d.delivery.id) ||
        d.delivery.status === "picked_up" ||
        d.delivery.status === "installed",
    );

  if (isScanning) {
    return (
      <QrScannerOverlay
        readerId="checkoff-reader"
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
          Pickup recorded
        </h2>
        <p className="text-base text-text-secondary mb-12">
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
        <p className="text-[10px] font-mono text-accent/80 tracking-[0.3em] uppercase mb-8">
          Pickup Portal
        </p>
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
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <p className="text-[10px] font-mono text-accent/80 tracking-[0.3em] uppercase text-center mb-2">
          Pickup Portal
        </p>
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
            const isExpanded = expandedDeliveryIds.has(deliveryId);
            const stagingLocations = resolveStagingLocations(
              d,
              allStagingLocations,
            );
            const primaryStaging = stagingLocations[0];
            const stagingCode = primaryStaging?.code ?? "—";
            const canCheckOff = isPickupReady(deliveryStatus) && !isChecked;
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
                <div className="flex items-stretch">
                  <button
                    ref={(el) => {
                      if (el) cardRefs.current.set(deliveryId, el);
                      else cardRefs.current.delete(deliveryId);
                    }}
                    type="button"
                    disabled={!canCheckOff || isChecking}
                    onClick={() => void checkOffDelivery(d)}
                    className="flex-1 min-w-0 p-4 text-left disabled:cursor-default"
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
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    aria-label={`${isExpanded ? "Collapse" : "Expand"} zone ${stagingCode}`}
                    aria-expanded={isExpanded}
                    onClick={() => toggleExpandedDelivery(deliveryId)}
                    className="shrink-0 w-12 border-l border-border text-text-secondary flex items-center justify-center active:bg-bg-secondary transition-colors"
                  >
                    <span
                      className={`transition-transform duration-200 ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                    >
                      <Svg d={icons.chevronDown} size={20} />
                    </span>
                  </button>
                </div>
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
                <div
                  className={`overflow-hidden transition-[max-height,opacity] duration-200 ${
                    isExpanded ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"
                  }`}
                >
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

                    {allItems.length === 0 ? (
                      <p className="rounded-xl border border-border bg-bg-surface px-3 py-3 text-sm text-text-secondary">
                        No items on record
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {allItems.map((item) => {
                          const itemChecked = checkedItemIds.has(item.id);
                          return (
                            <button
                              key={item.id}
                              type="button"
                              disabled={itemChecked}
                              onClick={() => checkOffItem(item.id)}
                              className="w-full rounded-xl border border-border bg-bg-surface px-3 py-3 text-left disabled:cursor-default"
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
                  </div>
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

      <div className="shrink-0 px-6 pb-[calc(env(safe-area-inset-bottom,16px)+16px)] pt-2 border-t border-border bg-bg-primary">
        {autoSubmitMinutes > 0 &&
          autoSubmitSecondsLeft !== null &&
          autoSubmitSecondsLeft > 0 && (
            <p className="text-center text-xs text-text-secondary mb-2">
              Auto-submitting in {formatCountdown(autoSubmitSecondsLeft)}
            </p>
          )}
        <button
          onClick={handleDone}
          disabled={submitting || !allChecked}
          className="action-btn action-btn-delivered w-full disabled:opacity-40"
        >
          {submitting ? "Submitting…" : "Done — All Picked Up ✓"}
        </button>
      </div>
    </div>
  );
}

export default function PickupPortalPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const jobIdFromUrl = searchParams.get("job");
  const [discoveredJobId, setDiscoveredJobId] = useState<string | null>(null);
  const [highlightDeliveryId, setHighlightDeliveryId] = useState<
    string | null
  >(null);

  const activeJobId = jobIdFromUrl ?? discoveredJobId;

  const handleJobResolved = useCallback(
    (jobId: string, deliveryId: string | null) => {
      setDiscoveredJobId(jobId);
      setHighlightDeliveryId(deliveryId);
    },
    [],
  );

  const handleStartOver = useCallback(() => {
    setDiscoveredJobId(null);
    setHighlightDeliveryId(null);
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  return (
    <div className="app-container flex flex-col h-screen h-dvh bg-bg-primary overflow-hidden">
      {activeJobId ? (
        <JobPickupScreen
          key={`${activeJobId}-${highlightDeliveryId ?? "link"}`}
          jobId={activeJobId}
          highlightDeliveryId={highlightDeliveryId}
          onStartOver={handleStartOver}
        />
      ) : (
        <WalkUpEntry onJobResolved={handleJobResolved} />
      )}
    </div>
  );
}
