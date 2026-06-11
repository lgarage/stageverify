import {
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  hasReceiveDeepLink,
  normalizeReceiveHash,
  pickupPath,
  readReceiveParams,
} from "./receiveQrUrls";
import {
  firestoreDataService,
  getDeliveryDetailsPublic,
  mapOccupancyByLocationId,
  type StagingLocationOccupant,
} from "./dispatcher/firestoreService";
import { resolveZoneScanDisposition } from "./scanRouting";
import { VendorPinGate } from "./VendorPinGate";
import { isPinSessionValid } from "./vendorPinSession";
import { useVendorPinActivity } from "./useVendorPinActivity";
import { isStagingLocationOccupiedError } from "./dispatcher/stagingOccupancy";
import { NeedMoreSpaceButton } from "./NeedMoreSpaceButton";
import {
  shouldRouteScanToPickup,
  type DeliveryDetails,
  type StagingLocation,
} from "./dispatcher/models";
import { VendorNativeQrEntry } from "./VendorNativeQrEntry";

type Step = "scan" | "pin" | "items" | "zone" | "done";

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
  const [zoneMissCode, setZoneMissCode] = useState<string | null>(null);
  const [deepLinkPending, setDeepLinkPending] = useState(hasReceiveDeepLink);
  const [adjustingItemId, setAdjustingItemId] = useState<string | null>(null);
  const [adjustQty, setAdjustQty] = useState(0);
  const [adjustDamagedQty, setAdjustDamagedQty] = useState(0);
  const [pendingDeliveryId, setPendingDeliveryId] = useState<string | null>(
    null,
  );

  const urlDeepLinkHandledRef = useRef(false);
  const activeDeliveryIdRef = useRef<string | null>(null);
  const itemQtyInitDeliveryIdRef = useRef<string | null>(null);
  const debounceTimersRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    if (!deliveryDetails) return;
    const deliveryId = deliveryDetails.delivery.id;
    if (itemQtyInitDeliveryIdRef.current === deliveryId) return;
    itemQtyInitDeliveryIdRef.current = deliveryId;
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

  useEffect(() => {
    activeDeliveryIdRef.current =
      deliveryDetails?.delivery.id ?? pendingDeliveryId;
  }, [deliveryDetails, pendingDeliveryId]);

  const handlePinSessionExpired = useCallback(() => {
    const deliveryId = activeDeliveryIdRef.current;
    setDeliveryDetails(null);
    setItemQtys([]);
    if (deliveryId) setPendingDeliveryId(deliveryId);
    setStep("pin");
  }, []);

  useVendorPinActivity(
    deliveryDetails?.delivery.id ?? pendingDeliveryId,
    handlePinSessionExpired,
  );

  const loadDeliveryForReceive = useCallback(
    async (details: DeliveryDetails): Promise<boolean> => {
      if (shouldRouteScanToPickup(details.delivery.status)) {
        window.location.hash = pickupPath(
          details.delivery.jobId,
          details.delivery.id,
        );
        return false;
      }

      let resolved = details;
      if (resolved.delivery.status === "pending") {
        resolved = {
          ...resolved,
          delivery: { ...resolved.delivery, status: "arrived" },
        };
        void firestoreDataService
          .updateDeliveryStatus(
            details.delivery.id,
            "arrived",
            undefined,
            "vendor",
            "Vendor Driver",
          )
          .then((updated) => {
            if (updated) setDeliveryDetails(updated);
          })
          .catch(() => {});
      }

      setDeliveryDetails(resolved);
      setStep("items");
      return true;
    },
    [],
  );

  const loadDeliveryAfterPin = useCallback(
    async (deliveryId: string) => {
      setLoading(true);
      setError(null);
      try {
        const details = await getDeliveryDetailsPublic(deliveryId);
        if (!details) {
          showToast("Invalid code.");
          setStep("scan");
          return;
        }
        const loaded = await loadDeliveryForReceive(details);
        if (loaded) {
          window.history.replaceState(null, "", "#/receive");
        }
      } catch {
        setError("Failed to load delivery");
        setStep("scan");
      } finally {
        setLoading(false);
        setPendingDeliveryId(null);
        setDeepLinkPending(false);
      }
    },
    [showToast, loadDeliveryForReceive],
  );

  const beginDeliveryAccess = useCallback(
    (deliveryId: string) => {
      if (isPinSessionValid(deliveryId)) {
        void loadDeliveryAfterPin(deliveryId);
        return;
      }
      setPendingDeliveryId(deliveryId);
      setStep("pin");
    },
    [loadDeliveryAfterPin],
  );

  const processDeliveryLookup = useCallback(
    async (lookupId: string, options?: { quiet?: boolean }) => {
      const trimmed = lookupId.trim();
      if (!trimmed) return;

      if (!options?.quiet) {
        setLoading(true);
      }
      setError(null);

      try {
        beginDeliveryAccess(trimmed);
      } catch {
        setError("Failed to load delivery");
      } finally {
        setLoading(false);
        setDeepLinkPending(false);
      }
    },
    [beginDeliveryAccess],
  );

  const processZoneLookup = useCallback(
    async (zoneCode: string, options?: { quiet?: boolean }) => {
      const trimmed = zoneCode.trim();
      if (!trimmed) return;

      if (!options?.quiet) {
        setLoading(true);
      }
      setError(null);

      try {
        const disposition = await resolveZoneScanDisposition(trimmed);
        if (!disposition) {
          setZoneMissCode(trimmed);
          showToast("Invalid code.");
          return;
        }
        if (disposition.kind === "pickup") {
          window.location.hash = pickupPath(
            disposition.jobId,
            disposition.deliveryId,
          );
          return;
        }
        beginDeliveryAccess(disposition.deliveryId);
      } catch {
        setError("Failed to load delivery for this zone");
      } finally {
        setLoading(false);
        setDeepLinkPending(false);
      }
    },
    [beginDeliveryAccess, showToast],
  );

  useEffect(() => {
    if (urlDeepLinkHandledRef.current) return;

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
    } catch (err) {
      if (isStagingLocationOccupiedError(err)) {
        showToast(err.message);
        void mapOccupancyByLocationId(deliveryDetails.delivery.id).then(
          setZoneOccupancy,
        );
        return;
      }
      setError("Failed to submit check-in");
    } finally {
      setLoading(false);
    }
  };

  const resetFlow = () => {
    urlDeepLinkHandledRef.current = false;
    itemQtyInitDeliveryIdRef.current = null;
    setStep("scan");
    setZoneMissCode(null);
    setPendingDeliveryId(null);
    setDeliveryDetails(null);
    setItemQtys([]);
    setStagingLocationId(null);
    setStagingLocations([]);
    setLoading(false);
    setError(null);
    setManualId("");
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

  const allItemsFullyDelivered = itemQtys.every(
    (item) =>
      item.qtyReceived + item.qtyDamaged >= item.qtyOrdered &&
      item.qtyOrdered > 0,
  );

  if (step === "pin" && pendingDeliveryId) {
    return (
      <VendorPinGate
        deliveryId={pendingDeliveryId}
        onVerified={() => {
          void loadDeliveryAfterPin(pendingDeliveryId);
        }}
        onCancel={resetFlow}
      />
    );
  }

  return (
    <div className="app-container flex flex-col h-screen h-dvh bg-bg-primary overflow-hidden">
      <div className="flex flex-1 flex-col overflow-hidden min-h-0">
        {toast && <Toast message={toast} />}

        {step === "scan" && zoneMissCode && (
          <div className="flex flex-col h-full">
            <div className="px-6 py-4 border-b border-border">
              <h1 className="text-xl font-bold">Zone {zoneMissCode}</h1>
              <p className="text-sm text-text-secondary mt-1">
                No active delivery is assigned to this staging spot.
              </p>
            </div>
            <div className="flex-1 flex items-center justify-center px-6 text-center">
              <p className="text-sm text-text-secondary">
                Ask dispatch to assign a delivery, or scan a package QR with
                your Camera app.
              </p>
            </div>
            <div className="px-6 py-4 border-t border-border">
              <button
                type="button"
                onClick={() => setZoneMissCode(null)}
                className="action-btn action-btn-secondary w-full"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {step === "scan" && !zoneMissCode && !deepLinkPending && (
          <VendorNativeQrEntry
            manualId={manualId}
            onManualIdChange={setManualId}
            onManualSubmit={() => void processDeliveryLookup(manualId)}
            manualLoading={loading}
            manualError={error}
          />
        )}

        {step === "scan" && !zoneMissCode && deepLinkPending && (
          <div className="flex flex-1 flex-col items-center justify-center px-6">
            <p className="text-sm text-text-secondary">Opening delivery…</p>
          </div>
        )}

        {step === "items" && deliveryDetails && (
          <div className="flex flex-1 flex-col overflow-hidden relative">
            <div className="flex-1 overflow-y-auto px-6 py-4 pt-6">
              <p className="text-center text-text-secondary text-sm mb-4">
                {deliveryDetails.job?.jobName ?? "Delivery"}
              </p>

              <div
                className={`w-full bg-bg-surface rounded-2xl border overflow-hidden transition-colors ${
                  allItemsFullyDelivered
                    ? "border-accent-green shadow-[0_0_0_1px_rgba(34,197,94,0.3)]"
                    : "border-border"
                }`}
              >
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
                          className="rounded-xl border border-border bg-bg-surface overflow-hidden"
                        >
                          <button
                            type="button"
                            onClick={() => toggleItemCheck(item.id)}
                            className="w-full px-3 py-3 text-left"
                            aria-label={`Toggle ${item.description}`}
                          >
                            <div className="flex items-start gap-3">
                              <span
                                className={`mt-0.5 shrink-0 ${
                                  isPartialDelivery
                                    ? "text-accent-amber"
                                    : isFullyAccounted
                                      ? "text-accent-green"
                                      : "text-text-secondary"
                                }`}
                              >
                                <Svg
                                  d={
                                    isFullyAccounted || isPartialDelivery
                                      ? icons.checkSquare
                                      : icons.square
                                  }
                                  size={22}
                                />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span
                                  className={`block text-sm font-medium ${
                                    isFullyAccounted
                                      ? "text-text-secondary line-through"
                                      : "text-text-primary"
                                  }`}
                                >
                                  {item.description}
                                </span>
                                <span
                                  className={`mt-1 block text-xs ${
                                    isFullyAccounted
                                      ? "text-text-secondary/70 line-through"
                                      : "text-text-secondary"
                                  }`}
                                >
                                  Qty {qtyOrdered}
                                  {item.sku ? ` · SKU ${item.sku}` : ""}
                                </span>
                                {(qtyReceived > 0 || qtyDamaged > 0) && (
                                  <span className="mt-1 block text-xs text-text-secondary">
                                    Delivered: {qtyReceived}
                                    {qtyDamaged > 0
                                      ? ` good · ${qtyDamaged} damaged`
                                      : ""}
                                    {" / "}
                                    {qtyOrdered}
                                  </span>
                                )}
                              </span>
                            </div>
                          </button>
                          <div className="border-t border-border px-4 py-3 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                const state = itemQtys.find(
                                  (q) => q.id === item.id,
                                );
                                if (state) openAdjust(state);
                              }}
                              className="min-h-[36px] min-w-[5.5rem] px-7 py-2 rounded-lg bg-accent text-white font-medium text-[13px] active:scale-[0.98] transition-transform"
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

            <div
              className={`shrink-0 px-6 pb-[calc(env(safe-area-inset-bottom,16px)+16px)] pt-3 border-t bg-bg-primary transition-colors space-y-3 ${
                allItemsFullyDelivered
                  ? "border-accent-green/50 bg-accent-green/5"
                  : "border-border"
              }`}
            >
              {hasPartialOrder && (
                <p className="text-center text-sm font-medium text-accent-amber">
                  Partial order — not all items fully delivered
                </p>
              )}
              {allItemsFullyDelivered && (
                <p className="text-center text-sm font-semibold text-accent-green">
                  All items delivered — tap below to assign zone
                </p>
              )}
              <button
                type="button"
                onClick={() => setStep("zone")}
                className={`action-btn action-btn-delivered w-full transition-all duration-300 ${
                  allItemsFullyDelivered
                    ? "ring-4 ring-accent-green/50 shadow-[0_0_28px_rgba(34,197,94,0.35)] scale-[1.02]"
                    : ""
                }`}
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
                      className="action-btn action-btn-secondary flex-1 text-sm"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={saveAdjust}
                      className="action-btn action-btn-delivered flex-1 text-sm"
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
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto px-6 py-4 pt-6">
              <p className="text-center text-text-secondary text-sm mb-4">
                {deliveryDetails.job?.jobName ?? "Delivery"}
              </p>
              <h1 className="text-xl font-bold text-center mb-1">
                Assign Staging Zone
              </h1>
              <p className="text-sm text-text-secondary text-center mb-6">
                Tap a zone for this delivery
              </p>
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
                              : "border-border bg-bg-surface text-text-primary"
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
                    : "border-border bg-bg-surface text-text-secondary"
                }`}
              >
                Skip (no zone)
              </button>

              {stagingLocationId && (
                <div className="mt-6">
                  <NeedMoreSpaceButton
                    delivery={{
                      ...deliveryDetails.delivery,
                      stagingLocationId:
                        stagingLocationId ??
                        deliveryDetails.delivery.stagingLocationId,
                    }}
                    onDeliveryUpdated={(updated) => {
                      setDeliveryDetails((prev) =>
                        prev ? { ...prev, delivery: updated } : prev,
                      );
                      void mapOccupancyByLocationId(updated.id).then(
                        setZoneOccupancy,
                      );
                    }}
                  />
                </div>
              )}
            </div>

            <div className="shrink-0 px-6 pb-[calc(env(safe-area-inset-bottom,16px)+16px)] pt-3 border-t border-border bg-bg-primary space-y-3">
              {error && (
                <p className="text-xs text-accent-red">{error}</p>
              )}
              <button
                type="button"
                disabled={loading}
                onClick={() => void handleSubmitCheckin()}
                className="action-btn action-btn-delivered w-full"
              >
                Submit Check-in →
              </button>
              <button
                type="button"
                onClick={() => setStep("items")}
                className="action-btn action-btn-secondary w-full"
              >
                ← Back
              </button>
            </div>
          </div>
        )}

        {step === "done" && deliveryDetails && (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <div className="size-24 rounded-full bg-accent-green/10 text-accent-green flex items-center justify-center mb-8">
              <Svg d={icons.check} size={48} />
            </div>
            <h2 className="text-3xl font-bold text-text-primary mb-4">
              Check-in Complete
            </h2>
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
              <NeedMoreSpaceButton
                delivery={deliveryDetails.delivery}
                onDeliveryUpdated={(updated) => {
                  setDeliveryDetails((prev) =>
                    prev ? { ...prev, delivery: updated } : prev,
                  );
                }}
                className="mb-2"
              />
              <button
                type="button"
                onClick={resetFlow}
                className="action-btn action-btn-delivered w-full"
              >
                Check In Another Delivery
              </button>
              <Link
                to="/dispatcher"
                className="action-btn action-btn-secondary w-full text-center block leading-[44px]"
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
