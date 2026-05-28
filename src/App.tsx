import { useState, useEffect } from "react";
import { mockOrders, stagingZones } from "./mockData";
import type { Order, LineItem as OrderItem } from "./types";

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

type Step = "scan" | "list" | "done";

function ScanScreen() {
  const [step, setStep] = useState<Step>("scan");
  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [adjustingItemId, setAdjustingItemId] = useState<string | null>(null);
  const [adjustQty, setAdjustQty] = useState<number>(0);
  const [showSpaceModal, setShowSpaceModal] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError] = useState<string | null>(null);

  const handleOrderFound = (o: Order) => {
    setIsScanning(false);
    setOrder(o);
    setItems(
      o.items.map((it) => ({
        ...it,
        deliveredQty: 0,
        missingQty: it.quantity,
        status: null,
      })),
    );
    setStep("list");
  };

  const handleManualScan = () => {
    handleOrderFound(mockOrders[0]);
  };

  const handleCancelScan = () => {
    setIsScanning(false);
  };

  useEffect(() => {
    let isMounted = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let html5QrCode: any = null;

    if (isScanning) {
      // Use Html5Qrcode directly to avoid the built-in UI (camera selection, etc.)
      import("html5-qrcode").then(({ Html5Qrcode }) => {
        if (!isMounted) return;

        html5QrCode = new Html5Qrcode("reader");

        html5QrCode
          .start(
            { facingMode: "environment" },
            {
              fps: 10,
              qrbox: { width: 250, height: 250 },
            },
            (decodedText: string) => {
              const foundOrder = mockOrders.find(
                (o) => o.id === decodedText || o.zoneId === decodedText,
              );
              if (foundOrder) {
                handleOrderFound(foundOrder);
              } else {
                handleOrderFound(mockOrders[0]);
              }
            },
            () => {
              // Ignore continuous scanning errors
            },
          )
          .catch((err: unknown) => {
            console.error("Error starting scanner", err);
            // Fallback if camera fails
            if (isMounted) {
              handleManualScan();
            }
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
            .catch(() => {
              // ignore
            });
        } catch {
          // ignore
        }
      }
    };
  }, [isScanning]);

  const toggleItemCheck = (id: string) => {
    setItems(
      items.map((it) => {
        if (it.id === id) {
          const isChecked = it.deliveredQty === it.quantity;
          return {
            ...it,
            deliveredQty: isChecked ? 0 : it.quantity,
            missingQty: isChecked ? it.quantity : 0,
            status: isChecked ? null : "Delivered",
          };
        }
        return it;
      }),
    );
  };

  const openAdjust = (it: OrderItem) => {
    setAdjustingItemId(it.id);
    setAdjustQty(it.deliveredQty);
  };

  const saveAdjust = () => {
    if (!adjustingItemId) return;
    setItems(
      items.map((it) => {
        if (it.id === adjustingItemId) {
          return {
            ...it,
            deliveredQty: adjustQty,
            missingQty: it.quantity - adjustQty,
            status:
              adjustQty === it.quantity
                ? "Delivered"
                : adjustQty > 0
                  ? "Partial"
                  : null,
          };
        }
        return it;
      }),
    );
    setAdjustingItemId(null);
  };

  const handleSubmit = () => {
    if (order) {
      const allDelivered = items.every((it) => it.deliveredQty === it.quantity);
      setOrder({ ...order, status: allDelivered ? "Complete" : "Partial" });
    }
    setStep("done");
  };

  const handleReset = () => {
    setOrder(null);
    setItems([]);
    setStep("scan");
  };

  const handleRequestSpace = (type: "ground" | "shelf") => {
    if (!order) return;

    // Find nearest available spot
    const availableSpot = stagingZones.find(
      (z) =>
        z.currentOrderId === null &&
        (type === "ground" ? z.id.startsWith("G") : z.id.startsWith("S")),
    );

    if (availableSpot) {
      const newZones = order.additionalZoneIds
        ? [...order.additionalZoneIds]
        : [];
      newZones.push(availableSpot.id);
      setOrder({ ...order, additionalZoneIds: newZones });
      availableSpot.currentOrderId = order.id; // Mock update
    } else {
      alert("No available spots of that type.");
    }
    setShowSpaceModal(false);
  };

  // Close modals on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAdjustingItemId(null);
        setShowSpaceModal(false);
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
            onClick={handleManualScan}
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

        <div
          onClick={() => setIsScanning(true)}
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
            onClick={handleManualScan}
            className="action-btn action-btn-secondary"
          >
            ENTER ID MANUALLY
          </button>
        </div>
      </div>
    );
  }

  if (step === "list" && order) {
    const allZones = [order.zoneId, ...(order.additionalZoneIds || [])];

    return (
      <div className="flex-1 flex flex-col relative h-full overflow-hidden">
        {/* Fixed Header */}
        <div className="bg-bg-secondary border-b border-border p-4 shrink-0 z-10">
          <button
            onClick={() => setShowSpaceModal(true)}
            className="w-full bg-accent-amber text-black font-bold py-2 rounded-full mb-3 active:scale-[0.98] transition-transform text-sm"
          >
            Need More Space?
          </button>

          <h2 className="text-lg font-bold text-text-primary">
            {order.vendor}
          </h2>
          <p className="text-[13px] text-text-secondary mt-0.5">
            {order.jobName}
          </p>
          <p className="text-[13px] text-text-secondary">{order.jobNumber}</p>
          {order.poNumber && (
            <p className="text-[13px] text-text-secondary">{order.poNumber}</p>
          )}
          <p className="text-[13px] font-bold text-accent mt-1">
            Spots: {allZones.join(", ")}
          </p>
        </div>

        {/* Scrollable Items List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {items.map((it) => {
            const isChecked = it.deliveredQty === it.quantity;
            return (
              <div
                key={it.id}
                className={`bg-bg-surface rounded-lg p-3 flex items-center gap-3 border border-border transition-opacity ${isChecked ? "opacity-50" : "opacity-100"}`}
              >
                <button
                  onClick={() => toggleItemCheck(it.id)}
                  className="shrink-0 text-accent-green"
                >
                  <Svg
                    d={isChecked ? icons.checkSquare : icons.square}
                    size={28}
                  />
                </button>
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <span className="text-[14px] font-medium text-text-secondary shrink-0">
                    Qty: {it.quantity}
                  </span>
                  <span className="text-[14px] font-medium text-text-primary truncate">
                    {it.description}
                  </span>
                </div>
                <button
                  onClick={() => openAdjust(it)}
                  className="bg-accent text-white font-medium py-1.5 px-4 rounded-full active:scale-[0.98] transition-transform text-[13px] shrink-0"
                >
                  Adjust
                </button>
              </div>
            );
          })}
        </div>

        {/* Fixed Bottom Actions */}
        <div className="bg-bg-secondary border-t border-border p-4 shrink-0 space-y-2 z-10 pb-[env(safe-area-inset-bottom,16px)]">
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
              <div className="flex items-center justify-center gap-6 mb-8">
                <button
                  className="stepper-btn"
                  onClick={() => setAdjustQty(Math.max(0, adjustQty - 1))}
                >
                  −
                </button>
                <span className="text-3xl font-bold text-text-primary tabular-nums w-16 text-center">
                  {adjustQty}
                </span>
                <button
                  className="stepper-btn"
                  onClick={() => {
                    const item = items.find((i) => i.id === adjustingItemId);
                    if (item)
                      setAdjustQty(Math.min(item.quantity, adjustQty + 1));
                  }}
                >
                  +
                </button>
              </div>
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

        {/* Space Modal (Action Sheet Style) */}
        {showSpaceModal && (
          <div
            className="absolute inset-0 bg-black/60 flex items-end justify-center z-50"
            onClick={() => setShowSpaceModal(false)}
          >
            <div
              className="bg-bg-surface rounded-t-2xl p-6 w-full max-w-md border-t border-border animate-slide-up"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-text-primary mb-4 text-center">
                Need More Space?
              </h3>
              <div className="space-y-2">
                <button
                  onClick={() => handleRequestSpace("ground")}
                  className="w-full py-4 bg-bg-secondary text-text-primary font-medium rounded-xl border border-border"
                >
                  Ground
                </button>
                <button
                  onClick={() => handleRequestSpace("shelf")}
                  className="w-full py-4 bg-bg-secondary text-text-primary font-medium rounded-xl border border-border"
                >
                  Shelf
                </button>
                <button
                  onClick={() => setShowSpaceModal(false)}
                  className="w-full py-4 text-text-secondary font-medium mt-2"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (step === "done" && order) {
    const allDelivered = items.every((i) => i.deliveredQty === i.quantity);
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

        <p className="text-base text-text-secondary mb-12">
          Order {order.id} • Spots:{" "}
          {[order.zoneId, ...(order.additionalZoneIds || [])].join(", ")}
        </p>

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
    </div>
  );
}
