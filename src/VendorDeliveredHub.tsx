import { useEffect, useState } from "react";
import {
  deliveryHasAssignableSpot,
  type DeliveryDetails,
  type DeliveryOrder,
} from "./dispatcher/models";
import { VendorNeedMoreSpaceFlow } from "./VendorNeedMoreSpaceFlow";
import { VendorIssueModal } from "./VendorIssueModal";

type DeliverCtaPhase = "idle" | "checkmark" | "delivered";

interface VendorDeliveredHubProps {
  deliveryDetails: DeliveryDetails;
  loading: boolean;
  error: string | null;
  geofenceOutside?: boolean;
  geofenceEnforce?: boolean;
  reverting?: boolean;
  onDeliveryUpdated: (delivery: DeliveryOrder) => void;
  onDelivered: () => Promise<boolean>;
  onUndoDelivered?: () => Promise<boolean>;
  onBack: () => void;
}

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
  const [ctaPhase, setCtaPhase] = useState<DeliverCtaPhase>(() =>
    isVendorDeliveryConfirmed(deliveryDetails.delivery) ? "delivered" : "idle",
  );

  const { delivery, vendor, job, purchaseOrder, stagingLocation, items } =
    deliveryDetails;
  const hasAssignableSpot = deliveryHasAssignableSpot(delivery);
  const locationCode = stagingLocation?.code ?? "—";
  const invoiceNumber = delivery.vendorInvoiceNumber?.trim() || "—";

  useEffect(() => {
    setCtaPhase((prev) => {
      if (prev === "checkmark") return prev;
      return isVendorDeliveryConfirmed(deliveryDetails.delivery)
        ? "delivered"
        : "idle";
    });
  }, [
    deliveryDetails.delivery.vendorPhysicalDropoffConfirmed,
    deliveryDetails.delivery.vendorPhysicalDropoffConfirmedAt,
  ]);

  const isDelivered = ctaPhase === "delivered";
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

  const handleDeliverClick = async () => {
    if (deliverDisabled) return;
    setCtaPhase("checkmark");
    const ok = await onDelivered();
    if (ok) {
      setCtaPhase("delivered");
    } else {
      setCtaPhase("idle");
    }
  };

  const handleUndoClick = async () => {
    if (!onUndoDelivered || reverting || !isDelivered) return;
    await onUndoDelivered();
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

        <div className="w-full bg-bg-surface rounded-2xl border border-border overflow-hidden">
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
            className="w-full text-left"
          >
            <div className="p-3 border-b border-border flex items-center gap-3">
              <div className="size-12 shrink-0 rounded-xl bg-accent/15 text-accent font-mono text-xl font-light flex items-center justify-center">
                {locationCode}
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className="text-base font-medium text-text-primary truncate"
                  data-testid="vendor-hub-location-label"
                >
                  Location: {locationCode}
                </p>
              </div>
              <span
                className="shrink-0 text-text-secondary transition-transform duration-200"
                aria-hidden
                style={{
                  transform: itemsExpanded ? "rotate(180deg)" : "rotate(0deg)",
                }}
              >
                ▾
              </span>
            </div>

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
                { label: "Expected items", value: String(items.length), mono: false },
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
              <p className="text-xs text-accent pt-0.5">
                {itemsExpanded ? "Tap to hide items" : "Tap to view items"}
              </p>
            </div>
          </button>

          {itemsExpanded && (
            <div
              className="border-t border-border px-3 py-2.5 space-y-2 bg-bg-secondary/40"
              data-testid="vendor-hub-items-list"
            >
              {items.length === 0 ? (
                <p className="text-sm text-text-secondary">
                  No item details available.
                </p>
              ) : (
                items.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-border bg-bg-primary px-3 py-2"
                    data-testid="vendor-hub-item-row"
                  >
                    <p className="text-sm font-medium text-text-primary leading-snug">
                      {item.description}
                    </p>
                    <p className="text-xs text-text-secondary mt-1">
                      Qty {item.qtyOrdered}
                      {item.sku ? (
                        <>
                          {" · "}
                          <span className="font-mono">{item.sku}</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <p className="mt-3 text-center text-xs text-text-secondary leading-snug">
          Confirm this is the correct delivery. Inventory is verified by shop
          staff later.
        </p>
      </main>

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
        <button
          type="button"
          disabled={deliverDisabled}
          onClick={() => void handleDeliverClick()}
          aria-label={deliverLabel}
          data-testid="vendor-mark-delivered"
          className={`action-btn action-btn-delivered w-full text-base font-bold tracking-wide transition-all ${
            isDelivered ? "opacity-100 cursor-default" : "disabled:opacity-50"
          }`}
        >
          {ctaPhase === "checkmark" && (
            <span className="inline-flex items-center justify-center">
              <DeliverCheckmark />
            </span>
          )}
          {ctaPhase === "delivered" && (
            <span className="inline-flex items-center justify-center gap-2">
              <DeliverCheckmark />
              Delivered
            </span>
          )}
          {ctaPhase === "idle" &&
            (hasAssignableSpot
              ? "Mark Delivered"
              : "Ask dispatch for a staging spot.")}
        </button>
        {isDelivered && onUndoDelivered && (
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

      {showSpaceFlow && (
        <VendorNeedMoreSpaceFlow
          delivery={deliveryDetails.delivery}
          onDeliveryUpdated={onDeliveryUpdated}
          onClose={() => setShowSpaceFlow(false)}
        />
      )}

      {showIssueModal && (
        <VendorIssueModal
          deliveryDetails={deliveryDetails}
          onClose={() => setShowIssueModal(false)}
          onSubmitted={showIssueSubmitted}
        />
      )}
    </div>
  );
}
