import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import {
  firestoreDataService,
  getDeliveryByOrderNumber,
} from "./dispatcher/firestoreService";
import type { DeliveryDetails } from "./dispatcher/models";

type DisplayItemStatus = "Delivered" | "Partial" | "Backordered" | "Damaged";
type DisplayOrderStatus = "Pending" | "Partial" | "Complete";

interface CheckInLineItem {
  id: string;
  description: string;
  quantity: number;
  deliveredQty: number;
  missingQty: number;
  status: DisplayItemStatus | null;
}

const orderStatusBadge = (status: DisplayOrderStatus) => {
  const map: Record<DisplayOrderStatus, string> = {
    "Pending":
      "bg-accent-amber/10 text-accent-amber border border-accent-amber/20",
    "Partial":
      "bg-accent-purple/10 text-accent-purple border border-accent-purple/20",
    "Complete":
      "bg-accent-green/10 text-accent-green border border-accent-green/20",
  };
  return `inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-medium uppercase tracking-widest ${map[status]}`;
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
  status: DisplayItemStatus | null;
  onSelect: (s: DisplayItemStatus) => void;
  selected: DisplayItemStatus | null;
}) => {
  const options: {
    value: DisplayItemStatus;
    label: string;
    color: string;
    dotColor: string;
  }[] = [
    {
      value: "Delivered",
      label: "Delivered",
      color: "border-accent-green/20 bg-accent-green/10 text-accent-green",
      dotColor: "bg-accent-green",
    },
    {
      value: "Partial",
      label: "Partial",
      color: "border-accent-purple/20 bg-accent-purple/10 text-accent-purple",
      dotColor: "bg-accent-purple",
    },
    {
      value: "Backordered",
      label: "Backordered",
      color: "border-accent-amber/20 bg-accent-amber/10 text-accent-amber",
      dotColor: "bg-accent-amber",
    },
    {
      value: "Damaged",
      label: "Damaged",
      color: "border-accent-red/20 bg-accent-red/10 text-accent-red",
      dotColor: "bg-accent-red",
    },
  ];

  const current = options.find((o) => o.value === (selected ?? status));

  return (
    <div className="flex flex-col gap-3">
      <label className="text-[10px] uppercase tracking-widest text-text-secondary">
        Status
      </label>
      <div className="grid grid-cols-2 gap-3">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onSelect(opt.value)}
            className={`tap-target rounded-xl border px-3 py-4 text-sm font-medium transition-all text-center active:scale-[0.98] ${
              (selected ?? status) === opt.value
                ? opt.color
                : "border-border bg-bg-card text-text-secondary hover:text-text-primary"
            }`}
          >
            <span
              className={`inline-block size-2 rounded-full mr-2 align-middle ${opt.dotColor}`}
            />
            {opt.label}
          </button>
        ))}
      </div>
      {current && (selected ?? status) && (
        <div
          className={`inline-flex self-start items-center gap-2 px-3 py-1.5 rounded text-[10px] font-medium uppercase tracking-widest ${current.color} border`}
        >
          <span className={`size-1.5 rounded-full ${current.dotColor}`} />
          {current.label}
        </div>
      )}
    </div>
  );
};

/* ── Component ── */
export function CheckInPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const [details, setDetails] = useState<DeliveryDetails | null>(null);
  const [loading, setLoading] = useState(true);

  const [step, setStep] = useState<"checkoff" | "done">("checkoff");
  const [vendorNote, setVendorNote] = useState("");
  const [items, setItems] = useState<CheckInLineItem[]>([]);

  useEffect(() => {
    if (!orderId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void getDeliveryByOrderNumber(orderId).then((result) => {
      setDetails(result);
      if (result) {
        setItems(
          result.items.map((it) => ({
            id: it.id,
            description: it.description,
            quantity: it.qtyOrdered,
            deliveredQty: 0,
            missingQty: it.qtyOrdered,
            status: null,
          })),
        );
      } else {
        setItems([]);
      }
      setLoading(false);
    });
  }, [orderId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-primary flex items-center justify-center p-4">
        <p className="text-sm text-text-secondary">Loading order…</p>
      </div>
    );
  }

  if (!details) {
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

  if (details.delivery.status === "complete") {
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
            <span className="font-mono text-text-primary">
              {details.delivery.orderNumber}
            </span>{" "}
            has already been marked as Complete.
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
        let status: DisplayItemStatus | null = it.status;
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

  const handleStatusChange = (itemId: string, status: DisplayItemStatus) => {
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
  const overallStatus: DisplayOrderStatus = allDelivered ? "Complete" : "Partial";
  const canSubmit = items.every(
    (it) => it.deliveredQty >= 0 && it.status !== null,
  );

  const handleSubmit = () => {
    void firestoreDataService.submitCheckin(
      details.delivery.id,
      "Vendor",
      items.map((it) => ({
        id: it.id,
        qtyReceived: it.deliveredQty,
        qtyMissing: it.status === "Damaged" ? 0 : it.missingQty,
        qtyDamaged: it.status === "Damaged" ? it.missingQty : 0,
      })),
    );
    setStep("done");
  };

  const handleReset = () => {
    setStep("checkoff");
    setVendorNote("");
    setItems(
      details.items.map((it) => ({
        id: it.id,
        description: it.description,
        quantity: it.qtyOrdered,
        deliveredQty: 0,
        missingQty: it.qtyOrdered,
        status: null,
      })),
    );
  };

  const zoneCode = details.stagingLocation?.code ?? "—";

  return (
    <div className="min-h-screen bg-bg-primary">
      {step === "checkoff" && (
        <div className="max-w-lg mx-auto px-6 py-8 pb-32">
          {/* Big Zone/Job Header */}
          <div className="rounded-2xl border border-border bg-bg-card p-6 mb-8">
            <div className="flex items-center gap-4 mb-6">
              <div className="size-16 rounded-xl bg-accent/10 flex items-center justify-center font-light font-mono text-3xl text-accent shrink-0">
                {zoneCode}
              </div>
              <div className="min-w-0">
                <p className="text-[10px] text-text-secondary uppercase tracking-widest mb-1">
                  Location
                </p>
                <p className="text-lg font-medium truncate text-text-primary">
                  {zoneDescription(zoneCode)}
                </p>
              </div>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-secondary shrink-0">Job/Site</span>
                <span className="font-medium text-right truncate text-text-primary">
                  {details.job.jobName}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-secondary shrink-0">Vendor</span>
                <span className="font-medium text-text-primary">
                  {details.vendor.name}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-secondary shrink-0">Order ID</span>
                <span className="font-mono text-xs bg-bg-surface px-2 py-1 rounded text-text-primary">
                  {details.delivery.orderNumber}
                </span>
              </div>
            </div>
          </div>

          {/* Item Checkoff Header */}
          <p className="text-[10px] text-text-secondary uppercase tracking-widest mb-4">
            Item Check-Off
          </p>

          {/* Item Cards */}
          <div className="space-y-6 mb-8">
            {items.map((item, idx) => (
              <div
                key={item.id}
                className="rounded-2xl border border-border bg-bg-card overflow-hidden"
              >
                {/* Item header with status pill */}
                <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-border/50">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-[10px] font-mono text-text-secondary bg-bg-surface rounded px-2 py-1">
                        {idx + 1}
                      </span>
                      <p className="text-base font-medium truncate text-text-primary">
                        {item.description}
                      </p>
                    </div>
                    <p className="text-sm text-text-secondary">
                      Qty Ordered:{" "}
                      <strong className="text-text-primary font-mono">
                        {item.quantity}
                      </strong>
                    </p>
                  </div>
                  {/* Status pill in header */}
                  {item.status && (
                    <span
                      className={`shrink-0 ml-3 inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium uppercase tracking-widest border ${
                        item.status === "Delivered"
                          ? "bg-accent-green/10 text-accent-green border-accent-green/20"
                          : item.status === "Partial"
                            ? "bg-accent-purple/10 text-accent-purple border-accent-purple/20"
                            : item.status === "Backordered"
                              ? "bg-accent-amber/10 text-accent-amber border-accent-amber/20"
                              : "bg-accent-red/10 text-accent-red border-accent-red/20"
                      }`}
                    >
                      <span
                        className={`size-1.5 rounded-full ${
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
                <div className="px-5 py-5 space-y-6">
                  {/* Qty Delivered — BIG stepper */}
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-text-secondary mb-3">
                      Quantity Delivered
                    </label>
                    <div className="flex items-stretch gap-3">
                      {/* Minus button */}
                      <button
                        type="button"
                        onClick={() => handleDeliveredQty(item.id, -1)}
                        disabled={item.deliveredQty <= 0}
                        className="stepper-btn w-16 shrink-0"
                        aria-label="Decrease quantity"
                      >
                        −
                      </button>

                      {/* Value display */}
                      <div className="flex-1 flex items-center justify-center rounded-xl border border-border bg-bg-surface px-4">
                        <span className="text-3xl font-light font-mono text-text-primary tabular-nums">
                          {item.deliveredQty}
                        </span>
                        <span className="text-sm text-text-secondary ml-2 font-mono">
                          / {item.quantity}
                        </span>
                      </div>

                      {/* Plus button */}
                      <button
                        type="button"
                        onClick={() => handleDeliveredQty(item.id, 1)}
                        disabled={item.deliveredQty >= item.quantity}
                        className="stepper-btn w-16 shrink-0"
                        aria-label="Increase quantity"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Qty Missing (auto) */}
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-text-secondary mb-2">
                      Quantity Missing
                    </label>
                    <div
                      className={`w-full rounded-xl border px-4 py-3 text-xl font-light font-mono tabular-nums ${
                        item.missingQty > 0
                          ? "border-accent-red/20 bg-accent-red/5 text-accent-red"
                          : "border-accent-green/20 bg-accent-green/5 text-accent-green"
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
                    <p className="text-xs text-accent-red mt-2">
                      Cannot exceed ordered quantity ({item.quantity}).
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Vendor Note */}
          <div className="rounded-2xl border border-border bg-bg-card p-6 mb-8">
            <label className="block text-[10px] uppercase tracking-widest text-text-secondary mb-3">
              Delivery Notes
            </label>
            <textarea
              value={vendorNote}
              onChange={(e) => setVendorNote(e.target.value)}
              placeholder="Explain any missing, backordered, or damaged items…"
              rows={3}
              className="w-full rounded-xl border border-border bg-bg-surface px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent resize-none"
            />
          </div>

          {/* Summary */}
          <div className="rounded-2xl border border-border bg-bg-card p-6 mb-8">
            <div className="flex items-center justify-between gap-4">
              <p className="text-[10px] uppercase tracking-widest text-text-secondary">
                Overall Status
              </p>
              <span className={orderStatusBadge(overallStatus)}>
                {overallStatus}
              </span>
            </div>
            {overallStatus === "Partial" && (
              <p className="text-xs text-text-secondary mt-4">
                This order has items that are not fully delivered. Dispatch will
                be notified.
              </p>
            )}
          </div>

          {/* Submit Button — BIG */}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`w-full rounded-xl py-5 text-lg font-medium transition-transform active:scale-[0.98] ${
              canSubmit
                ? overallStatus === "Complete"
                  ? "bg-accent-green text-bg-primary"
                  : "bg-accent-amber text-bg-primary"
                : "bg-bg-surface text-text-secondary cursor-not-allowed"
            }`}
          >
            {canSubmit
              ? overallStatus === "Complete"
                ? "Submit Confirmation — Complete"
                : "Submit Confirmation — Partial"
              : "Select a status for each item"}
          </button>

          <p className="text-center text-[10px] text-text-secondary mt-4 uppercase tracking-widest">
            By submitting, you confirm the items delivered and their condition.
          </p>
        </div>
      )}

      {step === "done" && (
        <div className="min-h-screen flex items-center justify-center px-6">
          <div className="max-w-sm w-full text-center">
            <div
              className={`size-24 mx-auto rounded-full flex items-center justify-center mb-8 ${
                overallStatus === "Complete"
                  ? "bg-accent-green/10 text-accent-green"
                  : "bg-accent-purple/10 text-accent-purple"
              }`}
            >
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
            <h2 className="text-3xl font-light tracking-tight mb-3 text-text-primary">
              Confirmation Submitted
            </h2>
            <p className="text-base mb-2 text-text-secondary">
              Status:{" "}
              <strong
                className={
                  overallStatus === "Complete"
                    ? "text-accent-green font-medium"
                    : "text-accent-purple font-medium"
                }
              >
                {overallStatus}
              </strong>
            </p>
            <p className="text-sm text-text-secondary mb-8 bg-bg-surface inline-block px-4 py-2 rounded-full">
              Dispatch has been notified
            </p>
            <button
              onClick={handleReset}
              className="w-full rounded-xl border border-border bg-bg-card py-4 text-base font-medium hover:bg-bg-surface transition-colors active:scale-[0.98] text-text-primary"
            >
              New Check-In
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
