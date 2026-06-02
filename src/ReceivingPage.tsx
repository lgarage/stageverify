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
} from "./dispatcher/firestoreService";
import {
  shouldRouteScanToPickup,
  type DeliveryDetails,
  type StagingLocation,
} from "./dispatcher/models";
import type { Html5QrcodeInstance } from "./qrScannerTypes";

type Step = "scan" | "items" | "zone" | "done";

interface ItemQtyState {
  id: string;
  qtyOrdered: number;
  qtyReceived: number;
  qtyDamaged: number;
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [manualId, setManualId] = useState("");
  const [cameraFailed, setCameraFailed] = useState(false);
  const [scanMode, setScanMode] = useState<"camera" | "zone-miss">("camera");
  const [zoneMissCode, setZoneMissCode] = useState<string | null>(null);
  const [deepLinkPending, setDeepLinkPending] = useState(hasReceiveDeepLink);

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
        const updated = await firestoreDataService.updateDeliveryStatus(
          resolved.delivery.id,
          "arrived",
          undefined,
          "dispatcher",
          "Receiver",
        );
        resolved = updated ?? resolved;
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

  const updateItemReceived = (itemId: string, delta: number) => {
    if (!deliveryDetails) return;

    setItemQtys((prev) =>
      prev.map((item) => {
        if (item.id !== itemId) return item;
        const maxReceivable = item.qtyOrdered - item.qtyDamaged;
        const nextReceived = Math.max(
          0,
          Math.min(item.qtyReceived + delta, maxReceivable),
        );
        const qtyMissing = item.qtyOrdered - nextReceived - item.qtyDamaged;
        debouncedUpdateItemQty(
          item.id,
          item.qtyOrdered,
          nextReceived,
          qtyMissing,
        );
        return { ...item, qtyReceived: nextReceived };
      }),
    );
  };

  const toggleDamaged = (itemId: string) => {
    if (!deliveryDetails) return;

    setItemQtys((prev) =>
      prev.map((item) => {
        if (item.id !== itemId) return item;
        if (item.qtyReceived <= 0) return item;
        const nextReceived = item.qtyReceived - 1;
        const nextDamaged = item.qtyDamaged + 1;
        const qtyMissing = item.qtyOrdered - nextReceived - nextDamaged;
        debouncedUpdateItemQty(
          item.id,
          item.qtyOrdered,
          nextReceived,
          qtyMissing,
        );
        return {
          ...item,
          qtyReceived: nextReceived,
          qtyDamaged: nextDamaged,
        };
      }),
    );
  };

  const handleZoneSelect = (locationId: string | null) => {
    if (!deliveryDetails) return;
    setStagingLocationId(locationId);
    void firestoreDataService
      .updateStagingLocation(deliveryDetails.delivery.id, locationId)
      .then((updated) => {
        if (updated) setDeliveryDetails(updated);
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
    window.history.replaceState(null, "", "#/receive");
  };

  const selectedZone = stagingLocations.find(
    (loc) => loc.id === stagingLocationId,
  );

  const totalReceived = itemQtys.reduce(
    (sum, item) => sum + item.qtyReceived + item.qtyDamaged,
    0,
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
            <div className="px-4 py-4 border-b border-border">
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
          <div className="flex flex-col h-full">
            <div className="px-4 py-4 border-b border-border shrink-0">
              <h1 className="text-xl font-bold">Check In Items</h1>
              <div className="mt-3 space-y-1 text-sm">
                <p>
                  <span className="text-text-secondary">Vendor: </span>
                  {deliveryDetails.vendor.name}
                </p>
                <p>
                  <span className="text-text-secondary">PO#: </span>
                  {deliveryDetails.purchaseOrder?.poNumber ?? "—"}
                </p>
                <p>
                  <span className="text-text-secondary">Job: </span>
                  {deliveryDetails.job?.jobName ?? ""}
                </p>
                <p>
                  <span className="text-text-secondary">Date: </span>
                  {deliveryDetails.delivery.deliveryDate}
                </p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {deliveryDetails.items.map((item, idx) => {
                const qtyState = itemQtys.find((q) => q.id === item.id);
                const qtyReceived = qtyState?.qtyReceived ?? 0;
                const qtyDamaged = qtyState?.qtyDamaged ?? 0;
                const qtyOrdered = item.qtyOrdered;
                const statusColor =
                  qtyReceived === qtyOrdered
                    ? "border-accent-green/30 bg-accent-green/5"
                    : qtyReceived === 0
                      ? "border-accent-red/30 bg-accent-red/5"
                      : "border-accent-amber/30 bg-accent-amber/5";

                return (
                  <div
                    key={item.id}
                    className={`rounded-2xl border p-4 ${statusColor}`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{item.description}</p>
                        {item.sku && (
                          <p className="text-xs text-text-secondary font-mono mt-1">
                            SKU: {item.sku}
                          </p>
                        )}
                        <p className="text-sm text-text-secondary mt-1">
                          Ordered: {qtyOrdered}
                        </p>
                      </div>
                      {qtyReceived === qtyOrdered ? (
                        <span className="text-accent-green shrink-0">
                          <svg
                            className="size-6"
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
                        </span>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => updateItemReceived(item.id, -1)}
                        disabled={qtyReceived <= 0}
                        className="stepper-btn w-14 min-h-[44px] shrink-0"
                        aria-label={`Decrease received quantity for item ${idx + 1}`}
                      >
                        −
                      </button>
                      <div className="flex-1 text-center">
                        <span className="text-2xl font-bold tabular-nums">
                          {qtyReceived}
                        </span>
                        <span className="text-sm text-text-secondary ml-1">
                          / {qtyOrdered}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateItemReceived(item.id, 1)}
                        disabled={
                          qtyReceived >= qtyOrdered - qtyDamaged
                        }
                        className="stepper-btn w-14 min-h-[44px] shrink-0"
                        aria-label={`Increase received quantity for item ${idx + 1}`}
                      >
                        +
                      </button>
                    </div>

                    <div className="mt-3 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => toggleDamaged(item.id)}
                        disabled={qtyReceived <= 0}
                        className="min-h-[44px] px-3 rounded-lg border border-accent-red/30 bg-accent-red/10 text-xs font-medium text-accent-red disabled:opacity-40"
                      >
                        Mark damaged
                        {qtyDamaged > 0 ? ` (${qtyDamaged})` : ""}
                      </button>
                      {qtyDamaged > 0 && (
                        <span className="text-xs text-accent-red">
                          {qtyDamaged} damaged
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="px-4 py-4 border-t border-border shrink-0 space-y-3">
              <button
                type="button"
                onClick={() => setStep("zone")}
                className="w-full min-h-[44px] rounded-xl bg-accent text-bg-primary font-medium"
              >
                Next: Assign Zone →
              </button>
              <button
                type="button"
                onClick={resetFlow}
                className="w-full min-h-[44px] rounded-xl border border-border bg-bg-card text-text-primary"
              >
                ← Back
              </button>
            </div>
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
                    return (
                      <button
                        key={loc.id}
                        type="button"
                        onClick={() => handleZoneSelect(loc.id)}
                        className={`min-h-[44px] rounded-xl border px-4 py-4 text-left transition-colors ${
                          selected
                            ? "border-accent bg-accent/10 text-accent"
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
