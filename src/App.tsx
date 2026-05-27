import { useState } from "react";
import { mockOrders, stagingZones, mockConfirmations } from "./mockData";
import type { Order, OrderStatus, ItemStatus, LineItem } from "./types";

/* ── SVG Icons ── */
const Svg = ({ d, size = 24 }: { d: string; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);

const icons = {
  scan: "M3 7V5a2 2 0 012-2h2m10 0h2a2 2 0 012 2v2m0 10v2a2 2 0 01-2 2h-2m-10 0H5a2 2 0 01-2-2v-2",
  list: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
  display:
    "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
  truck:
    "M9 17a2 2 0 11-4 0 2 2 0 014 0zm10 0a2 2 0 11-4 0 2 2 0 014 0zM13 17V6m0 0l4 4m-4-4L9 10m4 7h4",
  check: "M5 13l4 4L19 7",
  backorder: "M12 9v2m0 4h.01M12 3a9 9 0 100 18 9 9 0 000-18z",
  damaged:
    "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z M12 9v4 M12 17h.01",
  arrowLeft: "M19 12H5m7-7l-7 7 7 7",
  arrowRight: "M5 12h14m-7-7l7 7-7 7",
  expand: "M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4",
  cube: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10v10m-8-4v-10l8 4",
  tablet:
    "M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z",
  alert:
    "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
};

/* ── Bottom Tab Navigation ── */
type Tab =
  | "scan"
  | "orders"
  | "display"
  | "dispatch"
  | "space"
  | "pickup"
  | "eink";

/* ================================================================
   SCAN / CHECK-IN SCREEN — the primary vendor flow
   ================================================================ */
function ScanScreen() {
  type Step = "scan" | "checkoff" | "confirm" | "done";

  const [step, setStep] = useState<Step>("scan");
  const [order, setOrder] = useState<Order | null>(null);
  const [itemIdx, setItemIdx] = useState(0);
  const [items, setItems] = useState<LineItem[]>([]);
  const [vendorNote, setVendorNote] = useState("");
  const [showNoteInput, setShowNoteInput] = useState(false);

  // Simulate QR scan — pick a pending order
  const handleScan = () => {
    const pending = mockOrders.filter((o) => o.status === "Pending");
    if (pending.length === 0) return;
    // Just pick the first pending order for demo
    const o = pending[0];
    const initItems = o.items.map((it) => ({
      ...it,
      deliveredQty: 0,
      missingQty: 0,
      status: null as ItemStatus | null,
    }));
    setOrder(o);
    setItems(initItems);
    setItemIdx(0);
    setStep("checkoff");
  };

  const item = items[itemIdx];
  const isLastItem = itemIdx >= items.length - 1;

  const updateItem = (status: ItemStatus, deliveredQty: number) => {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== itemIdx) return it;
        if (status === "Delivered") {
          return {
            ...it,
            status,
            deliveredQty: it.quantity,
            missingQty: 0,
          };
        }
        if (status === "Damaged" || status === "Backordered") {
          return {
            ...it,
            status,
            deliveredQty: 0,
            missingQty: it.quantity,
          };
        }
        // Partial
        return {
          ...it,
          status,
          deliveredQty,
          missingQty: it.quantity - deliveredQty,
        };
      }),
    );
  };

  const adjustQty = (delta: number) => {
    if (!item) return;
    const newQty = Math.max(
      0,
      Math.min(item.deliveredQty + delta, item.quantity),
    );
    const status: ItemStatus =
      newQty === item.quantity
        ? "Delivered"
        : newQty === 0
          ? "Partial"
          : "Partial";
    updateItem(status, newQty);
  };

  const goNext = () => {
    if (isLastItem) {
      setStep("confirm");
    } else {
      setItemIdx((i) => i + 1);
    }
  };

  const goPrev = () => {
    if (itemIdx > 0) {
      setItemIdx((i) => i - 1);
    }
  };

  const handleSubmit = () => {
    setStep("done");
  };

  const handleReset = () => {
    setStep("scan");
    setOrder(null);
    setItems([]);
    setItemIdx(0);
    setVendorNote("");
    setShowNoteInput(false);
  };

  // ── Step: SCAN QR ──
  if (step === "scan") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-10">
        <div>
          <h1 className="text-3xl font-light tracking-tight mb-3 text-text-primary">
            Vendor Check-In
          </h1>
          <p className="text-text-secondary text-base max-w-[280px] mx-auto">
            Scan the QR code at your assigned staging zone
          </p>
        </div>

        {/* Scanner visual */}
        <div className="relative w-72 h-72 rounded-2xl border border-border bg-bg-card overflow-hidden shadow-2xl">
          <div className="absolute inset-4 rounded-xl border border-dashed border-border" />
          <div className="absolute left-4 right-4 h-[1px] bg-accent animate-scan-line shadow-[0_0_8px_#3b82f6]" />
          <div className="absolute bottom-6 left-0 right-0 text-center">
            <span className="text-[10px] text-text-secondary font-mono tracking-[0.2em] uppercase">
              Align QR Code
            </span>
          </div>
        </div>

        <div className="w-full max-w-[320px] space-y-4">
          <button
            onClick={handleScan}
            className="w-full flex items-center justify-center gap-3 bg-accent text-white py-4 px-6 rounded-xl font-medium text-lg transition-transform active:scale-[0.98]"
          >
            <Svg d={icons.scan} size={24} />
            Simulate QR Scan
          </button>
          <p className="text-xs text-text-secondary">
            Demo: taps a pending order automatically
          </p>
        </div>
      </div>
    );
  }

  // ── Step: CHECKOFF (one item at a time) ──
  if (step === "checkoff" && order && item) {
    const deliveredCount = items.filter((i) => i.status !== null).length;
    const totalItems = items.length;

    return (
      <div className="flex-1 flex flex-col px-6">
        {/* Header: Job + Vendor */}
        <div className="py-6 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono text-text-secondary uppercase tracking-widest">
              {order.id}
            </span>
            <span className="text-xs text-text-secondary bg-bg-surface px-2 py-1 rounded">
              Zone{" "}
              <strong className="text-text-primary font-mono">
                {order.zoneId}
              </strong>
            </span>
          </div>
          <h2 className="text-2xl font-light tracking-tight truncate text-text-primary">
            {order.vendor}
          </h2>
          <p className="text-sm text-text-secondary truncate mt-1">
            {order.jobName} &middot; {order.jobNumber}
          </p>

          {/* Progress dots */}
          <div className="flex items-center gap-2 mt-6">
            {items.map((it, i) => {
              let cls = "h-1 flex-1 rounded-full transition-colors ";
              if (i === itemIdx) cls += "bg-accent";
              else if (it.status === "Delivered") cls += "bg-accent-green";
              else if (it.status === "Damaged" || it.status === "Backordered")
                cls += "bg-accent-amber";
              else if (it.status === "Partial") cls += "bg-accent-purple";
              else cls += "bg-border";
              return <div key={i} className={cls} />;
            })}
          </div>
          <div className="text-right mt-2">
            <span className="text-[10px] text-text-secondary font-mono uppercase tracking-widest">
              {deliveredCount} of {totalItems} Checked
            </span>
          </div>
        </div>

        {/* Current Item */}
        <div
          key={item.id}
          className="flex-1 flex flex-col py-8 animate-slide-up"
        >
          {/* Item info */}
          <div className="mb-8">
            <p className="text-[10px] text-text-secondary uppercase tracking-widest mb-2">
              Item {itemIdx + 1}
            </p>
            <h3 className="text-2xl font-medium leading-snug text-text-primary">
              {item.description}
            </h3>
            <p className="text-base text-text-secondary mt-2">
              Ordered:{" "}
              <strong className="text-text-primary font-mono">
                {item.quantity}
              </strong>
            </p>
          </div>

          {/* Quantity stepper */}
          <div className="flex items-center gap-4 mb-10">
            <button
              type="button"
              className="stepper-btn w-16 h-16 shrink-0"
              onClick={() => adjustQty(-1)}
              disabled={item.deliveredQty <= 0}
            >
              −
            </button>
            <div className="flex-1 flex items-center justify-center rounded-xl border border-border bg-bg-card py-4">
              <span className="text-4xl font-light font-mono text-text-primary tabular-nums">
                {item.deliveredQty}
              </span>
              <span className="text-lg text-text-secondary ml-2 font-mono">
                / {item.quantity}
              </span>
            </div>
            <button
              type="button"
              className="stepper-btn w-16 h-16 shrink-0"
              onClick={() => adjustQty(1)}
              disabled={item.deliveredQty >= item.quantity}
            >
              +
            </button>
          </div>

          {/* Quick-set buttons */}
          <div className="grid grid-cols-3 gap-3 mb-10">
            {[0, Math.floor(item.quantity / 2), item.quantity].map((qty) => (
              <button
                key={qty}
                type="button"
                onClick={() => {
                  updateItem(
                    qty === item.quantity
                      ? "Delivered"
                      : qty === 0
                        ? "Partial"
                        : "Partial",
                    qty,
                  );
                }}
                className={`tap-target rounded-lg border px-2 py-3 text-sm font-medium transition-colors ${
                  item.deliveredQty === qty
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border bg-bg-surface text-text-secondary hover:text-text-primary"
                }`}
              >
                {qty === 0
                  ? "None"
                  : qty === item.quantity
                    ? `All (${qty})`
                    : `Half (${qty})`}
              </button>
            ))}
          </div>
        </div>

        {/* Giant status buttons */}
        <div className="pb-6 space-y-3">
          <button
            onClick={() => {
              updateItem("Delivered", item.quantity);
            }}
            className="action-btn action-btn-delivered"
          >
            <Svg d={icons.check} size={20} />
            Full Delivery
          </button>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => updateItem("Partial", item.deliveredQty || 0)}
              className="action-btn action-btn-partial"
            >
              Partial
            </button>
            <button
              onClick={() => updateItem("Damaged", 0)}
              className="action-btn action-btn-damaged"
            >
              Damaged
            </button>
          </div>
          <button
            onClick={() => updateItem("Backordered", 0)}
            className="action-btn action-btn-backordered"
          >
            Backordered
          </button>
        </div>

        {/* Next / Prev nav */}
        <div className="pb-8 flex items-center gap-4">
          {itemIdx > 0 ? (
            <button
              onClick={goPrev}
              className="tap-target flex items-center justify-center w-16 rounded-xl border border-border bg-bg-surface text-text-secondary hover:text-text-primary shrink-0 transition-colors"
            >
              <Svg d={icons.arrowLeft} size={20} />
            </button>
          ) : (
            <div className="w-16 shrink-0" />
          )}
          <button
            onClick={goNext}
            className="tap-target flex-1 flex items-center justify-center gap-2 rounded-xl bg-text-primary text-bg-primary font-medium text-lg transition-transform active:scale-[0.98]"
          >
            {isLastItem ? "Review Order" : "Next Item"}
            <Svg d={icons.arrowRight} size={20} />
          </button>
        </div>
      </div>
    );
  }

  // ── Step: CONFIRM ──
  if (step === "confirm" && order) {
    const delivered = items.filter((i) => i.status === "Delivered").length;
    const damaged = items.filter((i) => i.status === "Damaged").length;
    const backordered = items.filter((i) => i.status === "Backordered").length;
    const partial = items.filter((i) => i.status === "Partial").length;
    const hasIssues = damaged > 0 || backordered > 0 || partial > 0;
    const allDelivered = delivered === items.length;

    return (
      <div className="flex-1 flex flex-col px-6">
        <div className="py-6 border-b border-border">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-mono text-text-secondary uppercase tracking-widest">
              {order.id}
            </span>
          </div>
          <h2 className="text-2xl font-light tracking-tight text-text-primary">
            {order.vendor}
          </h2>
          <p className="text-sm text-text-secondary mt-1">
            {order.jobName} &middot; Zone {order.zoneId}
          </p>
        </div>

        <div className="flex-1 py-6 space-y-3 overflow-y-auto">
          <h3 className="text-[10px] font-mono uppercase tracking-widest text-text-secondary mb-4">
            Review ({items.length} items)
          </h3>
          {items.map((it, i) => (
            <div
              key={it.id}
              onClick={() => {
                setItemIdx(i);
                setStep("checkoff");
              }}
              className="flex items-center gap-4 rounded-xl border border-border bg-bg-card px-4 py-4 cursor-pointer hover:border-text-secondary/30 transition-colors"
            >
              <div
                className={`size-2 rounded-full shrink-0 ${
                  it.status === "Delivered"
                    ? "bg-accent-green"
                    : it.status === "Damaged"
                      ? "bg-accent-red"
                      : it.status === "Backordered"
                        ? "bg-accent-amber"
                        : "bg-accent-purple"
                }`}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate text-text-primary">
                  {it.description}
                </p>
                <p className="text-xs text-text-secondary mt-1">
                  <span className="font-mono">
                    {it.deliveredQty}/{it.quantity}
                  </span>{" "}
                  &middot;{" "}
                  <span
                    className={
                      it.status === "Delivered"
                        ? "text-accent-green"
                        : it.status === "Damaged"
                          ? "text-accent-red"
                          : it.status === "Backordered"
                            ? "text-accent-amber"
                            : "text-accent-purple"
                    }
                  >
                    {it.status}
                  </span>
                </p>
              </div>
              <Svg d={icons.arrowRight} size={16} />
            </div>
          ))}
        </div>

        {/* Summary badges */}
        <div className="flex flex-wrap gap-2 py-4 border-t border-border">
          <span className="status-pill bg-accent-green/10 text-accent-green border border-accent-green/20 text-xs">
            {delivered} Delivered
          </span>
          {partial > 0 && (
            <span className="status-pill bg-accent-purple/10 text-accent-purple border border-accent-purple/20 text-xs">
              {partial} Partial
            </span>
          )}
          {damaged > 0 && (
            <span className="status-pill bg-accent-red/10 text-accent-red border border-accent-red/20 text-xs">
              {damaged} Damaged
            </span>
          )}
          {backordered > 0 && (
            <span className="status-pill bg-accent-amber/10 text-accent-amber border border-accent-amber/20 text-xs">
              {backordered} Backordered
            </span>
          )}
        </div>

        {/* Note input toggle */}
        {hasIssues && !showNoteInput && (
          <button
            onClick={() => setShowNoteInput(true)}
            className="tap-target w-full rounded-xl border border-accent-amber/30 bg-accent-amber/5 text-accent-amber px-4 py-4 text-sm font-medium mb-4 transition-colors hover:bg-accent-amber/10"
          >
            Add explanation for missing/damaged items
          </button>
        )}
        {showNoteInput && (
          <textarea
            value={vendorNote}
            onChange={(e) => setVendorNote(e.target.value)}
            placeholder="Explain any missing, backordered, or damaged items…"
            rows={3}
            className="w-full rounded-xl border border-border bg-bg-card px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent mb-4 resize-none"
          />
        )}

        {/* Submit */}
        <div className="pb-8 pt-2">
          <button
            onClick={handleSubmit}
            className={`w-full flex items-center justify-center gap-3 py-4 px-6 rounded-xl font-medium text-lg transition-transform active:scale-[0.98] ${
              allDelivered
                ? "bg-accent-green text-bg-primary"
                : "bg-accent-amber text-bg-primary"
            }`}
          >
            <Svg d={icons.check} size={24} />
            {allDelivered
              ? "Confirm Complete Delivery"
              : "Confirm Partial Delivery"}
          </button>
        </div>
      </div>
    );
  }

  // ── Step: DONE ──
  if (step === "done" && order) {
    const allDelivered = items.every((i) => i.status === "Delivered");
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-8">
        <div
          className={`size-24 rounded-full flex items-center justify-center ${
            allDelivered
              ? "bg-accent-green/10 text-accent-green animate-pulse-green"
              : "bg-accent-amber/10 text-accent-amber"
          }`}
        >
          <Svg d={icons.check} size={48} />
        </div>
        <div>
          <h2 className="text-3xl font-light tracking-tight mb-2 text-text-primary">
            {allDelivered ? "Delivery Complete" : "Partial Delivery"}
          </h2>
          <p className="text-text-secondary text-base">
            Order <span className="font-mono">{order.id}</span> &middot;{" "}
            {order.vendor}
          </p>
          <p className="text-sm text-text-secondary mt-4 bg-bg-surface inline-block px-4 py-2 rounded-full">
            Dispatch has been notified
          </p>
        </div>
        <button
          onClick={handleReset}
          className="w-full max-w-[280px] flex items-center justify-center gap-3 bg-bg-card border border-border text-text-primary py-4 px-6 rounded-xl font-medium text-lg transition-transform active:scale-[0.98] mt-4"
        >
          <Svg d={icons.scan} size={20} />
          New Check-In
        </button>
      </div>
    );
  }

  return null;
}

/* ================================================================
   ORDERS SCREEN — simple list, no tables
   ================================================================ */
function OrdersScreen() {
  const [expanded, setExpanded] = useState<string | null>(null);

  const counts = () => {
    let pending = 0,
      partial = 0,
      complete = 0;
    for (const o of mockOrders) {
      if (o.status === "Pending") pending++;
      else if (o.status === "Partial") partial++;
      else complete++;
    }
    return { pending, partial, complete };
  };
  const c = counts();

  const statusPill = (status: OrderStatus) => {
    const map: Record<OrderStatus, string> = {
      Pending: "bg-accent-amber/10 text-accent-amber border-accent-amber/20",
      Partial: "bg-accent-purple/10 text-accent-purple border-accent-purple/20",
      Complete: "bg-accent-green/10 text-accent-green border-accent-green/20",
    };
    return `status-pill border text-[10px] px-2 py-1 ${map[status]}`;
  };

  return (
    <div className="flex-1 flex flex-col px-6 overflow-y-auto">
      <div className="py-6">
        <h1 className="text-3xl font-light tracking-tight text-text-primary">
          Orders
        </h1>
        <div className="flex gap-3 mt-4">
          {[
            { label: "Pending", count: c.pending, color: "text-accent-amber" },
            { label: "Partial", count: c.partial, color: "text-accent-purple" },
            {
              label: "Complete",
              count: c.complete,
              color: "text-accent-green",
            },
          ].map((s) => (
            <div
              key={s.label}
              className="flex-1 flex flex-col items-center justify-center bg-bg-card border border-border rounded-xl py-3"
            >
              <span className={`text-2xl font-light font-mono ${s.color}`}>
                {s.count}
              </span>
              <span className="text-[10px] text-text-secondary uppercase tracking-widest mt-1">
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3 pb-8">
        {mockOrders.map((o) => (
          <div
            key={o.id}
            className="rounded-xl border border-border bg-bg-card overflow-hidden transition-colors hover:border-text-secondary/30"
          >
            <button
              onClick={() => setExpanded(expanded === o.id ? null : o.id)}
              className="w-full flex items-center gap-4 px-5 py-4 text-left tap-target"
            >
              <div
                className={`size-2 rounded-full shrink-0 ${
                  o.status === "Pending"
                    ? "bg-accent-amber"
                    : o.status === "Partial"
                      ? "bg-accent-purple"
                      : "bg-accent-green"
                }`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-base font-medium truncate text-text-primary">
                    {o.vendor}
                  </span>
                  <span className={statusPill(o.status)}>{o.status}</span>
                </div>
                <p className="text-sm text-text-secondary truncate">
                  {o.jobName} &middot; Zone{" "}
                  <span className="text-text-primary font-mono">
                    {o.zoneId}
                  </span>
                </p>
              </div>
            </button>

            {expanded === o.id && (
              <div className="border-t border-border px-5 py-4 space-y-4 animate-slide-up bg-bg-surface/50">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-[10px] text-text-secondary uppercase tracking-widest block mb-1">
                      Job #
                    </span>
                    <p className="font-mono text-text-primary">{o.jobNumber}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-text-secondary uppercase tracking-widest block mb-1">
                      Site #
                    </span>
                    <p className="font-mono text-text-primary">
                      {o.siteNumber}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] text-text-secondary uppercase tracking-widest block mb-1">
                      Zone
                    </span>
                    <p className="font-mono text-text-primary">{o.zoneId}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-text-secondary uppercase tracking-widest block mb-1">
                      Created
                    </span>
                    <p className="text-text-primary">
                      {new Date(o.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="space-y-2 pt-2 border-t border-border/50">
                  <p className="text-[10px] text-text-secondary uppercase tracking-widest">
                    Items ({o.items.length})
                  </p>
                  {o.items.map((it) => (
                    <div
                      key={it.id}
                      className="flex items-center justify-between text-sm bg-bg-card border border-border/50 rounded-lg px-3 py-2"
                    >
                      <span className="truncate flex-1 mr-3 text-text-primary">
                        {it.description}
                      </span>
                      <span className="text-xs text-text-secondary shrink-0 font-mono">
                        {it.deliveredQty}/{it.quantity}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================================================================
   DISPLAY BOARD SCREEN — simple zone grid
   ================================================================ */
function DisplayScreen() {
  const zoneDesc = (zoneId: string): string => {
    const map: Record<string, string> = {
      G1: "Ground 1",
      G2: "Ground 2",
      G3: "Ground 3",
      "S1-A": "Shelf 1A",
      "S1-B": "Shelf 1B",
      "S2-A": "Shelf 2A",
    };
    return map[zoneId] ?? zoneId;
  };

  const displayOrders = mockOrders.slice(0, 3);

  return (
    <div className="flex-1 flex flex-col px-6 overflow-y-auto">
      <div className="py-6 text-center">
        <h1 className="text-xl font-light tracking-widest text-text-primary uppercase">
          StageVerify
        </h1>
        <p className="text-[10px] text-text-secondary tracking-[0.3em] uppercase mt-2">
          Delivery Staging Board
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 pb-8">
        {stagingZones.map((zone) => {
          const order = displayOrders.find((o) => o.id === zone.currentOrderId);
          const statusColor =
            order?.status === "Pending"
              ? "border-accent-amber/50"
              : order?.status === "Partial"
                ? "border-accent-purple/50"
                : order?.status === "Complete"
                  ? "border-accent-green/50"
                  : "border-border";

          return (
            <div
              key={zone.id}
              className={`rounded-xl border ${statusColor} bg-bg-card p-5 flex flex-col ${
                !order ? "border-dashed opacity-50" : ""
              }`}
            >
              <span className="text-4xl font-light font-mono text-text-primary">
                {zone.id}
              </span>
              <p className="text-[10px] text-text-secondary uppercase tracking-widest mt-1">
                {zoneDesc(zone.id)}
              </p>
              {order ? (
                <div className="mt-auto pt-4">
                  <div className="h-px bg-border mb-3" />
                  <p className="text-sm font-medium truncate text-text-primary">
                    {order.vendor}
                  </p>
                  <p className="text-xs text-text-secondary truncate mt-0.5">
                    {order.jobName}
                  </p>
                  <span
                    className={`inline-block mt-3 text-[10px] uppercase tracking-widest px-2 py-1 rounded border ${
                      order.status === "Pending"
                        ? "bg-accent-amber/10 text-accent-amber border-accent-amber/20"
                        : order.status === "Partial"
                          ? "bg-accent-purple/10 text-accent-purple border-accent-purple/20"
                          : "bg-accent-green/10 text-accent-green border-accent-green/20"
                    }`}
                  >
                    {order.status}
                  </span>
                </div>
              ) : (
                <div className="mt-auto pt-4">
                  <p className="text-[10px] text-text-secondary uppercase tracking-widest">
                    Available
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ================================================================
   DISPATCH SCREEN — simple confirmation log
   ================================================================ */
function DispatchScreen() {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="flex-1 flex flex-col px-6 overflow-y-auto">
      <div className="py-6 flex items-center justify-between">
        <h1 className="text-3xl font-light tracking-tight text-text-primary">
          Dispatch Log
        </h1>
        <span className="text-[10px] text-text-secondary border border-border rounded px-2 py-1 uppercase tracking-widest">
          Read-Only
        </span>
      </div>

      <div className="space-y-3 pb-8">
        {mockConfirmations.map((log) => (
          <div
            key={log.id}
            className="rounded-xl border border-border bg-bg-card overflow-hidden transition-colors hover:border-text-secondary/30"
          >
            <button
              onClick={() => setExpanded(expanded === log.id ? null : log.id)}
              className="w-full flex items-center gap-4 px-5 py-4 text-left tap-target"
            >
              <div
                className={`size-2 rounded-full shrink-0 ${
                  log.status === "Complete"
                    ? "bg-accent-green"
                    : "bg-accent-purple"
                }`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`text-sm font-medium uppercase tracking-wider ${
                      log.status === "Complete"
                        ? "text-accent-green"
                        : "text-accent-purple"
                    }`}
                  >
                    {log.status}
                  </span>
                  <span className="text-[10px] text-text-secondary font-mono">
                    {log.orderId}
                  </span>
                </div>
                <p className="text-sm text-text-secondary truncate">
                  {log.vendor} &middot; {log.jobName} &middot; Zone{" "}
                  <span className="text-text-primary font-mono">
                    {log.zoneId}
                  </span>
                </p>
              </div>
              <span className="text-[10px] text-text-secondary shrink-0 font-mono">
                {new Date(log.confirmedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </button>

            {expanded === log.id && (
              <div className="border-t border-border px-5 py-4 space-y-4 animate-slide-up bg-bg-surface/50 text-sm">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-[10px] text-text-secondary uppercase tracking-widest block mb-1">
                      Job / Site
                    </span>
                    <span className="text-text-primary">
                      {log.jobName} / {log.siteNumber}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-text-secondary uppercase tracking-widest block mb-1">
                      Time
                    </span>
                    <span className="text-text-primary">
                      {new Date(log.confirmedAt).toLocaleString()}
                    </span>
                  </div>
                </div>
                <div className="space-y-2 pt-2 border-t border-border/50">
                  <p className="text-[10px] text-text-secondary uppercase tracking-widest">
                    Items
                  </p>
                  {log.items.map((it) => (
                    <div
                      key={it.id}
                      className="flex items-center justify-between bg-bg-card border border-border/50 rounded-lg px-3 py-2"
                    >
                      <span className="truncate flex-1 mr-3 text-text-primary">
                        {it.description}
                      </span>
                      <span className="shrink-0 font-mono text-xs">
                        <span
                          className={
                            it.deliveredQty < it.quantity
                              ? "text-accent-amber"
                              : "text-accent-green"
                          }
                        >
                          {it.deliveredQty}
                        </span>
                        <span className="text-text-secondary">
                          /{it.quantity}
                        </span>
                        {it.missingQty > 0 && (
                          <span className="text-accent-red ml-1">
                            (-{it.missingQty})
                          </span>
                        )}
                        <span className="ml-2 text-[10px] uppercase tracking-widest text-text-secondary">
                          {it.status}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
                {log.vendorNote && (
                  <div className="border-t border-border/50 pt-3 mt-2">
                    <p className="text-[10px] text-text-secondary uppercase tracking-widest mb-1">
                      Note
                    </p>
                    <p className="text-text-primary italic">{log.vendorNote}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================================================================
   NEED MORE SPACE SCREEN — static mockup
   ================================================================ */
function NeedSpaceScreen() {
  const [step, setStep] = useState<"initial" | "assigned">("initial");

  return (
    <div className="flex-1 flex flex-col px-6 overflow-y-auto">
      <div className="py-6">
        <h1 className="text-3xl font-light tracking-tight text-text-primary">
          Space Request
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Zone capacity management
        </p>
      </div>

      {step === "initial" ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center pb-12 animate-slide-up">
          <div className="size-24 rounded-full bg-accent-amber/10 text-accent-amber flex items-center justify-center mb-8">
            <Svg d={icons.alert} size={48} />
          </div>
          <h2 className="text-2xl font-medium text-text-primary mb-3">
            Zone G1 is Full?
          </h2>
          <p className="text-text-secondary mb-10 max-w-[280px]">
            If you cannot safely fit all materials in the assigned zone, request
            an overflow location.
          </p>

          <div className="w-full space-y-4">
            <button
              onClick={() => setStep("assigned")}
              className="w-full flex items-center justify-center gap-3 bg-accent-amber text-bg-primary py-4 px-6 rounded-xl font-medium text-lg transition-transform active:scale-[0.98]"
            >
              <Svg d={icons.expand} size={24} />
              Request Overflow Zone
            </button>
            <button className="w-full flex items-center justify-center gap-3 bg-bg-card border border-border text-text-primary py-4 px-6 rounded-xl font-medium text-lg transition-transform active:scale-[0.98]">
              I Managed to Fit It
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center pb-12 animate-slide-up">
          <div className="size-24 rounded-full bg-accent-green/10 text-accent-green flex items-center justify-center mb-8">
            <Svg d={icons.check} size={48} />
          </div>
          <h2 className="text-2xl font-medium text-text-primary mb-2">
            Overflow Assigned
          </h2>
          <p className="text-text-secondary mb-8">
            Please place remaining items in:
          </p>

          <div className="rounded-2xl border border-accent-green/30 bg-accent-green/5 p-8 w-full mb-10">
            <span className="text-6xl font-light font-mono text-accent-green block mb-2">
              G2
            </span>
            <span className="text-sm text-accent-green/80 uppercase tracking-widest">
              Ground Spot 2
            </span>
          </div>

          <button
            onClick={() => setStep("initial")}
            className="w-full flex items-center justify-center gap-3 bg-bg-card border border-border text-text-primary py-4 px-6 rounded-xl font-medium text-lg transition-transform active:scale-[0.98]"
          >
            Return to Check-In
          </button>
        </div>
      )}
    </div>
  );
}

/* ================================================================
   TECHNICIAN PICKUP SCREEN — static mockup
   ================================================================ */
function TechPickupScreen() {
  const [step, setStep] = useState<"list" | "pickup">("list");
  const order = mockOrders[2]; // Complete order

  return (
    <div className="flex-1 flex flex-col px-6 overflow-y-auto">
      <div className="py-6">
        <h1 className="text-3xl font-light tracking-tight text-text-primary">
          Tech Pickup
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Load materials for your job
        </p>
      </div>

      {step === "list" ? (
        <div className="space-y-4 animate-slide-up">
          <div className="rounded-xl border border-border bg-bg-card p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] text-text-secondary uppercase tracking-widest">
                Ready for Pickup
              </span>
              <span className="text-xs font-mono text-accent-green bg-accent-green/10 px-2 py-1 rounded">
                Zone {order.zoneId}
              </span>
            </div>
            <h3 className="text-xl font-medium text-text-primary mb-1">
              {order.jobName}
            </h3>
            <p className="text-sm text-text-secondary mb-4">
              {order.jobNumber} &middot; {order.items.length} items
            </p>
            <button
              onClick={() => setStep("pickup")}
              className="w-full flex items-center justify-center gap-2 bg-accent text-white py-3 rounded-lg font-medium transition-transform active:scale-[0.98]"
            >
              <Svg d={icons.cube} size={20} />
              Start Pickup
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col animate-slide-up pb-8">
          <div className="rounded-xl border border-border bg-bg-card p-6 mb-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="size-14 rounded-xl bg-accent/10 flex items-center justify-center font-light font-mono text-2xl text-accent shrink-0">
                {order.zoneId}
              </div>
              <div>
                <h3 className="text-lg font-medium text-text-primary">
                  {order.jobName}
                </h3>
                <p className="text-sm text-text-secondary">{order.jobNumber}</p>
              </div>
            </div>
            <div className="space-y-3 pt-4 border-t border-border">
              {order.items.map((it, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-sm text-text-primary">
                    {it.description}
                  </span>
                  <span className="text-sm font-mono text-text-secondary">
                    {it.quantity}x
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-auto space-y-3">
            <button
              onClick={() => setStep("list")}
              className="w-full flex items-center justify-center gap-3 bg-accent-green text-bg-primary py-4 px-6 rounded-xl font-medium text-lg transition-transform active:scale-[0.98]"
            >
              <Svg d={icons.check} size={24} />
              Confirm All Picked Up
            </button>
            <button
              onClick={() => setStep("list")}
              className="w-full flex items-center justify-center gap-3 bg-bg-card border border-border text-text-primary py-4 px-6 rounded-xl font-medium text-lg transition-transform active:scale-[0.98]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================
   E-INK SIGN PREVIEW SCREEN — static mockup
   ================================================================ */
function EInkPreviewScreen() {
  const order = mockOrders[0]; // Pending order

  return (
    <div className="flex-1 flex flex-col px-6 overflow-y-auto">
      <div className="py-6">
        <h1 className="text-3xl font-light tracking-tight text-text-primary">
          Sign Preview
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          E-Ink display visualization
        </p>
      </div>

      <div className="flex-1 flex items-center justify-center pb-12 animate-slide-up">
        {/* E-Ink Device Mockup */}
        <div className="w-full max-w-md bg-[#e5e7eb] rounded-xl p-4 shadow-2xl border-4 border-[#d1d5db]">
          {/* E-Ink Screen (Black, White, Red) */}
          <div className="bg-white rounded border-2 border-[#9ca3af] p-6 aspect-[4/3] flex flex-col relative overflow-hidden">
            {/* Top Bar */}
            <div className="flex justify-between items-start mb-4">
              <span className="text-5xl font-black font-mono text-black tracking-tighter">
                {order.zoneId}
              </span>
              <div className="bg-[#ef4444] text-white px-3 py-1 text-sm font-bold uppercase tracking-widest">
                {order.status}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 flex flex-col justify-center">
              <h2 className="text-2xl font-bold text-black leading-tight mb-2">
                {order.vendor}
              </h2>
              <p className="text-lg text-black/80 font-medium">
                {order.jobName}
              </p>
              <p className="text-sm text-black/60 font-mono mt-1">
                {order.jobNumber}
              </p>
            </div>

            {/* Bottom Bar */}
            <div className="mt-4 pt-4 border-t-2 border-black/10 flex justify-between items-end">
              <div className="text-xs text-black/50 font-mono">
                ID: {order.id}
              </div>
              <div className="text-xs text-black/50 font-mono text-right">
                {new Date().toLocaleDateString()}
                <br />
                {new Date().toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>
          </div>

          {/* Device details */}
          <div className="mt-3 flex justify-between items-center px-2">
            <span className="text-[10px] text-gray-500 font-mono uppercase">
              Minew 7.5"
            </span>
            <div className="flex gap-1">
              <div className="size-1.5 rounded-full bg-green-500"></div>
              <div className="size-1.5 rounded-full bg-gray-400"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   MAIN APP — bottom tab bar shell
   ================================================================ */
export default function App() {
  const [tab, setTab] = useState<Tab>("scan");

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "scan", label: "Scan In", icon: icons.scan },
    { id: "orders", label: "Orders", icon: icons.list },
    { id: "display", label: "Board", icon: icons.display },
    { id: "dispatch", label: "Dispatch", icon: icons.truck },
    { id: "space", label: "Space", icon: icons.expand },
    { id: "pickup", label: "Pickup", icon: icons.cube },
    { id: "eink", label: "E-Ink", icon: icons.tablet },
  ];

  return (
    <div className="app-container flex flex-col min-h-screen min-h-dvh bg-bg-primary">
      {/* Screen content */}
      {tab === "scan" && <ScanScreen />}
      {tab === "orders" && <OrdersScreen />}
      {tab === "display" && <DisplayScreen />}
      {tab === "dispatch" && <DispatchScreen />}
      {tab === "space" && <NeedSpaceScreen />}
      {tab === "pickup" && <TechPickupScreen />}
      {tab === "eink" && <EInkPreviewScreen />}

      {/* Bottom Tab Bar */}
      <nav className="bottom-nav overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`bottom-nav-btn ${tab === t.id ? "active" : ""}`}
          >
            <Svg d={t.icon} size={22} />
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
