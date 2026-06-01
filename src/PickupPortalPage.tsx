import { useState, useEffect } from "react";
import { firestoreDataService } from "./dispatcher/firestoreService";
import type { DeliveryDetails, DeliveryStatus } from "./dispatcher/models";

const icons = {
  check: "M5 13l4 4L19 7",
  camera:
    "M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z M15 13a3 3 0 11-6 0 3 3 0 016 0z",
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

type Step = "scan" | "confirm" | "done";

const PICKUP_READY: DeliveryStatus[] = ["complete", "partial"];

function isPickupReady(status: DeliveryStatus): boolean {
  return PICKUP_READY.includes(status);
}

function itemsSummary(details: DeliveryDetails): string {
  const count = details.items.length;
  return count === 1 ? "1 item" : `${count} items`;
}

function PickupScreen() {
  const [step, setStep] = useState<Step>("scan");
  const [currentDelivery, setCurrentDelivery] =
    useState<DeliveryDetails | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [notFoundCode, setNotFoundCode] = useState<string | null>(null);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualZoneCode, setManualZoneCode] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [technicianName, setTechnicianName] = useState("");

  const loadDeliveryByZoneCode = async (zoneCode: string) => {
    const trimmed = zoneCode.trim();
    if (!trimmed) return;

    const result = await firestoreDataService.listDeliveries({ pageSize: 100 });
    const match = result.items.find(
      (d) =>
        d.stagingLocationCode === trimmed && isPickupReady(d.status),
    );

    if (!match) {
      setNotFoundCode(trimmed);
      setIsScanning(false);
      return;
    }

    const details = await firestoreDataService.getDeliveryDetails(
      match.deliveryId,
    );
    if (!details) {
      setNotFoundCode(trimmed);
      setIsScanning(false);
      return;
    }

    setCurrentDelivery(details);
    setNotFoundCode(null);
    setIsScanning(false);
    setShowManualEntry(false);
    setManualZoneCode("");
    setStep("confirm");
  };

  const handleManualFind = () => {
    void loadDeliveryByZoneCode(manualZoneCode);
  };

  const handleCancelScan = () => {
    setIsScanning(false);
  };

  const handleConfirmPickup = async () => {
    if (!currentDelivery) return;
    const trimmedTechnicianName = technicianName.trim();
    if (!trimmedTechnicianName) {
      setConfirmError("Please enter your name before confirming.");
      return;
    }
    setConfirming(true);
    setConfirmError(null);
    try {
      await firestoreDataService.recordPickupEvent(
        currentDelivery.delivery.id,
        trimmedTechnicianName,
        itemsSummary(currentDelivery),
      );
      setStep("done");
    } catch {
      setConfirmError("Failed to record pickup. Please try again.");
    } finally {
      setConfirming(false);
    }
  };

  const handleReset = () => {
    setCurrentDelivery(null);
    setNotFoundCode(null);
    setShowManualEntry(false);
    setManualZoneCode("");
    setConfirmError(null);
    setTechnicianName("");
    setStep("scan");
  };

  useEffect(() => {
    let isMounted = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let html5QrCode: any = null;
    let handledDecode = false;

    if (isScanning) {
      import("html5-qrcode").then(({ Html5Qrcode }) => {
        if (!isMounted) return;
        html5QrCode = new Html5Qrcode("reader");
        html5QrCode
          .start(
            { facingMode: "environment" },
            { fps: 10, qrbox: { width: 250, height: 250 } },
            (decodedText: string) => {
              if (handledDecode || !isMounted) return;
              handledDecode = true;
              void loadDeliveryByZoneCode(decodedText);
            },
            () => {
              // ignore continuous scan errors
            },
          )
          .catch((err: unknown) => {
            console.error("Error starting scanner", err);
            if (isMounted) setIsScanning(false);
          });
      });
    }

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
  }, [isScanning]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsScanning(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (isScanning) {
    return (
      <div className="flex-1 flex flex-col bg-bg-primary">
        <div className="flex-1 flex flex-col items-center justify-center p-6 animate-slide-up">
          <p className="text-[10px] font-mono text-accent/80 tracking-[0.3em] uppercase mb-8">
            Pickup Portal
          </p>

          <div className="relative w-full max-w-[280px] aspect-square mb-8">
            <div className="absolute inset-0 border-2 border-accent rounded-3xl overflow-hidden bg-bg-secondary/50">
              <div id="reader" className="w-full h-full overflow-hidden rounded-2xl" />

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
            onClick={handleCancelScan}
            className="text-text-secondary text-sm font-medium py-2 px-4"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (step === "scan") {
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
                  if (e.key === "Enter") handleManualFind();
                }}
                placeholder="Zone code (e.g. G2)"
                className="w-full bg-bg-surface border border-border rounded-xl px-4 py-3 text-text-primary text-base focus:outline-none focus:border-accent"
                autoFocus
              />
              <button
                onClick={handleManualFind}
                disabled={!manualZoneCode.trim()}
                className="action-btn action-btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Find
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (step === "confirm" && currentDelivery) {
    const { vendor, job, stagingLocation, delivery, items } = currentDelivery;
    const isPartial = delivery.status === "partial";

    return (
      <div className="flex-1 flex flex-col px-6 py-12">
        <p className="text-[10px] font-mono text-accent/80 tracking-[0.3em] uppercase text-center mb-8">
          Pickup Portal
        </p>

        <div className="bg-bg-surface rounded-2xl border border-border p-5 mb-8">
          <div className="mb-4">
            <span className="inline-block bg-accent/10 text-accent rounded-lg px-3 py-1 text-sm font-bold">
              {stagingLocation?.code ?? "—"}
            </span>
          </div>
          <h2 className="text-text-primary text-xl font-bold mb-1">
            {vendor.name}
          </h2>
          <p className="text-text-secondary text-sm mb-3">{job.jobName}</p>
          <p className="text-text-secondary text-sm mb-3">
            {items.length === 1 ? "1 item" : `${items.length} items`}
          </p>
          <span
            className={`inline-block text-xs font-bold px-3 py-1 rounded-full ${
              isPartial
                ? "bg-accent-amber/20 text-accent-amber"
                : "bg-accent-green/20 text-accent-green"
            }`}
          >
            {isPartial ? "Partial" : "Complete"}
          </span>
        </div>

        {confirmError && (
          <div className="mb-4 rounded-xl border border-accent-red/30 bg-accent-red/10 px-4 py-3 text-accent-red text-sm">
            {confirmError}
          </div>
        )}

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

        <button
          onClick={() => {
            void handleConfirmPickup();
          }}
          disabled={confirming || !technicianName.trim()}
          className="action-btn action-btn-delivered mb-3 disabled:opacity-40"
        >
          {confirming ? "Confirming…" : "Confirm Pickup"}
        </button>
        <button
          onClick={handleReset}
          disabled={confirming}
          className="action-btn action-btn-secondary"
        >
          Back / Scan Again
        </button>
      </div>
    );
  }

  if (step === "done" && currentDelivery) {
    const { vendor, stagingLocation } = currentDelivery;
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center">
        <div className="size-24 rounded-full bg-accent-green/10 text-accent-green flex items-center justify-center mb-8">
          <Svg d={icons.check} size={48} />
        </div>
        <h2 className="text-3xl font-bold text-text-primary mb-4">
          Picked Up!
        </h2>
        <p className="text-base text-text-secondary mb-12">
          Zone {stagingLocation?.code ?? "—"} · {vendor.name}
        </p>
        <button onClick={handleReset} className="action-btn action-btn-secondary w-full">
          Scan Another
        </button>
      </div>
    );
  }

  return null;
}

export default function PickupPortalPage() {
  return (
    <div className="app-container flex flex-col h-screen h-dvh bg-bg-primary overflow-hidden">
      <PickupScreen />
    </div>
  );
}
