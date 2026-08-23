import { useState } from "react";
import {
  deliveryHasAssignableSpot,
  type DeliveryDetails,
  type DeliveryOrder,
} from "./dispatcher/models";
import { VendorNeedMoreSpaceFlow } from "./VendorNeedMoreSpaceFlow";
import { VendorIssueModal } from "./VendorIssueModal";
import { VendorItemDisplayLines } from "./VendorItemDisplayLines";
import { getVendorItemDisplay } from "./dispatcher/vendorItemDisplay";
import {
  deriveVendorItemLineStatus,
  deriveVendorOrderFulfillmentLabel,
} from "./dispatcher/vendorJobCardStatus";

type DeliverCtaPhase = "idle" | "checkmark" | "delivered";

export interface VendorDeliveredLineException {
  itemId: string;
  qtyReceived: number;
  qtyBackordered: number;
  qtyDamaged: number;
}

interface VendorDeliveredHubProps {
  deliveryDetails: DeliveryDetails;
  loading: boolean;
  /** Secondary getVendorReceiveDetails still in flight after bootstrap paint. */
  detailsHydrating?: boolean;
  /** Item count from PIN bootstrap while items[] is still empty. */
  expectedItemCount?: number;
  error: string | null;
  geofenceOutside?: boolean;
  geofenceEnforce?: boolean;
  reverting?: boolean;
  onDeliveryUpdated: (delivery: DeliveryOrder) => void;
  onDelivered: (
    lineExceptions?: VendorDeliveredLineException[],
  ) => Promise<boolean>;
  onUndoDelivered?: () => Promise<boolean>;
  onBack: () => void;
}

type ExceptionDraft = {
  qtyReceived: string;
  qtyBackordered: string;
  qtyDamaged: string;
};

function DeliverCheckmark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function isVendorDeliveryConfirmed(delivery: DeliveryOrder): boolean {
  return (
    delivery.vendorPhysicalDropoffConfirmed === true ||
    Boolean(delivery.vendorPhysicalDropoffConfirmedAt)
  );
}

export function VendorDeliveredHub({
  deliveryDetails,
  loading,
  detailsHydrating = false,
  expectedItemCount,
  error,
  geofenceOutside = false,
  geofenceEnforce = false,
  reverting = false,
  onDeliveryUpdated,
  onDelivered,
  onUndoDelivered,
  onBack,
}: VendorDeliveredHubProps) {
  const [showSpaceFlow, setShowSpaceFlow] = useState(false);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [issueToast, setIssueToast] = useState<string | null>(null);
  const [itemsExpanded, setItemsExpanded] = useState(false);
  const [exceptionMode, setExceptionMode] = useState(false);
  const [exceptionDrafts, setExceptionDrafts] = useState<
    Record<string, ExceptionDraft>
  >({});
  const [exceptionError, setExceptionError] = useState<string | null>(null);
  const [cardExpandedOverride, setCardExpandedOverride] = useState<
    boolean | null
  >(null);
  const [ctaPhase, setCtaPhase] = useState<DeliverCtaPhase>(() =>
    isVendorDeliveryConfirmed(deliveryDetails.delivery) ? "delivered" : "idle",
  );

  const { delivery, vendor, job, purchaseOrder, stagingLocation, items } =
    deliveryDetails;
  const hasAssignableSpot = deliveryHasAssignableSpot(delivery);
  const locationCode = stagingLocation?.code ?? "—";
  const invoiceNumber = delivery.vendorInvoiceNumber?.trim() || "—";

  const isDelivered =
    ctaPhase === "delivered" || isVendorDeliveryConfirmed(delivery);
  const fulfillmentLabel = deriveVendorOrderFulfillmentLabel({
    items,
    deliveryStatus: delivery.status,
    vendorPhysicalDropoffConfirmed: isVendorDeliveryConfirmed(delivery),
  });
  const orderIsPartial = fulfillmentLabel === "Partial";
  const cardExpanded = cardExpandedOverride ?? !isDelivered;
  const confirming = ctaPhase === "checkmark";
  const deliverDisabled =
    isDelivered ||
    loading ||
    confirming ||
    !hasAssignableSpot ||
    (geofenceEnforce && geofenceOutside);

  const showIssueSubmitted = () => {
    setIssueToast("Issue reported — dispatcher notified.");
    window.setTimeout(() => setIssueToast(null), 3500);
  };

  const openExceptionMode = () => {
    const drafts: Record<string, ExceptionDraft> = {};
    for (const item of items) {
      // Seed from current item truth — preserve invoice-seeded BO (D-86/G).
      const priorBO = Math.max(0, Math.floor(Number(item.qtyBackordered ?? 0)));
      const seededReceived =
        item.qtyReceived > 0
          ? item.qtyReceived
          : Math.max(0, item.qtyOrdered - priorBO);
      drafts[item.id] = {
        qtyReceived: String(seededReceived),
        qtyBackordered: String(priorBO),
        qtyDamaged: String(Math.max(0, Math.floor(Number(item.qtyDamaged ?? 0)))),
      };
    }
    setExceptionDrafts(drafts);
    setExceptionError(null);
    setExceptionMode(true);
    setItemsExpanded(true);
  };

  const buildLineExceptions = ():
    | VendorDeliveredLineException[]
    | "invalid"
    | undefined => {
    if (!exceptionMode) return undefined;
    const out: VendorDeliveredLineException[] = [];
    for (const item of items) {
      const draft = exceptionDrafts[item.id];
      if (!draft) continue;
      const qtyReceived = Number(draft.qtyReceived);
      const qtyBackordered = Number(draft.qtyBackordered);
      const qtyDamaged = Number(draft.qtyDamaged);
      if (
        !Number.isInteger(qtyReceived) ||
        !Number.isInteger(qtyBackordered) ||
        !Number.isInteger(qtyDamaged) ||
        qtyReceived < 0 ||
        qtyBackordered < 0 ||
        qtyDamaged < 0
      ) {
        return "invalid";
      }
      if (qtyReceived + qtyBackordered + qtyDamaged > item.qtyOrdered) {
        return "invalid";
      }
      // Skip lines that match complete-all truth (preserves prior BO).
      const priorBO = Math.max(0, Math.floor(Number(item.qtyBackordered ?? 0)));
      const completeReceived = Math.max(0, item.qtyOrdered - priorBO);
      const matchesCompleteAll =
        qtyReceived === completeReceived &&
        qtyBackordered === priorBO &&
        qtyDamaged === 0;
      if (matchesCompleteAll) continue;
      out.push({
        itemId: item.id,
        qtyReceived,
        qtyBackordered,
        qtyDamaged,
      });
    }
    return out;
  };

  const handleDeliverClick = async () => {
    if (deliverDisabled) return;
    setExceptionError(null);
    const exceptions = buildLineExceptions();
    if (exceptions === "invalid") {
      setExceptionError(
        "Check received / backordered / damaged quantities (must not exceed ordered).",
      );
      return;
    }
    setCtaPhase("checkmark");
    const ok = await onDelivered(
      exceptions && exceptions.length > 0 ? exceptions : undefined,
    );
    if (ok) {
      setCtaPhase("delivered");
      setCardExpandedOverride(false);
      setExceptionMode(false);
    } else {
      setCtaPhase("idle");
    }
  };

  const handleUndoClick = async () => {
    if (!onUndoDelivered || reverting || !isDelivered) return;
    const ok = await onUndoDelivered();
    if (ok) {
      setCtaPhase("idle");
      setCardExpandedOverride(true);
    }
  };

  const deliverLabel =
    ctaPhase === "delivered"
      ? "Delivered"
      : ctaPhase === "checkmark"
        ? "Confirming delivery"
        : !hasAssignableSpot
          ? "Ask dispatch for a staging spot."
          : "Mark Delivered";

  return (
    <div className="vendor-hub-layout h-full min-h-0">
      {issueToast && (
        <div className="fixed top-4 left-4 right-4 z-40 rounded-xl border border-border bg-bg-card px-4 py-3 text-sm text-text-primary shadow-lg">
          {issueToast}
        </div>
      )}

      <header className="vendor-hub-header grid grid-cols-2 gap-2 px-4 py-2.5 border-b border-border bg-bg-primary">
        <button
          type="button"
          onClick={() => setShowSpaceFlow(true)}
          className="rounded-xl bg-accent py-3 text-sm font-semibold text-white hover:opacity-90 transition-opacity active:scale-[0.98]"
        >
          📦 Need More Space?
        </button>
        <button
          type="button"
          onClick={() => setShowIssueModal(true)}
          data-testid="vendor-report-problem"
          className="rounded-xl bg-accent-amber py-3 text-sm font-semibold text-bg-primary hover:opacity-90 transition-opacity active:scale-[0.98]"
        >
          Report a Problem
        </button>
      </header>

      <main className="vendor-hub-scroll px-4 py-3">
        <p className="text-center text-text-secondary text-sm mb-3">
          {job?.jobName ?? "Delivery"}
        </p>

        <div
          className={`w-full rounded-2xl border overflow-hidden ${
            isDelivered
              ? "border-[#059669] bg-[#047857]"
              : "border-border bg-bg-surface"
          }`}
          data-testid="vendor-hub-delivery-card"
          data-delivered={isDelivered ? "true" : "false"}
        >
          <button
            type="button"
            onClick={() => setCardExpandedOverride(!cardExpanded)}
            aria-expanded={cardExpanded}
            aria-label={
              cardExpanded
                ? "Collapse delivery details"
                : "Expand delivery details"
            }
            data-testid="vendor-hub-card-toggle"
            className={`w-full min-h-16 px-3 py-2.5 flex items-center gap-3 text-left ${
              isDelivered ? "bg-[#047857]" : "bg-bg-surface"
            }`}
          >
            <div
              className={`size-11 shrink-0 rounded-xl font-mono text-lg font-semibold flex items-center justify-center ${
                isDelivered
                  ? "bg-white/15 text-white"
                  : "bg-accent/15 text-accent"
              }`}
              data-testid="vendor-hub-location-tile"
            >
              {locationCode}
            </div>
            <div className="min-w-0 flex-1">
              <p
                className={`text-base font-semibold truncate ${
                  isDelivered ? "text-white" : "text-text-primary"
                }`}
                data-testid="vendor-hub-location-label"
              >
                Location: {locationCode}
              </p>
              {isDelivered && (
                <p
                  className="mt-0.5 text-xs font-bold tracking-[0.14em] text-white"
                  data-testid="vendor-hub-delivered-label"
                >
                  {orderIsPartial ? "PARTIAL" : "DELIVERED"}
                </p>
              )}
              {isDelivered && orderIsPartial && (
                <p
                  className="mt-0.5 text-[11px] font-semibold text-white/90"
                  data-testid="vendor-hub-dropoff-label"
                >
                  Drop-off confirmed
                </p>
              )}
            </div>
            <span
              className={`shrink-0 transition-transform duration-200 ${
                isDelivered ? "text-white" : "text-text-secondary"
              }`}
              aria-hidden
              style={{
                transform: cardExpanded ? "rotate(90deg)" : "rotate(0deg)",
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            </span>
          </button>

          {cardExpanded && (
            <div
              className="border-t border-border bg-bg-surface"
              data-testid="vendor-hub-card-details"
            >
              <div className="p-3 space-y-1.5">
                {[
                  { label: "Job / Site", value: job?.jobName ?? "—", mono: false },
                  { label: "Vendor", value: vendor.name, mono: false },
                  { label: "Order #", value: delivery.orderNumber, mono: true },
                  {
                    label: "Invoice #",
                    value: invoiceNumber,
                    mono: true,
                    testId: "vendor-hub-invoice",
                  },
                  {
                    label: "PO #",
                    value: purchaseOrder?.poNumber ?? "—",
                    mono: true,
                  },
                ].map(({ label, value, mono, testId }) => (
                  <div
                    key={label}
                    className="flex items-center justify-between gap-3 text-sm min-w-0"
                  >
                    <span className="text-text-secondary shrink-0">{label}</span>
                    <span
                      className={`text-text-primary font-medium text-right min-w-0 ${
                        mono ? "truncate max-w-[55%]" : ""
                      }`}
                      {...(testId ? { "data-testid": testId } : {})}
                    >
                      {mono ? (
                        <span className="font-mono text-xs bg-bg-secondary px-2 py-0.5 rounded inline-block max-w-full truncate">
                          {value}
                        </span>
                      ) : (
                        value
                      )}
                    </span>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setItemsExpanded((prev) => !prev)}
                aria-expanded={itemsExpanded}
                aria-label={
                  itemsExpanded
                    ? "Hide expected item details"
                    : "View expected item details"
                }
                data-testid="vendor-hub-items-toggle"
                className="w-full border-t border-border px-3 py-2.5 text-left"
              >
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-text-secondary">Expected items</span>
                  <span className="font-medium text-text-primary">
                    {items.length > 0
                      ? String(items.length)
                      : expectedItemCount != null
                        ? String(expectedItemCount)
                        : detailsHydrating
                          ? "…"
                          : "0"}
                  </span>
                </div>
                <p className="text-xs text-accent pt-1">
                  {itemsExpanded ? "Tap to hide items" : "Tap to view items"}
                </p>
              </button>

              {itemsExpanded && (
                <div
                  className="border-t border-border px-3 py-2.5 space-y-2 bg-bg-secondary/40"
                  data-testid="vendor-hub-items-list"
                >
                  {items.length === 0 ? (
                    <p
                      className="text-sm text-[#cbd5e1]"
                      data-testid="vendor-hub-items-pending"
                    >
                      {detailsHydrating
                        ? "Loading item details…"
                        : "No item details available."}
                    </p>
                  ) : (
                    items.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-lg border border-border bg-bg-primary px-3 py-2"
                        data-testid="vendor-hub-item-row"
                      >
                        <VendorItemDisplayLines
                          description={item.description}
                          sku={item.sku}
                          qtyOrdered={item.qtyOrdered}
                          lineStatus={deriveVendorItemLineStatus(item)}
                        />
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <p className="mt-3 text-center text-xs text-text-secondary leading-snug">
          Mark Delivered records expected quantities as received. Report
          missing, backordered, or damaged items before confirming.
        </p>
      </main>

      {(!isDelivered || (cardExpanded && onUndoDelivered)) && (
        <footer
          className="vendor-hub-footer px-4 pt-2 border-t border-border bg-bg-primary space-y-2"
          data-testid="vendor-hub-footer"
        >
        {!hasAssignableSpot && !isDelivered && (
          <p
            className="text-xs text-accent-amber text-center rounded-lg border border-accent-amber/40 bg-accent-amber/10 px-3 py-2"
            role="status"
            data-testid="vendor-no-spot-warn"
          >
            No staging spot assigned yet. Ask dispatch for a staging spot before
            confirming delivery.
          </p>
        )}
        {geofenceOutside && !isDelivered && (
          <p
            className="text-xs text-accent-amber text-center rounded-lg border border-accent-amber/40 bg-accent-amber/10 px-3 py-2"
            role="status"
            data-testid="vendor-geofence-warn"
          >
            {geofenceEnforce
              ? "Outside shop area — move closer to confirm delivery."
              : "You appear to be outside the shop area."}
          </p>
        )}
        {error && (
          <p className="text-xs text-accent-red text-center" role="alert">
            {error}
          </p>
        )}
        {!isDelivered && exceptionMode && items.length > 0 && (
          <div
            className="rounded-xl border border-border bg-bg-secondary/50 px-3 py-2.5 space-y-3"
            data-testid="vendor-exception-panel"
          >
            <p className="text-xs text-text-secondary leading-snug">
              Enter what arrived. Remaining quantity is missing unless you mark
              it backordered or damaged.
            </p>
            {items.map((item) => {
              const priorBO = Math.max(
                0,
                Math.floor(Number(item.qtyBackordered ?? 0)),
              );
              const draft = exceptionDrafts[item.id] ?? {
                qtyReceived: String(Math.max(0, item.qtyOrdered - priorBO)),
                qtyBackordered: String(priorBO),
                qtyDamaged: String(
                  Math.max(0, Math.floor(Number(item.qtyDamaged ?? 0))),
                ),
              };
              const display = getVendorItemDisplay({
                description: item.description,
                sku: item.sku,
                qtyOrdered: item.qtyOrdered,
              });
              return (
                <div
                  key={item.id}
                  className="space-y-1.5 border-t border-border pt-2 first:border-t-0 first:pt-0"
                  data-testid="vendor-exception-item"
                >
                  <p className="text-sm font-medium text-text-primary leading-snug">
                    <span data-testid="vendor-item-title">{display.title}</span>
                    <span className="ml-2 text-xs text-text-secondary">
                      Ordered {item.qtyOrdered}
                    </span>
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        ["qtyReceived", "Received"],
                        ["qtyBackordered", "Backordered"],
                        ["qtyDamaged", "Damaged"],
                      ] as const
                    ).map(([field, label]) => (
                      <label
                        key={field}
                        className="block text-[11px] text-text-secondary"
                      >
                        {label}
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={item.qtyOrdered}
                          value={draft[field]}
                          data-testid={`vendor-exception-${field}-${item.id}`}
                          onChange={(e) =>
                            setExceptionDrafts((prev) => ({
                              ...prev,
                              [item.id]: {
                                ...draft,
                                [field]: e.target.value,
                              },
                            }))
                          }
                          className="mt-0.5 w-full rounded-lg border border-border bg-white px-2 py-1.5 text-sm text-[#333]"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setExceptionMode(false);
                setExceptionError(null);
              }}
              className="text-xs text-accent underline"
              data-testid="vendor-exception-cancel"
            >
              Cancel exceptions — everything arrived
            </button>
          </div>
        )}
        {(exceptionError || (error && exceptionMode)) && (
          <p
            className="text-xs text-accent-red text-center"
            role="alert"
            data-testid="vendor-exception-error"
          >
            {exceptionError ?? error}
          </p>
        )}
        {!isDelivered && !exceptionMode && items.length > 0 && (
          <button
            type="button"
            onClick={openExceptionMode}
            disabled={deliverDisabled}
            data-testid="vendor-report-exceptions"
            className="action-btn action-btn-secondary w-full text-sm"
          >
            Something missing or backordered?
          </button>
        )}
        {!isDelivered && (
          <button
            type="button"
            disabled={deliverDisabled}
            onClick={() => void handleDeliverClick()}
            aria-label={deliverLabel}
            data-testid="vendor-mark-delivered"
            className="action-btn action-btn-delivered w-full text-base font-bold tracking-wide transition-all disabled:opacity-50"
          >
            {ctaPhase === "checkmark" ? (
              <span className="inline-flex items-center justify-center">
                <DeliverCheckmark />
              </span>
            ) : hasAssignableSpot ? (
              exceptionMode ? "Confirm with exceptions" : "Mark Delivered"
            ) : (
              "Ask dispatch for a staging spot."
            )}
          </button>
        )}
        {isDelivered && cardExpanded && onUndoDelivered && (
          <button
            type="button"
            disabled={reverting}
            onClick={() => void handleUndoClick()}
            data-testid="vendor-undo-delivery"
            className="action-btn action-btn-secondary w-full"
          >
            {reverting ? "Reverting…" : "Undo Delivery"}
          </button>
        )}
        {!isDelivered && (
          <button
            type="button"
            onClick={onBack}
            className="action-btn action-btn-secondary w-full"
          >
            ← Back
          </button>
        )}
        </footer>
      )}

      {showSpaceFlow && (
        <VendorNeedMoreSpaceFlow
          delivery={deliveryDetails.delivery}
          onDeliveryUpdated={onDeliveryUpdated}
          onClose={() => setShowSpaceFlow(false)}
        />
      )}

      {showIssueModal && (
        <VendorIssueModal
          target={{
            deliveryId: delivery.id,
            jobId: delivery.jobId ?? "",
            orderNumber: delivery.orderNumber,
            vendorName: vendor.name,
          }}
          onClose={() => setShowIssueModal(false)}
          onSubmitted={showIssueSubmitted}
        />
      )}
    </div>
  );
}
