import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  firestoreDataService,
  getAppSettings,
  getDeliveryDetailsPublic,
} from "./dispatcher/firestoreService";
import type { Html5QrcodeInstance } from "./qrScannerTypes";
import { handleScannedQr } from "./scanRouting";
import type {
  DeliveryOrder,
  Item,
  StagingLocation,
  Vendor,
  Job,
} from "./dispatcher/models";
import { NeedMoreSpaceButton } from "./NeedMoreSpaceButton";
import { PortalNavBar } from "./PortalNavBar";

// --- Icons ---
const icons = {
  scan: "M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M3 17v2a2 2 0 002 2h2M17 21h2a2 2 0 002-2v-2M7 12h10",
  check: "M5 13l4 4L19 7",
  alert:
    "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
  expand:
    "M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4",
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

type Step = "scan" | "name" | "list" | "done";

type CheckInItem = {
  id: string;
  description: string;
  qtyOrdered: number;
  deliveredQty: number;
  damagedQty: number;
};

type CheckInDelivery = {
  delivery: DeliveryOrder;
  vendor: Vendor | undefined;
  job: Job | undefined;
  location: StagingLocation | undefined;
  allItems: Item[];
};

function ScanScreen() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("scan");
  const [currentDelivery, setCurrentDelivery] = useState<CheckInDelivery | null>(
    null,
  );
  const [checkInItems, setCheckInItems] = useState<CheckInItem[]>([]);
  const [driverName, setDriverName] = useState("");
  const [adjustingItemId, setAdjustingItemId] = useState<string | null>(null);
  const [adjustQty, setAdjustQty] = useState<number>(0);
  const [adjustDamagedQty, setAdjustDamagedQty] = useState<number>(0);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [notFoundCode, setNotFoundCode] = useState<string | null>(null);
  const [scanError] = useState<string | null>(null);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [revertWindowMinutes, setRevertWindowMinutes] = useState(60);
  const [reverting, setReverting] = useState(false);

  useEffect(() => {
    getAppSettings().then((s) => setRevertWindowMinutes(s.vendorRevertWindowMinutes));
  }, []);

  const handleDeliveryFound = async (deliveryId: string) => {
    const details = await getDeliveryDetailsPublic(deliveryId);
    if (!details) return;
    const { delivery, vendor, job, stagingLocation, items: allItems } = details;
    setCurrentDelivery({ delivery, vendor, job, location: stagingLocation, allItems });
    setCheckInItems(
      allItems.map((i) => ({
        id: i.id,
        description: i.description,
        qtyOrdered: i.qtyOrdered,
        deliveredQty: 0,
        damagedQty: 0,
      })),
    );
    setIsScanning(false);
    setNotFoundCode(null);
    setStep("name");
  };

  const handleManualScan = async () => {
    setNotFoundCode(null);
    let result = await firestoreDataService.listDeliveries({
      statuses: ["pending"],
      pageSize: 1,
    });
    if (result.items.length === 0) {
      result = await firestoreDataService.listDeliveries({
        statuses: ["arrived"],
        pageSize: 1,
      });
    }
    if (result.items.length > 0) {
      navigate(`/checkin/${result.items[0].deliveryId}`);
    } else {
      setNotFoundCode("__no_deliveries__");
    }
  };

  const handleCancelScan = () => {
    setIsScanning(false);
  };

  useEffect(() => {
    let isMounted = true;
    let html5QrCode: Html5QrcodeInstance | null = null;
    let handledDecode = false;

    if (isScanning) {
      import("html5-qrcode").then(({ Html5Qrcode }) => {
        if (!isMounted) return;
        html5QrCode = new Html5Qrcode(
          "reader",
        ) as unknown as Html5QrcodeInstance;
        html5QrCode
          .start(
            { facingMode: "environment" },
            { fps: 10, qrbox: { width: 250, height: 250 } },
            (decodedText: string) => {
              if (handledDecode || !isMounted) return;
              handledDecode = true;
              void (async () => {
                const result = await handleScannedQr(decodedText, "app-checkin");
                if (!isMounted) return;

                switch (result.action) {
                  case "navigate":
                    navigate(result.path);
                    return;
                  case "load-checkin-app":
                    if (result.markArrived) {
                      await firestoreDataService.updateDeliveryStatus(
                        result.deliveryId,
                        "arrived",
                      );
                    }
                    await handleDeliveryFound(result.deliveryId);
                    return;
                  case "not-found":
                    setIsScanning(false);
                    setNotFoundCode(decodedText);
                }
              })();
            },
            () => {
              // ignore continuous scan errors
            },
          )
          .catch((err: unknown) => {
            console.error("Error starting scanner", err);
            if (isMounted) void handleManualScan();
          });
      });
    }

    return () => {
      isMounted = false;
      const scanner = html5QrCode;
      if (scanner) {
        try {
          void scanner
            .stop()
            .then(() => scanner.clear())
            .catch(() => {});
        } catch {
          // ignore
        }
      }
    };
  }, [isScanning]);

  const toggleItemCheck = (id: string) => {
    const toggled = checkInItems.find((i) => i.id === id);
    const newQty =
      toggled && toggled.deliveredQty > 0 ? 0 : (toggled?.qtyOrdered ?? 0);

    setCheckInItems(
      checkInItems.map((it) => {
        if (it.id === id) {
          const currentlyChecked = it.deliveredQty > 0;
          return {
            ...it,
            deliveredQty: currentlyChecked ? 0 : it.qtyOrdered,
            damagedQty: 0,
          };
        }
        return it;
      }),
    );

    // fire-and-forget — write qty to Firestore so auto-submit has accurate data
    if (toggled && currentDelivery) {
      void firestoreDataService.updateItemQty(
        currentDelivery.delivery.id,
        id,
        toggled.qtyOrdered,
        newQty,
        toggled.qtyOrdered - newQty,
      );
    }
  };

  const openAdjust = (it: CheckInItem) => {
    setAdjustingItemId(it.id);
    setAdjustQty(it.deliveredQty);
    setAdjustDamagedQty(it.damagedQty);
  };

  const saveAdjust = () => {
    if (!adjustingItemId) return;
    const adjItem = checkInItems.find((i) => i.id === adjustingItemId);
    const missingAfterDeliver = adjItem
      ? adjItem.qtyOrdered - adjustQty
      : 0;
    const clampedDamaged = Math.min(
      Math.max(0, adjustDamagedQty),
      missingAfterDeliver,
    );
    setCheckInItems(
      checkInItems.map((it) => {
        if (it.id === adjustingItemId) {
          return {
            ...it,
            deliveredQty: adjustQty,
            damagedQty: clampedDamaged,
          };
        }
        return it;
      }),
    );
    setAdjustingItemId(null);

    const adj = checkInItems.find((i) => i.id === adjustingItemId);
    if (adj && currentDelivery) {
      void firestoreDataService.updateItemQty(
        currentDelivery.delivery.id,
        adj.id,
        adj.qtyOrdered,
        adjustQty,
        adj.qtyOrdered - adjustQty,
      );
    }
  };

  const handleSubmit = () => {
    setShowSubmitConfirm(true);
  };

  const confirmSubmit = async () => {
    setShowSubmitConfirm(false);
    if (!currentDelivery) return;
    const now = new Date().toISOString();
    await firestoreDataService.submitCheckin(
      currentDelivery.delivery.id,
      driverName.trim() || "Vendor Driver",
      checkInItems.map((i) => ({
        id: i.id,
        qtyReceived: i.deliveredQty,
        qtyMissing: i.qtyOrdered - i.deliveredQty,
        qtyDamaged: i.damagedQty ?? 0,
      })),
    );
    setSubmittedAt(now);
    setStep("done");
  };

  const handleRevert = async () => {
    if (!currentDelivery) return;
    setReverting(true);
    await firestoreDataService.revertDeliveryStatus(
      currentDelivery.delivery.id,
      "vendor",
      revertWindowMinutes,
    );
    setReverting(false);
    setSubmittedAt(null);
    setStep("list");
  };

  const handleReset = () => {
    setCurrentDelivery(null);
    setCheckInItems([]);
    setDriverName("");
    setNotFoundCode(null);
    setAdjustingItemId(null);
    setStep("scan");
  };

  // Close modals on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAdjustingItemId(null);
        setShowSubmitConfirm(false);
        setIsScanning(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (isScanning) {
    return (
      <div className="flex-1 flex flex-col bg-bg-primary">
        <div className="flex-1 flex flex-col items-center justify-center p-6 animate-slide-up">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-text-primary mb-2">
              Vendor Check-In
            </h2>
            <p className="text-sm text-text-secondary">
              Scan the QR code at your assigned staging zone
            </p>
          </div>

          {/* Premium Scanner Box */}
          <div className="relative w-full max-w-[280px] aspect-square mb-8">
            {/* Scanner Frame */}
            <div className="absolute inset-0 border-2 border-accent rounded-3xl overflow-hidden bg-bg-secondary/50">
              <div id="reader" className="w-full h-full"></div>

              {/* Animated Scan Line */}
              <div className="absolute left-0 right-0 h-0.5 bg-accent shadow-[0_0_8px_2px_rgba(59,130,246,0.5)] animate-scan-line z-10"></div>

              {/* Corner Accents */}
              <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-accent rounded-tl-3xl z-20"></div>
              <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-accent rounded-tr-3xl z-20"></div>
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-accent rounded-bl-3xl z-20"></div>
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-accent rounded-br-3xl z-20"></div>

              {/* Overlay Text */}
              <div className="absolute bottom-4 left-0 right-0 text-center z-20">
                <span className="text-[10px] font-mono text-accent/80 tracking-[0.3em] uppercase">
                  Align QR
                </span>
              </div>
            </div>
          </div>

          {scanError && (
            <p className="text-accent-red mt-4 text-sm">{scanError}</p>
          )}

          <button
            onClick={() => { void handleManualScan(); }}
            className="action-btn action-btn-primary w-full max-w-[280px] mb-6"
          >
            <Svg d={icons.scan} size={20} />
            SIMULATE QR SCAN
          </button>

          <p className="text-xs text-text-secondary mb-8">
            Demo: taps a pending order automatically
          </p>

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
        <div className="mb-12">
          <h1 className="text-3xl font-bold text-text-primary mb-2">
            Vendor Check-In
          </h1>
          <p className="text-base text-text-secondary">
            Scan the QR code on your packing slip or staging zone.
          </p>
        </div>

        {notFoundCode && (
          <div className="mb-6 rounded-xl border border-accent-red/30 bg-accent-red/10 px-4 py-3 text-accent-red">
            {notFoundCode === "__no_deliveries__" ? (
              <p className="font-medium">No deliveries available to check in right now.</p>
            ) : (
              <>
                <p className="font-medium">No delivery found for this code.</p>
                <p className="mt-1 text-sm break-all">{notFoundCode}</p>
              </>
            )}
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
            Tap to Scan
          </span>
        </div>

        <div className="mt-8">
          <button
            onClick={() => { void handleManualScan(); }}
            className="action-btn action-btn-secondary"
          >
            ENTER ID MANUALLY
          </button>
        </div>
      </div>
    );
  }

  if (step === "name" && currentDelivery) {
    const { vendor, job, location } = currentDelivery;
    return (
      <div className="flex-1 flex flex-col px-6 py-12">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-text-primary mb-1">
            {vendor?.name ?? "Unknown Vendor"}
          </h2>
          <p className="text-base text-text-secondary">
            {job?.jobName} · Zone {location?.code ?? "—"}
          </p>
        </div>
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-text-primary mb-2">
            Who&rsquo;s delivering?
          </h1>
          <p className="text-base text-text-secondary">
            Enter your name to begin the check-in.
          </p>
        </div>
        <div className="mb-6">
          <label className="block text-sm font-medium text-text-secondary mb-2">
            Driver Name
          </label>
          <input
            type="text"
            value={driverName}
            onChange={(e) => setDriverName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && driverName.trim()) setStep("list");
            }}
            placeholder="e.g. John Smith"
            className="w-full bg-bg-surface border border-border rounded-xl px-4 py-3 text-text-primary text-base focus:outline-none focus:border-accent"
            autoFocus
          />
        </div>
        <button
          onClick={() => setStep("list")}
          disabled={!driverName.trim()}
          className="action-btn action-btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Continue
        </button>
        <button
          onClick={() => {
            setCurrentDelivery(null);
            setCheckInItems([]);
            setDriverName("");
            setStep("scan");
          }}
          className="text-text-secondary text-sm font-medium py-2 px-4 mt-4"
        >
          Back
        </button>
      </div>
    );
  }

  if (step === "list" && currentDelivery) {
    return (
      <div className="flex-1 flex flex-col relative h-full overflow-hidden">
        {/* Fixed Header */}
        <div className="bg-bg-secondary border-b border-border p-4 shrink-0 z-10">
          <h2 className="text-lg font-bold text-text-primary">
            {currentDelivery?.vendor?.name ?? "Unknown Vendor"}
          </h2>
          <p className="text-[13px] text-text-secondary mt-0.5">
            {currentDelivery?.job?.jobName}
          </p>
          <p className="text-[13px] text-text-secondary">
            {currentDelivery?.job?.jobNumber}
          </p>
          <p className="text-[13px] font-bold text-accent mt-1">
            Zone: {currentDelivery?.location?.code ?? "—"}
          </p>
          <p className="text-[13px] text-text-secondary mt-0.5">
            Driver: {driverName}
          </p>
        </div>

        {/* Scrollable Items List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {checkInItems.map((it) => {
            const isFullyDelivered = it.deliveredQty === it.qtyOrdered;
            const isPartial =
              it.deliveredQty > 0 && it.deliveredQty < it.qtyOrdered;
            const isChecked = isFullyDelivered || isPartial;

            return (
              <div
                key={it.id}
                className={`bg-bg-surface rounded-lg p-3 flex flex-col gap-2 border border-border transition-opacity ${isChecked ? "opacity-50" : "opacity-100"}`}
              >
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => toggleItemCheck(it.id)}
                    className={`shrink-0 mt-0.5 ${isPartial ? "text-accent-red" : "text-accent-green"}`}
                  >
                    <Svg
                      d={isChecked ? icons.checkSquare : icons.square}
                      size={28}
                    />
                  </button>
                  <div className="flex-1 min-w-0 flex flex-col">
                    <div className="flex items-start gap-2">
                      <span className="text-[14px] font-medium text-text-secondary shrink-0">
                        Qty: {it.qtyOrdered}
                      </span>
                      <span className="text-[14px] font-medium text-text-primary">
                        {it.description}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <button
                        onClick={() => openAdjust(it)}
                        className="bg-accent text-white font-medium py-1.5 px-6 rounded-full active:scale-[0.98] transition-transform text-[13px] inline-block"
                      >
                        Adjust
                      </button>
                      {isPartial && (
                        <span className="text-[12px] font-bold text-accent-red bg-accent-red/10 px-2 py-0.5 rounded">
                          Partial Delivery
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Fixed Bottom Actions */}
        <div className="bg-bg-secondary border-t border-border p-4 shrink-0 space-y-3 z-10 pb-[calc(env(safe-area-inset-bottom,16px)+16px)]">
          <button
            onClick={handleSubmit}
            className="action-btn action-btn-primary py-3"
          >
            Submit
          </button>
          <button
            onClick={() => setIsScanning(true)}
            className="action-btn action-btn-orange py-3"
          >
            Scan Another QR Code
          </button>
        </div>

        {/* Adjust Modal */}
        {adjustingItemId && (
          <div
            className="absolute inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
            onClick={() => setAdjustingItemId(null)}
          >
            <div
              className="bg-bg-surface rounded-xl p-6 w-full max-w-xs border border-border"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-xl font-bold text-text-primary mb-6 text-center">
                Adjust Quantity
              </h3>
              <div className="flex items-center justify-center gap-6 mb-6">
                <button
                  className="stepper-btn"
                  onClick={() => {
                    const next = Math.max(0, adjustQty - 1);
                    setAdjustQty(next);
                    const item = checkInItems.find(
                      (i) => i.id === adjustingItemId,
                    );
                    if (item) {
                      const maxDamaged = item.qtyOrdered - next;
                      setAdjustDamagedQty((d) =>
                        Math.min(d, maxDamaged),
                      );
                    }
                  }}
                >
                  −
                </button>
                <span className="text-3xl font-bold text-text-primary tabular-nums w-16 text-center">
                  {adjustQty}
                </span>
                <button
                  className="stepper-btn"
                  onClick={() => {
                    const item = checkInItems.find(
                      (i) => i.id === adjustingItemId,
                    );
                    if (item) {
                      const next = Math.min(item.qtyOrdered, adjustQty + 1);
                      setAdjustQty(next);
                      const maxDamaged = item.qtyOrdered - next;
                      setAdjustDamagedQty((d) =>
                        Math.min(d, maxDamaged),
                      );
                    }
                  }}
                >
                  +
                </button>
              </div>
              {(() => {
                const item = checkInItems.find(
                  (i) => i.id === adjustingItemId,
                );
                const maxDamaged = item
                  ? item.qtyOrdered - adjustQty
                  : 0;
                return (
                  <div className="mb-8">
                    <label className="block text-sm font-medium text-text-secondary mb-2 text-center">
                      Damaged qty
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={maxDamaged}
                      value={adjustDamagedQty}
                      onChange={(e) => {
                        const raw = Number.parseInt(e.target.value, 10);
                        const next = Number.isNaN(raw) ? 0 : raw;
                        setAdjustDamagedQty(
                          Math.min(Math.max(0, next), maxDamaged),
                        );
                      }}
                      className="w-full bg-bg-secondary border border-border rounded-lg px-4 py-3 text-text-primary text-center text-lg tabular-nums focus:outline-none focus:border-accent"
                    />
                    <p className="text-xs text-text-secondary text-center mt-2">
                      Max {maxDamaged} (missing qty)
                    </p>
                  </div>
                );
              })()}
              <div className="flex gap-3">
                <button
                  onClick={() => setAdjustingItemId(null)}
                  className="flex-1 py-3 text-text-secondary font-medium text-sm bg-bg-secondary rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={saveAdjust}
                  className="flex-1 py-3 bg-accent text-white font-medium text-sm rounded-lg"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Submit Confirmation Modal */}
        {showSubmitConfirm && (
          <div
            className="absolute inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
            onClick={() => setShowSubmitConfirm(false)}
          >
            <div
              className="bg-bg-surface rounded-xl p-6 w-full max-w-xs border border-border animate-slide-up"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-xl font-bold text-text-primary mb-4 text-center">
                Complete Delivery?
              </h3>

              <div className="text-center mb-6">
                <p className="text-text-secondary mb-2">Checked Items:</p>
                <p className="text-2xl font-bold text-text-primary mb-2">
                  {
                    checkInItems.filter(
                      (i) => i.deliveredQty === i.qtyOrdered,
                    ).length
                  }{" "}
                  of {checkInItems.length}
                </p>
                {checkInItems.every((i) => i.deliveredQty === i.qtyOrdered) ? (
                  <p className="text-accent-green font-medium">
                    All items verified.
                  </p>
                ) : (
                  <p className="text-accent-amber font-medium">
                    Some items are still unchecked.
                  </p>
                )}
              </div>

              <div className="space-y-4">
                <button
                  onClick={() => setShowSubmitConfirm(false)}
                  className="w-full py-3 bg-accent-orange text-white font-medium rounded-lg"
                >
                  Go Back
                </button>
                <button
                  onClick={() => {
                    void confirmSubmit();
                  }}
                  className="w-full py-3 bg-accent text-white font-medium rounded-lg"
                >
                  {checkInItems.every((i) => i.deliveredQty === i.qtyOrdered)
                    ? "Submit Delivery"
                    : "Submit Anyway"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (step === "done" && currentDelivery) {
    const allDelivered = checkInItems.every(
      (i) => i.deliveredQty === i.qtyOrdered,
    );
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center">
        <div
          className={`size-32 rounded-full flex items-center justify-center mb-8 ${
            allDelivered
              ? "bg-accent-green/20 text-accent-green"
              : "bg-accent-amber/20 text-accent-amber"
          }`}
        >
          <Svg d={icons.check} size={64} />
        </div>
        <h2 className="text-3xl font-bold text-text-primary mb-4">
          {allDelivered ? "Delivery Complete" : "Partial Delivery"}
        </h2>
        <p className="text-base text-text-secondary mb-4">
          {currentDelivery.delivery.orderNumber} · Zone{" "}
          {currentDelivery.location?.code ?? "—"}
        </p>
        <p className="text-sm text-text-secondary mb-12">
          Dispatch has been notified.
        </p>
        <div className="w-full max-w-sm mb-4">
          <NeedMoreSpaceButton
            delivery={currentDelivery.delivery}
            onDeliveryUpdated={(updated) =>
              setCurrentDelivery((prev) =>
                prev ? { ...prev, delivery: updated } : prev,
              )
            }
          />
        </div>
        {submittedAt &&
          Date.now() - new Date(submittedAt).getTime() <
            revertWindowMinutes * 60 * 1000 && (
            <button
              onClick={handleRevert}
              disabled={reverting}
              className="action-btn action-btn-secondary w-full mb-3"
            >
              {reverting ? "Reverting…" : "Undo Submission"}
            </button>
          )}
        <button
          onClick={handleReset}
          className="action-btn action-btn-secondary w-full"
        >
          New Check-In
        </button>
      </div>
    );
  }

  return null;
}

export default function App() {
  return (
    <div className="app-container flex flex-col h-screen h-dvh bg-bg-primary overflow-hidden">
      <ScanScreen />
      <div className="px-6 py-4">
        <PortalNavBar />
      </div>
    </div>
  );
}
