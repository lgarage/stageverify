import { useState } from "react";
import { useParams } from "react-router-dom";
import { mockOrders } from "./mockData";
import type { Order, LineItem, ItemStatus, OrderStatus } from "./types";

const orderStatusBadge = (status: OrderStatus) => {
  const map: Record<OrderStatus, string> = {
    Pending:
      "bg-accent-amber/15 text-accent-amber border border-accent-amber/30",
    Partial:
      "bg-accent-purple/15 text-accent-purple border border-accent-purple/30",
    Complete:
      "bg-accent-green/15 text-accent-green border border-accent-green/30",
  };
  return `inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider ${map[status]}`;
};

/* ── Zone description helper ── */
const zoneDescription = (zoneId: string): string => {
  const map: Record<string, string> = {
    G1: "Ground Spot 1",
    G2: "Ground Spot 2",
    G3: "Ground Spot 3",
    "S1-A": "Shelf 1 · Bin A",
    "S1-B": "Shelf 1 · Bin B",
    "S2-A": "Shelf 2 · Bin A",
  };
  return map[zoneId] ?? zoneId;
};

/* ── Status dropdown options ── */
const statusOptions: { value: ItemStatus; label: string }[] = [
  { value: "Delivered", label: "Delivered" },
  { value: "Partial", label: "Partial" },
  { value: "Backordered", label: "Backordered" },
  { value: "Damaged", label: "Damaged" },
];

/* ── Component ── */
export function CheckInPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const order: Order | undefined = mockOrders.find((o) => o.id === orderId);

  const [step, setStep] = useState<"checkoff" | "done">("checkoff");
  const [vendorNote, setVendorNote] = useState("");
  const [items, setItems] = useState<LineItem[]>(
    () =>
      order?.items.map((it) => ({
        ...it,
        deliveredQty: it.deliveredQty ?? 0,
        missingQty: it.missingQty ?? it.quantity,
        status: it.status ?? null,
      })) ?? [],
  );

  if (!order) {
    return (
      <div className="min-h-screen bg-bg-primary flex items-center justify-center p-4">
        <div className="text-center">
          <div className="size-16 mx-auto rounded-full bg-bg-card border border-border flex items-center justify-center mb-4">
            <svg
              className="size-8 text-text-secondary"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h2 className="text-lg font-bold mb-1">Order Not Found</h2>
          <p className="text-sm text-text-secondary">
            Order ID{" "}
            <span className="font-mono text-text-primary">{orderId}</span> was
            not found.
          </p>
          <p className="text-xs text-text-secondary mt-2">
            Please scan a valid QR code or contact dispatch.
          </p>
        </div>
      </div>
    );
  }

  if (order.status === "Complete") {
    return (
      <div className="min-h-screen bg-bg-primary flex items-center justify-center p-4">
        <div className="text-center">
          <div className="size-16 mx-auto rounded-full bg-accent-green/20 flex items-center justify-center mb-4">
            <svg
              className="size-8 text-accent-green"
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
          <h2 className="text-lg font-bold mb-1">Already Confirmed</h2>
          <p className="text-sm text-text-secondary">
            Order{" "}
            <span className="font-mono text-text-primary">{order.id}</span> has
            already been marked as Complete.
          </p>
        </div>
      </div>
    );
  }

  const handleDeliveredQty = (itemId: string, value: string) => {
    const num = parseInt(value, 10);
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it;
        const clamped = isNaN(num)
          ? 0
          : Math.max(0, Math.min(num, it.quantity));
        const missingQty = it.quantity - clamped;
        let status: ItemStatus | null = it.status;
        if (
          clamped === it.quantity &&
          status !== "Backordered" &&
          status !== "Damaged"
        ) {
          status = "Delivered";
        } else if (
          clamped < it.quantity &&
          clamped > 0 &&
          status !== "Backordered" &&
          status !== "Damaged"
        ) {
          status = "Partial";
        } else if (
          clamped === 0 &&
          status !== "Backordered" &&
          status !== "Damaged"
        ) {
          status = "Partial";
        }
        return { ...it, deliveredQty: clamped, missingQty, status };
      }),
    );
  };

  const handleStatusChange = (itemId: string, status: ItemStatus) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it;
        if (status === "Delivered") {
          return { ...it, status, deliveredQty: it.quantity, missingQty: 0 };
        }
        return { ...it, status };
      }),
    );
  };

  const allDelivered = items.every(
    (it) => it.deliveredQty === it.quantity && it.status === "Delivered",
  );
  const overallStatus: OrderStatus = allDelivered ? "Complete" : "Partial";
  const canSubmit = items.every(
    (it) => it.deliveredQty >= 0 && it.status !== null,
  );

  const handleSubmit = () => {
    setStep("done");
  };

  const handleReset = () => {
    setStep("checkoff");
    setVendorNote("");
    setItems(
      order.items.map((it) => ({
        ...it,
        deliveredQty: 0,
        missingQty: it.quantity,
        status: null,
      })),
    );
  };

  return (
    <div className="min-h-screen bg-bg-primary">
      {step === "checkoff" && (
        <div className="max-w-lg mx-auto px-4 py-6 sm:py-8">
          {/* Header Card */}
          <div className="rounded-xl border border-border bg-bg-card p-5 mb-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="size-12 rounded-lg bg-accent/20 flex items-center justify-center font-black font-mono text-lg text-accent shrink-0">
                {order.zoneId}
              </div>
              <div>
                <p className="text-xs text-text-secondary uppercase tracking-wider">
                  Location
                </p>
                <p className="text-sm font-semibold">
                  {zoneDescription(order.zoneId)}
                </p>
              </div>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-text-secondary">Job/Site</span>
                <span className="font-medium text-right">{order.jobName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text-secondary">Vendor</span>
                <span className="font-medium">{order.vendor}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text-secondary">Order ID</span>
                <span className="font-mono text-xs bg-bg-secondary px-2 py-0.5 rounded border border-border">
                  {order.id}
                </span>
              </div>
            </div>
          </div>

          {/* Item Checkoff */}
          <p className="text-xs text-text-secondary uppercase tracking-wider mb-3 font-semibold">
            Item Check-Off
          </p>

          <div className="space-y-4 mb-6">
            {items.map((item, idx) => (
              <div
                key={item.id}
                className="rounded-xl border border-border bg-bg-card overflow-hidden"
              >
                {/* Item header */}
                <div className="flex items-start justify-between px-4 pt-4 pb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-mono text-text-secondary bg-bg-secondary rounded px-1.5 py-0.5">
                        {idx + 1}
                      </span>
                      <p className="text-sm font-medium truncate">
                        {item.description}
                      </p>
                    </div>
                    <p className="text-xs text-text-secondary ml-0.5">
                      Qty ordered:{" "}
                      <strong className="text-text-primary">
                        {item.quantity}
                      </strong>
                    </p>
                  </div>
                </div>

                {/* Item inputs */}
                <div className="px-4 pb-4 space-y-3">
                  {/* Delivered Qty */}
                  <div>
                    <label className="block text-[11px] uppercase tracking-wider text-text-secondary mb-1.5 font-semibold">
                      Quantity Delivered
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      min={0}
                      max={item.quantity}
                      value={item.deliveredQty}
                      onChange={(e) =>
                        handleDeliveredQty(item.id, e.target.value)
                      }
                      className="w-full rounded-lg border border-border bg-bg-secondary px-4 py-3 text-base text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
                    />
                  </div>

                  {/* Missing Qty (auto) */}
                  <div>
                    <label className="block text-[11px] uppercase tracking-wider text-text-secondary mb-1.5 font-semibold">
                      Quantity Missing
                    </label>
                    <div className="w-full rounded-lg border border-border bg-bg-secondary/60 px-4 py-3 text-base text-text-secondary font-mono">
                      {item.missingQty}
                    </div>
                  </div>

                  {/* Status */}
                  <div>
                    <label className="block text-[11px] uppercase tracking-wider text-text-secondary mb-1.5 font-semibold">
                      Status
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {statusOptions.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => handleStatusChange(item.id, opt.value)}
                          className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors text-center ${
                            item.status === opt.value
                              ? opt.value === "Delivered"
                                ? "border-accent-green bg-accent-green/15 text-accent-green"
                                : opt.value === "Partial"
                                  ? "border-accent-purple bg-accent-purple/15 text-accent-purple"
                                  : opt.value === "Backordered"
                                    ? "border-accent-amber bg-accent-amber/15 text-accent-amber"
                                    : "border-accent-red bg-accent-red/15 text-accent-red"
                              : "border-border bg-bg-secondary text-text-secondary hover:border-text-secondary/50"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Validation */}
                  {item.deliveredQty > item.quantity && (
                    <p className="text-xs text-accent-red mt-1">
                      Delivered quantity cannot exceed ordered quantity (
                      {item.quantity}).
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Vendor Note */}
          <div className="rounded-xl border border-border bg-bg-card p-4 mb-5">
            <label className="block text-sm font-semibold mb-2">
              Delivery Notes
            </label>
            <textarea
              value={vendorNote}
              onChange={(e) => setVendorNote(e.target.value)}
              placeholder="Explain any missing, backordered, or damaged items…"
              rows={3}
              className="w-full rounded-lg border border-border bg-bg-secondary px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 resize-none"
            />
          </div>

          {/* Summary */}
          <div className="rounded-xl border border-border bg-bg-card p-4 mb-6">
            <div className="flex items-center justify-between">
              <p className="text-xs text-text-secondary uppercase tracking-wider font-semibold">
                Overall Status
              </p>
              <span className={orderStatusBadge(overallStatus)}>
                {overallStatus}
              </span>
            </div>
            {overallStatus === "Partial" && (
              <p className="text-xs text-text-secondary mt-3">
                This order has items that are not fully delivered. Dispatch will
                be notified.
              </p>
            )}
          </div>

          {/* Submit Button */}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full rounded-xl bg-accent px-6 py-4 text-base font-bold text-white hover:bg-accent/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shadow-lg shadow-accent/20 active:scale-[0.98]"
          >
            {canSubmit
              ? overallStatus === "Complete"
                ? "Submit Confirmation — Complete"
                : "Submit Confirmation — Partial"
              : "Select a status for each item to continue"}
          </button>

          <p className="text-center text-[11px] text-text-secondary mt-4">
            By submitting, you confirm the items delivered and their condition.
          </p>
        </div>
      )}

      {step === "done" && (
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="max-w-sm w-full text-center">
            <div className="size-20 mx-auto rounded-full bg-accent-green/20 flex items-center justify-center mb-6">
              <svg
                className="size-10 text-accent-green"
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
            <h2 className="text-xl font-bold mb-2">
              Delivery confirmation submitted
            </h2>
            <p className="text-base mb-1">
              Status:{" "}
              <strong
                className={
                  overallStatus === "Complete"
                    ? "text-accent-green"
                    : "text-accent-purple"
                }
              >
                {overallStatus}
              </strong>
            </p>
            <p className="text-sm text-text-secondary mb-6">
              Dispatch has been notified.
            </p>
            <button
              onClick={handleReset}
              className="rounded-xl border border-border bg-bg-card px-6 py-3 text-sm font-semibold hover:bg-bg-secondary transition-colors active:scale-[0.98]"
            >
              New Check-In
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
