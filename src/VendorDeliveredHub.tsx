import { useState } from "react";
import { type DeliveryDetails, type DeliveryOrder } from "./dispatcher/models";
import { VendorNeedMoreSpaceFlow } from "./VendorNeedMoreSpaceFlow";
import { VendorIssueModal } from "./VendorIssueModal";

interface VendorDeliveredHubProps {
  deliveryDetails: DeliveryDetails;
  loading: boolean;
  error: string | null;
  onDeliveryUpdated: (delivery: DeliveryOrder) => void;
  onDelivered: () => void;
  onBack: () => void;
}

export function VendorDeliveredHub({
  deliveryDetails,
  loading,
  error,
  onDeliveryUpdated,
  onDelivered,
  onBack,
}: VendorDeliveredHubProps) {
  const [showSpaceFlow, setShowSpaceFlow] = useState(false);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [issueToast, setIssueToast] = useState<string | null>(null);

  const { delivery, vendor, job, purchaseOrder, stagingLocation, items } =
    deliveryDetails;
  const locationCode = stagingLocation?.code ?? "—";
  const locationLabel =
    stagingLocation?.label ?? "Not assigned — dispatcher will stage";

  const showIssueSubmitted = () => {
    setIssueToast("Issue reported — dispatcher notified.");
    window.setTimeout(() => setIssueToast(null), 3500);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden min-h-0">
      {issueToast && (
        <div className="fixed top-4 left-4 right-4 z-40 rounded-xl border border-border bg-bg-card px-4 py-3 text-sm text-text-primary shadow-lg">
          {issueToast}
        </div>
      )}

      <div className="shrink-0 sticky top-0 z-10 grid grid-cols-2 gap-2.5 px-4 py-3 border-b border-border bg-bg-primary">
        <button
          type="button"
          onClick={() => setShowSpaceFlow(true)}
          className="rounded-xl bg-accent py-3.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity active:scale-[0.98]"
        >
          📦 Need More Space?
        </button>
        <button
          type="button"
          onClick={() => setShowIssueModal(true)}
          className="rounded-xl bg-accent-amber py-3.5 text-sm font-semibold text-bg-primary hover:opacity-90 transition-opacity active:scale-[0.98]"
        >
          ⚠️ Issue
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5 pb-4">
        <p className="text-center text-text-secondary text-sm mb-4">
          {job?.jobName ?? "Delivery"}
        </p>

        <div className="w-full bg-bg-surface rounded-2xl border border-border overflow-hidden">
          <div className="p-4 border-b border-border flex items-center gap-3.5">
            <div className="size-16 shrink-0 rounded-xl bg-accent/15 text-accent font-mono text-2xl font-light flex items-center justify-center">
              {locationCode}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-widest text-text-secondary">
                Assigned location
              </p>
              <p className="text-lg font-medium text-text-primary truncate">
                {locationLabel}
              </p>
            </div>
          </div>

          <div className="p-4 space-y-2">
            {[
              ["Job / Site", job?.jobName ?? "—"],
              ["Vendor", vendor.name],
              ["Order #", delivery.orderNumber],
              ["PO #", purchaseOrder?.poNumber ?? "—"],
              ["Expected items", String(items.length)],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="text-text-secondary shrink-0">{label}</span>
                <span className="text-text-primary font-medium text-right">
                  {label === "Order #" ? (
                    <span className="font-mono text-xs bg-bg-secondary px-2 py-0.5 rounded">
                      {value}
                    </span>
                  ) : (
                    value
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>

        <p className="mt-5 text-center text-[13px] text-text-secondary leading-relaxed">
          Confirm this is the correct delivery.
          <br />
          Inventory is verified by shop staff later.
        </p>
      </div>

      <div className="shrink-0 sticky bottom-0 z-10 px-4 pb-[calc(env(safe-area-inset-bottom,16px)+16px)] pt-3 border-t border-border bg-bg-primary space-y-2">
        {error && (
          <p className="text-xs text-accent-red text-center" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          disabled={loading}
          onClick={onDelivered}
          className="action-btn action-btn-delivered w-full text-lg font-bold tracking-wide disabled:opacity-50"
        >
          {loading ? "Confirming…" : "DELIVERED"}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="action-btn action-btn-secondary w-full"
        >
          ← Back
        </button>
      </div>

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
