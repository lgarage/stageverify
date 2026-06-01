import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  firestoreDataService,
  getAppSettings,
} from "./dispatcher/firestoreService";
import type { DeliveryDetails, DeliveryStatus } from "./dispatcher/models";

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

const PICKUP_READY: DeliveryStatus[] = ["complete", "partial"];

function isPickupReady(status: DeliveryStatus): boolean {
  return PICKUP_READY.includes(status);
}

function formatCountdown(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function zoneSummary(deliveries: DeliveryDetails[]): string {
  const zones = deliveries
    .map((d) => d.stagingLocation?.code ?? "—")
    .join(", ");
  const vendors = [...new Set(deliveries.map((d) => d.vendor.name))].join(", ");
  return `${zones} · ${vendors}`;
}

async function loadPickupReadyDeliveries(
  jobId: string,
): Promise<DeliveryDetails[]> {
  const result = await firestoreDataService.listDeliveries({
    jobId,
    pageSize: 100,
  });
  const pickupReady = result.items.filter((d) => isPickupReady(d.status));
  const detailsList = await Promise.all(
    pickupReady.map((d) =>
      firestoreDataService.getDeliveryDetails(d.deliveryId),
    ),
  );
  return detailsList.filter((d): d is DeliveryDetails => d !== null);
}

async function resolveJobFromZoneCode(
  zoneCode: string,
): Promise<{ jobId: string; deliveryId: string } | null> {
  const trimmed = zoneCode.trim();
  if (!trimmed) return null;

  const result = await firestoreDataService.listDeliveries({ pageSize: 100 });
  const match = result.items.find(
    (d) => d.stagingLocationCode === trimmed && isPickupReady(d.status),
  );
  if (!match) return null;

  const details = await firestoreDataService.getDeliveryDetails(
    match.deliveryId,
  );
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
  onJobResolved: (jobId: string, preCheckedDeliveryId: string) => void;
}) {
  const [isScanning, setIsScanning] = useState(false);
  const [notFoundCode, setNotFoundCode] = useState<string | null>(null);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualZoneCode, setManualZoneCode] = useState("");
  const [resolving, setResolving] = useState(false);

  const handleZoneCode = useCallback(
    async (zoneCode: string) => {
      setResolving(true);
      const resolved = await resolveJobFromZoneCode(zoneCode);
      setResolving(false);
      if (!resolved) {
        setNotFoundCode(zoneCode.trim());
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
      void handleZoneCode(text);
    },
    [handleZoneCode],
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
                if (e.key === "Enter") void handleZoneCode(manualZoneCode);
              }}
              placeholder="Zone code (e.g. G2)"
              className="w-full bg-bg-surface border border-border rounded-xl px-4 py-3 text-text-primary text-base focus:outline-none focus:border-accent"
              autoFocus
            />
            <button
              onClick={() => void handleZoneCode(manualZoneCode)}
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
  initialCheckedIds = [],
  onStartOver,
}: {
  jobId: string;
  initialCheckedIds?: string[];
  onStartOver: () => void;
}) {
  const [deliveries, setDeliveries] = useState<DeliveryDetails[]>([]);
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(initialCheckedIds),
  );
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [technicianName, setTechnicianName] = useState("");
  const [notes, setNotes] = useState("");
  const [autoSubmitMinutes, setAutoSubmitMinutes] = useState(0);
  const [autoSubmitSecondsLeft, setAutoSubmitSecondsLeft] = useState<
    number | null
  >(null);
  const [isScanning, setIsScanning] = useState(false);
  const [zoneScanError, setZoneScanError] = useState<string | null>(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const [settings, loaded] = await Promise.all([
          getAppSettings(),
          loadPickupReadyDeliveries(jobId),
        ]);
        if (cancelled) return;
        setAutoSubmitMinutes(settings.autoSubmitMinutes);
        if (settings.autoSubmitMinutes > 0) {
          setAutoSubmitSecondsLeft(settings.autoSubmitMinutes * 60);
        }
        setDeliveries(loaded);
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

  const handleSubmit = useCallback(
    async (isAuto: boolean) => {
      if (submittedRef.current || submitting) return;
      submittedRef.current = true;
      setSubmitting(true);
      setError(null);

      const targets = isAuto
        ? deliveries
        : deliveries.filter((d) => checked.has(d.delivery.id));

      try {
        for (const d of targets) {
          await firestoreDataService.recordPickupEvent(
            d.delivery.id,
            technicianName.trim() || "Auto-submitted",
            `${d.items.length} item${d.items.length === 1 ? "" : "s"}`,
            notes || undefined,
          );
        }
        setSubmitted(true);
      } catch {
        submittedRef.current = false;
        setError("Failed to record pickup. Please try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [deliveries, checked, technicianName, notes, submitting],
  );

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
          if (prev === 1) void handleSubmit(true);
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
    handleSubmit,
  ]);

  const toggleChecked = (deliveryId: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(deliveryId)) next.delete(deliveryId);
      else next.add(deliveryId);
      return next;
    });
  };

  const handleCheckOffScan = useCallback(
    (zoneCode: string) => {
      const trimmed = zoneCode.trim();
      const match = deliveries.find(
        (d) => d.stagingLocation?.code === trimmed,
      );
      setIsScanning(false);
      if (!match) {
        setZoneScanError("Zone not in this job");
        window.setTimeout(() => setZoneScanError(null), 3000);
        return;
      }
      setZoneScanError(null);
      setChecked((prev) => new Set([...prev, match.delivery.id]));
    },
    [deliveries],
  );

  const handleCancelScan = useCallback(() => {
    setIsScanning(false);
  }, []);

  const allChecked =
    deliveries.length > 0 && checked.size === deliveries.length;
  const canManualSubmit = allChecked && technicianName.trim().length > 0;

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

  const jobName = deliveries[0]?.job.jobName ?? "Job";

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <p className="text-[10px] font-mono text-accent/80 tracking-[0.3em] uppercase text-center mb-2">
          Pickup Portal
        </p>
        <p className="text-center text-text-secondary text-sm mb-6">
          {jobName}
        </p>

        <div className="mb-4">
          <label
            htmlFor="technician-name"
            className="mb-2 block text-sm font-medium text-text-secondary"
          >
            Your name
          </label>
          <input
            id="technician-name"
            type="text"
            value={technicianName}
            onChange={(e) => setTechnicianName(e.target.value)}
            placeholder="Enter your name"
            className="w-full bg-bg-surface border border-border rounded-xl px-4 py-3 text-text-primary text-base focus:outline-none focus:border-accent"
            autoComplete="name"
          />
        </div>

        <div className="space-y-3 mb-4">
          {deliveries.map((d) => {
            const isChecked = checked.has(d.delivery.id);
            const isPartial = d.delivery.status === "partial";
            return (
              <button
                key={d.delivery.id}
                type="button"
                onClick={() => toggleChecked(d.delivery.id)}
                className={`w-full text-left bg-bg-surface rounded-2xl border p-4 transition-colors ${
                  isChecked
                    ? "border-accent-green shadow-[0_0_0_1px_rgba(34,197,94,0.3)]"
                    : "border-border"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`shrink-0 mt-0.5 ${
                      isChecked ? "text-accent-green" : "text-text-secondary"
                    }`}
                  >
                    <Svg
                      d={isChecked ? icons.checkSquare : icons.square}
                      size={24}
                    />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-text-primary font-bold">
                      Zone {d.stagingLocation?.code ?? "—"}
                    </p>
                    <p className="text-text-secondary text-sm">
                      {d.vendor.name} ·{" "}
                      {d.items.length === 1
                        ? "1 item"
                        : `${d.items.length} items`}
                    </p>
                    <span
                      className={`inline-block mt-2 text-xs font-bold px-3 py-1 rounded-full ${
                        isPartial
                          ? "bg-accent-amber/20 text-accent-amber"
                          : "bg-accent-green/20 text-accent-green"
                      }`}
                    >
                      {isPartial ? "Partial" : "Complete"}
                    </span>
                  </div>
                </div>
              </button>
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
          onClick={() => void handleSubmit(false)}
          disabled={submitting || !canManualSubmit}
          className="action-btn action-btn-delivered w-full disabled:opacity-40"
        >
          {submitting ? "Submitting…" : "Submit Pickup"}
        </button>
      </div>
    </div>
  );
}

export default function PickupPortalPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const jobIdFromUrl = searchParams.get("job");
  const [discoveredJobId, setDiscoveredJobId] = useState<string | null>(null);
  const [preCheckedDeliveryId, setPreCheckedDeliveryId] = useState<
    string | null
  >(null);

  const activeJobId = jobIdFromUrl ?? discoveredJobId;

  const handleJobResolved = useCallback(
    (jobId: string, deliveryId: string) => {
      setDiscoveredJobId(jobId);
      setPreCheckedDeliveryId(deliveryId);
    },
    [],
  );

  const handleStartOver = useCallback(() => {
    setDiscoveredJobId(null);
    setPreCheckedDeliveryId(null);
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  return (
    <div className="app-container flex flex-col h-screen h-dvh bg-bg-primary overflow-hidden">
      {activeJobId ? (
        <JobPickupScreen
          key={`${activeJobId}-${preCheckedDeliveryId ?? "link"}`}
          jobId={activeJobId}
          initialCheckedIds={
            preCheckedDeliveryId ? [preCheckedDeliveryId] : []
          }
          onStartOver={handleStartOver}
        />
      ) : (
        <WalkUpEntry onJobResolved={handleJobResolved} />
      )}
    </div>
  );
}
