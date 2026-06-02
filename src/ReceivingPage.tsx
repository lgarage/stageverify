import {
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  hasReceiveDeepLink,
  normalizeReceiveHash,
  parseScannedQr,
  pickupPath,
  readReceiveParams,
} from "./receiveQrUrls";
import {
  resolveSyncScanIntent,
  syncScanIntent,
} from "./scanRouting";
import {
  firestoreDataService,
  getDeliveryDetailsByStagingCode,
  getDeliveryDetailsPublic,
  mapOccupancyByLocationId,
  type StagingLocationOccupant,
} from "./dispatcher/firestoreService";
import { isStagingLocationOccupiedError } from "./dispatcher/stagingOccupancy";
import {
  shouldRouteScanToPickup,
  type DeliveryDetails,
  type StagingLocation,
} from "./dispatcher/models";
import type { Html5QrcodeInstance } from "./qrScannerTypes";
import { PortalNavBar } from "./PortalNavBar";

type Step = "scan" | "items" | "zone" | "done";

interface ItemQtyState {
  id: string;
  qtyOrdered: number;
  qtyReceived: number;
  qtyDamaged: number;
}

const icons = {
  check: "M5 13l4 4L19 7",
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

function Toast({ message }: { message: string }) {
  return (
    <div className="fixed top-4 left-4 right-4 z-50 rounded-xl border border-border bg-bg-card px-4 py-3 text-sm text-text-primary shadow-lg">
      {message}
    </div>
  );
}

export function ReceivingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  normalizeReceiveHash();

  const [step, setStep] = useState<Step>("scan");
  const [deliveryDetails, setDeliveryDetails] =
    useState<DeliveryDetails | null>(null);
  const [itemQtys, setItemQtys] = useState<ItemQtyState[]>([]);
  const [stagingLocationId, setStagingLocationId] = useState<string | null>(
    null,
  );
  const [stagingLocations, setStagingLocations] = useState<StagingLocation[]>(
    [],
  );
  const [zoneOccupancy, setZoneOccupancy] = useState<
    Record<string, StagingLocationOccupant>
  >({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [manualId, setManualId] = useState("");
  const [cameraFailed, setCameraFailed] = useState(false);
  const [scanMode, setScanMode] = useState<"camera" | "zone-miss">("camera");
  const [zoneMissCode, setZoneMissCode] = useState<string | null>(null);
  const [deepLinkPending, setDeepLinkPending] = useState(hasReceiveDeepLink);
  const [adjustingItemId, setAdjustingItemId] = useState<string | null>(null);
  const [adjustQty, setAdjustQty] = useState(0);
  const [adjustDamagedQty, setAdjustDamagedQty] = useState(0);

  const scannerRef = useRef<Html5QrcodeInstance | null>(null);
  const urlDeepLinkHandledRef = useRef(false);
  const debounceTimersRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    if (!deliveryDetails) return;
    setItemQtys(
      deliveryDetails.items.map((item) => ({
        id: item.id,
        qtyOrdered: item.qtyOrdered,
        qtyReceived: item.qtyReceived,
        qtyDamaged: item.qtyDamaged,
      })),
    );
    setStagingLocationId(deliveryDetails.delivery.stagingLocationId ?? null);
  }, [deliveryDetails]);

  useEffect(() => {
    if (step !== "zone") return;
    setLoading(true);
    void firestoreDataService
      .listStagingLocations()
      .then((locations) => {
        setStagingLocations(locations);
      })
      .catch(() => {
        setError("Failed to load staging zones");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [step]);

  useEffect(() => {
    if (step !== "zone" || !deliveryDetails) return;
    void mapOccupancyByLocationId(deliveryDetails.delivery.id).then(
      setZoneOccupancy,
    );
  }, [step, deliveryDetails]);

  const debouncedUpdateItemQty = useCallback(
    (
      itemId: string,
      qtyOrdered: number,
      qtyReceived: number,
      qtyMissing: number,
    ) => {
      if (!deliveryDetails) return;
      const timers = debounceTimersRef.current;
      const existing = timers.get(itemId);
      if (existing) clearTimeout(existing);
      timers.set(
        itemId,
        setTimeout(() => {
          void firestoreDataService.updateItemQty(
            deliveryDetails.delivery.id,
            itemId,
            qtyOrdered,
            qtyReceived,
            qtyMissing,
          );
          timers.delete(itemId);
        }, 500),
      );
    },
    [deliveryDetails],
  );

  const loadDeliveryForReceive = useCallback(
    async (details: DeliveryDetails): Promise<boolean> => {
      // Safety net for ?id= deep links and delivery-ID scans (zone path redirects earlier).
      if (shouldRouteScanToPickup(details.delivery.status)) {
        navigate(
          pickupPath(details.delivery.jobId, details.delivery.id),
          { replace: true },
        );
        return false;
      }

      let resolved = details;
      if (resolved.delivery.status === "pending") {
        try {
          const updated = await firestoreDataService.updateDeliveryStatus(
            resolved.delivery.id,
            "arrived",
            undefined,
            "vendor",
            "Vendor Driver",
          );
          if (updated) resolved = updated;
          else {
            resolved = {
              ...resolved,
              delivery: { ...resolved.delivery, status: "arrived" },
            };
          }
        } catch {
          resolved = {
            ...resolved,
            delivery: { ...resolved.delivery, status: "arrived" },
          };
        }
      }

      setDeliveryDetails(resolved);
      setStep("items");
      return true;
    },
    [navigate],
  );

  const processDeliveryLookup = useCallback(
    async (lookupId: string) => {
      const trimmed = lookupId.trim();
      if (!trimmed) return;

      setLoading(true);
      setError(null);

      try {
        const details = await getDeliveryDetailsPublic(trimmed);

        if (!details) {
          showToast("Delivery not found");
          return;
        }

        await loadDeliveryForReceive(details);
      } catch {
        setError("Failed to load delivery");
      } finally {
        setLoading(false);
        setDeepLinkPending(false);
      }
    },
    [showToast, loadDeliveryForReceive],
  );

  const processZoneLookup = useCallback(
    async (zoneCode: string) => {
      const trimmed = zoneCode.trim();
      if (!trimmed) return;

      setLoading(true);
      setError(null);

      try {
        const details = await getDeliveryDetailsByStagingCode(trimmed);

        if (!details) {
          setZoneMissCode(trimmed);
          setScanMode("zone-miss");
          showToast(`No active delivery at zone ${trimmed}`);
          return;
        }

        const loaded = await loadDeliveryForReceive(details);
        if (loaded) {
          window.history.replaceState(null, "", "#/receive");
        }
      } catch {
        setError("Failed to load delivery for this zone");
      } finally {
        setLoading(false);
        setDeepLinkPending(false);
      }
    },
    [showToast, loadDeliveryForReceive, navigate],
  );

  useEffect(() => {
    if (urlDeepLinkHandledRef.current) return;
    const parsed = parseScannedQr(window.location.href);
    if (parsed.kind === "pickup" && parsed.jobId) {
      urlDeepLinkHandledRef.current = true;
      navigate(
        pickupPath(parsed.jobId, parsed.deliveryId),
        { replace: true },
      );
      return;
    }

    const { id, zone } = readReceiveParams(searchParams);
    if (!id && !zone) return;
    urlDeepLinkHandledRef.current = true;

    if (id) {
      void processDeliveryLookup(id).then(() => {
        window.history.replaceState(null, "", "#/receive");
      });
      return;
    }
    if (zone) {
      void processZoneLookup(zone);
    }
  }, [searchParams, processDeliveryLookup, processZoneLookup]);

  useEffect(() => {
    if (step !== "scan" || scanMode !== "camera" || deepLinkPending) return;

    let isMounted = true;
    let handledDecode = false;

    import("html5-qrcode").then(({ Html5Qrcode }) => {
      if (!isMounted) return;

      const scanner = new Html5Qrcode(
        "receive-qr-reader",
      ) as unknown as Html5QrcodeInstance;
      scannerRef.current = scanner;

      void scanner
        .start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText: string) => {
            if (handledDecode || !isMounted) return;
            handledDecode = true;
            const parsed = parseScannedQr(decodedText);
            const intent = syncScanIntent(parsed);
            void scanner.stop().then(() => {
              scanner.clear();
              scannerRef.current = null;
              if (!isMounted) return;
              void (async () => {
                const result = await resolveSyncScanIntent(
                  intent,
                  "receive-page",
                );
                if (!isMounted) return;
                if (result.action === "navigate") {
                  navigate(result.path);
                  return;
                }
                if (result.action === "load-receive") {
                  void processDeliveryLookup(result.deliveryId);
                  return;
                }
                if (intent.kind === "resolve-zone") {
                  setZoneMissCode(intent.zoneCode);
                  setScanMode("zone-miss");
                  showToast(`No active delivery at zone ${intent.zoneCode}`);
                  return;
                }
                showToast(
                  intent.kind === "resolve-delivery"
                    ? "Delivery not found"
                    : "Unrecognized QR code",
                );
              })();
            });
          },
          () => {
            // ignore scan noise
          },
        )
        .catch(() => {
          if (isMounted) setCameraFailed(true);
        });
    });

    return () => {
      isMounted = false;
      const scanner = scannerRef.current;
      if (scanner) {
        void scanner
          .stop()
          .then(() => scanner.clear())
          .catch(() => {});
        scannerRef.current = null;
      }
    };
  }, [
    step,
    scanMode,
    deepLinkPending,
    processDeliveryLookup,
    processZoneLookup,
    navigate,
    showToast,
  ]);

  const applyItemQty = useCallback(
    (itemId: string, qtyReceived: number, qtyDamaged: number) => {
      if (!deliveryDetails) return;

      setItemQtys((prev) =>
        prev.map((item) => {
          if (item.id !== itemId) return item;
          const clampedDamaged = Math.min(
            Math.max(0, qtyDamaged),
            item.qtyOrdered,
          );
          const clampedReceived = Math.min(
            Math.max(0, qtyReceived),
            item.qtyOrdered - clampedDamaged,
          );
          const qtyMissing =
            item.qtyOrdered - clampedReceived - clampedDamaged;
          debouncedUpdateItemQty(
            item.id,
            item.qtyOrdered,
            clampedReceived,
            qtyMissing,
          );
          return {
            ...item,
            qtyReceived: clampedReceived,
            qtyDamaged: clampedDamaged,
          };
        }),
      );
    },
    [deliveryDetails, debouncedUpdateItemQty],
  );

  const toggleItemCheck = (itemId: string) => {
    const item = itemQtys.find((i) => i.id === itemId);
    if (!item) return;
    const isAccounted =
      item.qtyReceived + item.qtyDamaged >= item.qtyOrdered &&
      item.qtyOrdered > 0;
    if (isAccounted) {
      applyItemQty(itemId, 0, 0);
    } else {
      applyItemQty(itemId, item.qtyOrdered, 0);
    }
  };

  const openAdjust = (item: ItemQtyState) => {
    setAdjustingItemId(item.id);
    setAdjustQty(item.qtyReceived);
    setAdjustDamagedQty(item.qtyDamaged);
  };

  const saveAdjust = () => {
    if (!adjustingItemId) return;
    applyItemQty(adjustingItemId, adjustQty, adjustDamagedQty);
    setAdjustingItemId(null);
  };

  const handleZoneSelect = (locationId: string | null) => {
    if (!deliveryDetails) return;
    setError(null);
    setStagingLocationId(locationId);
    void firestoreDataService
      .updateStagingLocation(deliveryDetails.delivery.id, locationId)
      .then((updated) => {
        if (updated) setDeliveryDetails(updated);
        void mapOccupancyByLocationId(deliveryDetails.delivery.id).then(
          setZoneOccupancy,
        );
      })
      .catch((err: unknown) => {
        if (isStagingLocationOccupiedError(err)) {
          showToast(err.message);
          setStagingLocationId(
            deliveryDetails.delivery.stagingLocationId ?? null,
          );
          return;
        }
        setError("Failed to assign staging zone");
      });
  };

  const handleSubmitCheckin = async () => {
    if (!deliveryDetails) return;
    setLoading(true);
    setError(null);

    try {
      const itemUpdates = itemQtys.map((item) => ({
        id: item.id,
        qtyReceived: item.qtyReceived,
        qtyMissing: item.qtyOrdered - item.qtyReceived - item.qtyDamaged,
        qtyDamaged: item.qtyDamaged,
      }));

      const updated = await firestoreDataService.submitCheckin(
        deliveryDetails.delivery.id,
        "Receiver",
        itemUpdates,
      );
      if (updated) setDeliveryDetails(updated);
      setStep("done");
    } catch {
      setError("Failed to submit check-in");
    } finally {
      setLoading(false);
    }
  };

  const resetFlow = () => {
    setStep("scan");
    setScanMode("camera");
    setZoneMissCode(null);
    setDeliveryDetails(null);
    setItemQtys([]);
    setStagingLocationId(null);
    setStagingLocations([]);
    setLoading(false);
    setError(null);
    setManualId("");
    setCameraFailed(false);
    setDeepLinkPending(false);
    setAdjustingItemId(null);
    window.history.replaceState(null, "", "#/receive");
  };

  const selectedZone = stagingLocations.find(
    (loc) => loc.id === stagingLocationId,
  );

  const totalReceived = itemQtys.reduce(
    (sum, item) => sum + item.qtyReceived + item.qtyDamaged,
    0,
  );

  const hasPartialOrder = itemQtys.some(
    (item) => item.qtyReceived + item.qtyDamaged < item.qtyOrdered,
  );

  return (
    <div
      className="app-container bg-bg-primary text-text-primary"
      style={{ height: "100dvh" }}
    >
      <div className="flex flex-col h-full pb-[env(safe-area-inset-bottom)]">
        {toast && <Toast message={toast} />}

        {step === "scan" && scanMode === "zone-miss" && (
          <div className="flex flex-col h-full">
            <div className="px-4 py-4 border-b border-border">
              <h1 className="text-xl font-bold">Zone {zoneMissCode}</h1>
              <p className="text-sm text-text-secondary mt-1">
                No active delivery is assigned to this staging spot.
              </p>
            </div>
            <div className="flex-1 flex items-center justify-center px-6 text-center">
              <p className="text-sm text-text-secondary">
                Assign a delivery to this zone in the dispatcher, or scan a
                package label instead.
              </p>
            </div>
            <div className="px-4 py-4 border-t border-border">
              <button
                type="button"
                onClick={() => {
                  setScanMode("camera");
                  setZoneMissCode(null);
                }}
                className="w-full min-h-[44px] rounded-xl bg-accent text-bg-primary font-medium"
              >
                Scan another tag
              </button>
            </div>
          </div>
        )}

        {step === "scan" && scanMode === "camera" && !deepLinkPending && (
          <div className="flex flex-col h-full">
            <div className="px-4 py-3 border-b border-border shrink-0">
              <PortalNavBar active="receive" />
            </div>
            <div className="px-4 py-3 border-b border-border">
              <h1 className="text-xl font-bold">Receive Delivery</h1>
              <p className="text-sm text-text-secondary mt-1">
                Scan the QR tag on the package
              </p>
            </div>

            <div className="relative flex-1 min-h-0 bg-black">
              <div id="receive-qr-reader" className="w-full h-full" />
              {!cameraFailed && !loading && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="size-[250px] border-2 border-accent/80 rounded-lg" />
                </div>
              )}
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                  <p className="text-sm text-white">Loading delivery…</p>
                </div>
              )}
              {cameraFailed && (
                <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
                  <p className="text-sm text-text-secondary">
                    Camera unavailable — enter delivery ID below
                  </p>
                </div>
              )}
            </div>

            {deliveryDetails && (
              <div className="px-4 py-3 border-t border-border bg-bg-card">
                <p className="text-sm font-medium">{deliveryDetails.vendor.name}</p>
                <p className="text-xs text-text-secondary">
                  {deliveryDetails.delivery.orderNumber} ·{" "}
                  {deliveryDetails.job?.jobName ?? ""}
                </p>
              </div>
            )}

            <div className="px-4 py-4 border-t border-border bg-bg-primary">
              <p className="text-xs text-text-secondary mb-2 uppercase tracking-widest">
                OR enter delivery ID manually
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  maxLength={64}
                  value={manualId}
                  onChange={(e) => setManualId(e.target.value)}
                  placeholder="Delivery ID"
                  className="flex-1 min-h-[44px] rounded-xl border border-border bg-bg-surface px-4 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent"
                />
                <button
                  type="button"
                  disabled={loading || !manualId.trim()}
                  onClick={() => void processDeliveryLookup(manualId)}
                  className="min-h-[44px] px-5 rounded-xl bg-accent text-bg-primary font-medium disabled:opacity-50"
                >
                  Go
                </button>
              </div>
              {error && (
                <p className="text-xs text-accent-red mt-2">{error}</p>
              )}
            </div>
          </div>
        )}

        {step === "scan" && scanMode === "camera" && deepLinkPending && (
          <div className="flex flex-col h-full items-center justify-center px-6">
            <p className="text-sm text-text-secondary">Opening delivery…</p>
          </div>
        )}

        {step === "items" && deliveryDetails && (
          <div className="flex flex-col h-full relative">
            <div className="shrink-0 px-6 pt-4 pb-2">
              <PortalNavBar active="receive" />
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <p className="text-center text-text-secondary text-sm mb-6">
                {deliveryDetails.job?.jobName ?? "Delivery"}
              </p>

              <div className="w-full bg-bg-surface rounded-2xl border border-border overflow-hidden">
                <div className="p-4 border-b border-border">
                  <p className="font-bold text-text-primary mb-1">
                    {deliveryDetails.vendor.name}
                  </p>
                  <p className="text-text-secondary text-sm">
                    {deliveryDetails.items.length === 1
                      ? "1 item"
                      : `${deliveryDetails.items.length} items`}
                  </p>
                </div>

                <div className="border-t border-border bg-bg-secondary/40 px-4 py-4">
                  <div className="space-y-2 mb-4">
                    {[
                      ["Order #", deliveryDetails.delivery.orderNumber],
                      ["Vendor", deliveryDetails.vendor.name],
                      ["PO #", deliveryDetails.purchaseOrder?.poNumber ?? "—"],
                      ["Date", deliveryDetails.delivery.deliveryDate],
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

                  <p className="mb-3 text-xs text-text-secondary">
                    Check off items as delivered — tap Adjust for partial qty
                  </p>

                  <div className="space-y-2">
                    {deliveryDetails.items.map((item) => {
                      const qtyState = itemQtys.find((q) => q.id === item.id);
                      const qtyReceived = qtyState?.qtyReceived ?? 0;
                      const qtyDamaged = qtyState?.qtyDamaged ?? 0;
                      const qtyOrdered = item.qtyOrdered;
                      const qtyAccounted = qtyReceived + qtyDamaged;
                      const isFullyAccounted =
                        qtyAccounted >= qtyOrdered && qtyOrdered > 0;
                      const isPartialDelivery =
                        qtyAccounted > 0 && qtyAccounted < qtyOrdered;

                      return (
                        <div
                          key={item.id}
                          className="rounded-xl border border-border bg-bg-surface px-3 py-3"
                        >
                          <div className="flex items-start gap-3">
                            <button
                              type="button"
                              onClick={() => toggleItemCheck(item.id)}
                              className={`mt-0.5 shrink-0 ${
                                isPartialDelivery
                                  ? "text-accent-amber"
                                  : isFullyAccounted
                                    ? "text-accent-green"
                                    : "text-text-secondary"
                              }`}
                              aria-label={`Toggle ${item.description}`}
                            >
                              <Svg
                                d={
                                  isFullyAccounted || isPartialDelivery
                                    ? icons.checkSquare
                                    : icons.square
                                }
                                size={22}
                              />
                            </button>
                            <div className="min-w-0 flex-1">
                              <p
                                className={`text-sm font-medium ${
                                  isFullyAccounted
                                    ? "text-text-secondary line-through"
                                    : "text-text-primary"
                                }`}
                              >
                                {item.description}
                              </p>
                              <p
                                className={`mt-1 text-xs ${
                                  isFullyAccounted
                                    ? "text-text-secondary/70 line-through"
                                    : "text-text-secondary"
                                }`}
                              >
                                Qty {qtyOrdered}
                                {item.sku ? ` · SKU ${item.sku}` : ""}
                              </p>
                              {(qtyReceived > 0 || qtyDamaged > 0) && (
                                <p className="mt-1 text-xs text-text-secondary">
                                  Delivered: {qtyReceived}
                                  {qtyDamaged > 0
                                    ? ` good · ${qtyDamaged} damaged`
                                    : ""}
                                  {" / "}
                                  {qtyOrdered}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="mt-2 pl-[34px] flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                const state = itemQtys.find(
                                  (q) => q.id === item.id,
                                );
                                if (state) openAdjust(state);
                              }}
                              className="bg-accent text-white font-medium py-1.5 px-5 rounded-full active:scale-[0.98] transition-transform text-[13px]"
                            >
                              Adjust
                            </button>
                            {isPartialDelivery && (
                              <span className="text-[12px] font-bold text-accent-red bg-accent-red/10 px-2 py-0.5 rounded">
                                Partial Delivery
                              </span>
                            )}
                            {qtyDamaged > 0 && (
                              <span className="text-[12px] text-accent-red">
                                {qtyDamaged} damaged
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-border shrink-0 space-y-3 pb-[calc(env(safe-area-inset-bottom,16px)+16px)]">
              {hasPartialOrder && (
                <p className="text-center text-sm font-medium text-accent-amber">
                  Partial order — not all items fully delivered
                </p>
              )}
              <button
                type="button"
                onClick={() => setStep("zone")}
                className="action-btn action-btn-primary w-full"
              >
                Next: Assign Zone →
              </button>
              <button
                type="button"
                onClick={resetFlow}
                className="action-btn action-btn-secondary w-full"
              >
                ← Back
              </button>
            </div>

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
                      type="button"
                      className="stepper-btn"
                      onClick={() => {
                        const next = Math.max(0, adjustQty - 1);
                        setAdjustQty(next);
                        const item = itemQtys.find(
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
                      type="button"
                      className="stepper-btn"
                      onClick={() => {
                        const item = itemQtys.find(
                          (i) => i.id === adjustingItemId,
                        );
                        if (item) {
                          const next = Math.min(
                            item.qtyOrdered - adjustDamagedQty,
                            adjustQty + 1,
                          );
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
                    const item = itemQtys.find(
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
                      type="button"
                      onClick={() => setAdjustingItemId(null)}
                      className="flex-1 py-3 text-text-secondary font-medium text-sm bg-bg-secondary rounded-lg"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={saveAdjust}
                      className="flex-1 py-3 bg-accent text-white font-medium text-sm rounded-lg"
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {step === "zone" && deliveryDetails && (
          <div className="flex flex-col h-full">
            <div className="px-4 py-4 border-b border-border shrink-0">
              <h1 className="text-xl font-bold">Assign Staging Zone</h1>
              <p className="text-sm text-text-secondary mt-1">
                Tap a zone for this delivery
              </p>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4">
              {loading && stagingLocations.length === 0 ? (
                <p className="text-sm text-text-secondary">Loading zones…</p>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {stagingLocations.map((loc) => {
                    const selected = stagingLocationId === loc.id;
                    const occupant = zoneOccupancy[loc.id];
                    const isOccupied = Boolean(occupant);
                    return (
                      <button
                        key={loc.id}
                        type="button"
                        disabled={isOccupied}
                        onClick={() => handleZoneSelect(loc.id)}
                        className={`min-h-[44px] rounded-xl border px-4 py-4 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                          selected
                            ? "border-accent bg-accent/10 text-accent"
                            : isOccupied
                              ? "border-accent-red/40 bg-accent-red/5 text-text-secondary"
                              : "border-border bg-bg-card text-text-primary"
                        }`}
                      >
                        <span className="text-2xl font-bold font-mono">
                          {loc.code}
                        </span>
                        {loc.label && (
                          <span className="block text-xs text-text-secondary mt-1">
                            {loc.label}
                          </span>
                        )}
                        {isOccupied && (
                          <span className="block text-xs text-accent-red mt-1">
                            In use — {occupant.orderNumber}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              <button
                type="button"
                onClick={() => handleZoneSelect(null)}
                className={`mt-4 w-full min-h-[44px] rounded-xl border px-4 py-3 text-sm font-medium ${
                  stagingLocationId === null
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border bg-bg-card text-text-secondary"
                }`}
              >
                Skip (no zone)
              </button>
            </div>

            <div className="px-4 py-4 border-t border-border shrink-0 space-y-3">
              {error && (
                <p className="text-xs text-accent-red">{error}</p>
              )}
              <button
                type="button"
                disabled={loading}
                onClick={() => void handleSubmitCheckin()}
                className="w-full min-h-[44px] rounded-xl bg-accent-green text-bg-primary font-medium disabled:opacity-50"
              >
                Submit Check-in →
              </button>
              <button
                type="button"
                onClick={() => setStep("items")}
                className="w-full min-h-[44px] rounded-xl border border-border bg-bg-card text-text-primary"
              >
                ← Back
              </button>
            </div>
          </div>
        )}

        {step === "done" && deliveryDetails && (
          <div className="flex flex-col h-full items-center justify-center px-6 text-center">
            <div className="size-24 rounded-full bg-accent-green/10 text-accent-green flex items-center justify-center mb-6">
              <svg
                className="size-12"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-bold mb-4">Check-in Complete</h2>
            {deliveryDetails.delivery.status === "partial" && (
              <p className="text-sm font-medium text-accent-amber mb-4">
                Recorded as partial order
              </p>
            )}
            <div className="space-y-2 text-sm text-text-secondary mb-8">
              <p>
                <span className="text-text-primary font-medium">
                  {deliveryDetails.vendor.name}
                </span>
              </p>
              <p>Job: {deliveryDetails.job?.jobName ?? ""}</p>
              <p>
                {totalReceived} item
                {totalReceived === 1 ? "" : "s"} received
              </p>
              <p>
                Zone:{" "}
                {selectedZone?.code ??
                  deliveryDetails.stagingLocation?.code ??
                  "None"}
              </p>
            </div>
            <div className="w-full max-w-sm space-y-3">
              <button
                type="button"
                onClick={resetFlow}
                className="w-full min-h-[44px] rounded-xl bg-accent text-bg-primary font-medium"
              >
                Scan Another Delivery
              </button>
              <Link
                to="/dispatcher"
                className="block w-full min-h-[44px] rounded-xl border border-border bg-bg-card py-3 leading-[44px] text-text-primary font-medium"
              >
                View in Dispatcher
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
