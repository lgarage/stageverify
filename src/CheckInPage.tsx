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
  return `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold uppercase tracking-wider ${map[status]}`;
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

/* ── Status pill component ── */
const StatusPill = ({
  status,
  onSelect,
  selected,
}: {
  status: ItemStatus | null;
  onSelect: (s: ItemStatus) => void;
  selected: ItemStatus | null;
}) => {
  const options: {
    value: ItemStatus;
    label: string;
    color: string;
    dotColor: string;
  }[] = [
    {
      value: "Delivered",
      label: "Delivered",
      color: "border-accent-green bg-accent-green/15 text-accent-green",
      dotColor: "bg-accent-green",
    },
    {
      value: "Partial",
      label: "Partial",
      color: "border-accent-purple bg-accent-purple/15 text-accent-purple",
      dotColor: "bg-accent-purple",
    },
    {
      value: "Backordered",
      label: "Backordered",
      color: "border-accent-amber bg-accent-amber/15 text-accent-amber",
      dotColor: "bg-accent-amber",
    },
    {
      value: "Damaged",
      label: "Damaged",
      color: "border-accent-red bg-accent-red/15 text-accent-red",
      dotColor: "bg-accent-red",
    },
  ];

  const current = options.find((o) => o.value === (selected ?? status));

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs uppercase tracking-wider text-text-secondary font-semibold">
        Status
      </label>
      <div className="grid grid-cols-2 gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onSelect(opt.value)}
            className={`tap-target rounded-xl border-2 px-3 py-3 text-sm font-bold transition-all text-center active:scale-[0.96] ${
              (selected ?? status) === opt.value
                ? opt.color + " shadow-sm"
                : "border-border bg-bg-secondary text-text-secondary hover:border-text-secondary/40"
            }`}
          >
            <span
              className={`inline-block size-2 rounded-full mr-1.5 align-middle ${opt.dotColor}`}
            />
            {opt.label}
          </button>
        ))}
      </div>
      {current && (selected ?? status) && (
        <div
          className={`inline-flex self-start items-center gap-2 px-4 py-2 rounded-full text-sm font-bold uppercase tracking-wider ${current.color} border`}
        >
          <span className={`size-2.5 rounded-full ${current.dotColor}`} />
          {current.label}
        </div>
      )}
    </div>
  );
};

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

  const handleDeliveredQty = (itemId: string, delta: number) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it;
        const newQty = Math.max(
          0,
          Math.min(it.deliveredQty + delta, it.quantity),
        );
        const missingQty = it.quantity - newQty;
        let status: ItemStatus | null = it.status;
        if (
          newQty === it.quantity &&
          status !== "Backordered" &&
          status !== "Damaged"
        ) {
          status = "Delivered";
        } else if (
          newQty < it.quantity &&
          newQty > 0 &&
          status !== "Backordered" &&
          status !== "Damaged"
        ) {
          status = "Partial";
        } else if (
          newQty === 0 &&
          status !== "Backordered" &&
          status !== "Damaged"
        ) {
          status = "Partial";
        }
        return { ...it, deliveredQty: newQty, missingQty, status };
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
        <div className="max-w-lg mx-auto px-4 py-4 sm:py-8 pb-28 sm:pb-8">
          {/* Big Zone/Job Header */}
          <div className="rounded-2xl border-2 border-accent/30 bg-bg-card p-5 sm:p-6 mb-5 shadow-lg shadow-accent/5">
            <div className="flex items-center gap-3 sm:gap-4 mb-4">
              <div className="size-14 sm:size-16 rounded-xl bg-accent/20 flex items-center justify-center font-black font-mono text-2xl sm:text-3xl text-accent shrink-0 shadow-inner">
                {order.zoneId}
              </div>
              <div className="min-w-0">
                <p className="text-xs text-text-secondary uppercase tracking-wider font-semibold">
                  Location
                </p>
                <p className="text-base sm:text-lg font-bold truncate">
                  {zoneDescription(order.zoneId)}
                </p>
              </div>
            </div>

            <div className="space-y-2.5 text-sm sm:text-base">
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-secondary shrink-0">Job/Site</span>
                <span className="font-semibold text-right truncate">
                  {order.jobName}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-secondary shrink-0">Vendor</span>
                <span className="font-semibold">{order.vendor}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-secondary shrink-0">Order ID</span>
                <span className="font-mono text-xs sm:text-sm bg-bg-secondary px-2.5 py-1 rounded-lg border border-border tracking-wider">
                  {order.id}
                </span>
              </div>
            </div>
          </div>

          {/* Item Checkoff Header */}
          <p className="text-xs text-text-secondary uppercase tracking-wider mb-3 font-bold">
            Item Check-Off
          </p>

          {/* Item Cards */}
          <div className="space-y-4 mb-6">
            {items.map((item, idx) => (
              <div
                key={item.id}
                className="card-tap rounded-2xl border-2 border-border bg-bg-card overflow-hidden"
              >
                {/* Item header with status pill */}
                <div className="flex items-start justify-between px-4 pt-4 pb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] sm:text-xs font-mono text-text-secondary bg-bg-secondary rounded-lg px-2 py-1 font-bold">
                        {idx + 1}
                      </span>
                      <p className="text-sm sm:text-base font-semibold truncate">
                        {item.description}
                      </p>
                    </div>
                    <p className="text-xs sm:text-sm text-text-secondary ml-0.5">
                      Qty Ordered:{" "}
                      <strong className="text-text-primary text-base sm:text-lg">
                        {item.quantity}
                      </strong>
                    </p>
                  </div>
                  {/* Status pill in header */}
                  {item.status && (
                    <span
                      className={`shrink-0 ml-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs sm:text-sm font-bold uppercase tracking-wider border ${
                        item.status === "Delivered"
                          ? "bg-accent-green/15 text-accent-green border-accent-green/30"
                          : item.status === "Partial"
                            ? "bg-accent-purple/15 text-accent-purple border-accent-purple/30"
                            : item.status === "Backordered"
                              ? "bg-accent-amber/15 text-accent-amber border-accent-amber/30"
                              : "bg-accent-red/15 text-accent-red border-accent-red/30"
                      }`}
                    >
                      <span
                        className={`size-2 rounded-full ${
                          item.status === "Delivered"
                            ? "bg-accent-green"
                            : item.status === "Partial"
                              ? "bg-accent-purple"
                              : item.status === "Backordered"
                                ? "bg-accent-amber"
                                : "bg-accent-red"
                        }`}
                      />
                      {item.status}
                    </span>
                  )}
                </div>

                {/* Item inputs */}
                <div className="px-4 pb-4 space-y-4">
                  {/* Qty Delivered — BIG stepper */}
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-text-secondary mb-2 font-bold">
                      Quantity Delivered
                    </label>
                    <div className="flex items-stretch gap-2">
                      {/* Minus button */}
                      <button
                        type="button"
                        onClick={() => handleDeliveredQty(item.id, -1)}
                        disabled={item.deliveredQty <= 0}
                        className="stepper-btn tap-target w-14 sm:w-16 flex items-center justify-center rounded-xl border-2 border-border bg-bg-secondary text-text-primary text-2xl sm:text-3xl font-bold hover:border-accent/50 hover:bg-bg-card disabled:opacity-25 disabled:cursor-not-allowed active:scale-95 transition-all shrink-0"
                        aria-label="Decrease quantity"
                      >
                        −
                      </button>

                      {/* Value display */}
                      <div className="flex-1 flex items-center justify-center rounded-xl border-2 border-accent/50 bg-bg-secondary px-3">
                        <span className="text-2xl sm:text-3xl font-black font-mono text-accent tabular-nums">
                          {item.deliveredQty}
                        </span>
                        <span className="text-sm text-text-secondary ml-2">
                          / {item.quantity}
                        </span>
                      </div>

                      {/* Plus button */}
                      <button
                        type="button"
                        onClick={() => handleDeliveredQty(item.id, 1)}
                        disabled={item.deliveredQty >= item.quantity}
                        className="stepper-btn tap-target w-14 sm:w-16 flex items-center justify-center rounded-xl border-2 border-border bg-bg-secondary text-text-primary text-2xl sm:text-3xl font-bold hover:border-accent/50 hover:bg-bg-card disabled:opacity-25 disabled:cursor-not-allowed active:scale-95 transition-all shrink-0"
                        aria-label="Increase quantity"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Qty Missing (auto) */}
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-text-secondary mb-1 font-bold">
                      Quantity Missing
                    </label>
                    <div
                      className={`w-full rounded-xl border-2 px-4 py-3 text-lg sm:text-xl font-bold font-mono tabular-nums ${
                        item.missingQty > 0
                          ? "border-accent-red/40 bg-accent-red/5 text-accent-red"
                          : "border-accent-green/40 bg-accent-green/5 text-accent-green"
                      }`}
                    >
                      {item.missingQty}
                    </div>
                  </div>

                  {/* Status selector */}
                  <StatusPill
                    status={item.status}
                    selected={item.status}
                    onSelect={(s) => handleStatusChange(item.id, s)}
                  />

                  {/* Validation */}
                  {item.deliveredQty > item.quantity && (
                    <p className="text-sm text-accent-red font-semibold mt-1">
                      Cannot exceed ordered quantity ({item.quantity}).
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Vendor Note */}
          <div className="rounded-2xl border-2 border-border bg-bg-card p-4 sm:p-5 mb-5">
            <label className="block text-sm sm:text-base font-bold mb-2">
              Delivery Notes
            </label>
            <textarea
              value={vendorNote}
              onChange={(e) => setVendorNote(e.target.value)}
              placeholder="Explain any missing, backordered, or damaged items…"
              rows={3}
              className="w-full rounded-xl border-2 border-border bg-bg-secondary px-4 py-3 text-base text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 resize-none"
            />
          </div>

          {/* Summary */}
          <div className="rounded-2xl border-2 border-border bg-bg-card p-4 sm:p-5 mb-6">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold uppercase tracking-wider text-text-secondary">
                Overall Status
              </p>
              <span className={orderStatusBadge(overallStatus)}>
                {overallStatus}
              </span>
            </div>
            {overallStatus === "Partial" && (
              <p className="text-sm text-text-secondary mt-3 leading-relaxed">
                This order has items that are not fully delivered. Dispatch will
                be notified.
              </p>
            )}
          </div>

          {/* Submit Button — BIG */}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="tap-target w-full rounded-2xl bg-accent px-6 py-5 text-lg sm:text-xl font-black text-white hover:bg-accent/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-xl shadow-accent/20 active:scale-[0.97] tracking-wide"
          >
            {canSubmit
              ? overallStatus === "Complete"
                ? "✓  Submit Confirmation — Complete"
                : "Submit Confirmation — Partial"
              : "Select a status for each item"}
          </button>

          <p className="text-center text-xs text-text-secondary mt-4 mb-2">
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
            <h2 className="text-xl sm:text-2xl font-bold mb-2">
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
              className="tap-target rounded-xl border-2 border-border bg-bg-card px-8 py-4 text-base font-bold hover:bg-bg-secondary transition-colors active:scale-[0.97]"
            >
              New Check-In
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
