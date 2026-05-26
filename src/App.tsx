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
};

/* ── Bottom Tab Navigation ── */
type Tab = "scan" | "orders" | "display" | "dispatch";

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
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-8">
        {/* Scanner visual */}
        <div className="relative w-64 h-64 rounded-3xl border-3 border-accent/40 bg-black/40 overflow-hidden">
          <div className="absolute inset-3 rounded-2xl border-2 border-dashed border-accent/30" />
          <div className="absolute left-3 right-3 h-0.5 bg-accent animate-scan-line shadow-[0_0_12px_#3b82f6]" />
          <div className="absolute bottom-4 left-0 right-0 text-center">
            <span className="text-xs text-accent/40 font-mono tracking-[0.3em] uppercase">
              Align QR
            </span>
          </div>
        </div>

        <div>
          <h1 className="text-2xl font-black tracking-tight mb-2">
            Vendor Check-In
          </h1>
          <p className="text-text-secondary text-sm">
            Scan the QR code at your assigned staging zone
          </p>
        </div>

        <button
          onClick={handleScan}
          className="action-btn bg-accent text-white border-accent text-lg"
          style={{ maxWidth: 320 }}
        >
          <Svg d={icons.scan} size={22} />
          Simulate QR Scan
        </button>

        <p className="text-xs text-text-secondary">
          Demo: taps a pending order automatically
        </p>
      </div>
    );
  }

  // ── Step: CHECKOFF (one item at a time) ──
  if (step === "checkoff" && order && item) {
    const deliveredCount = items.filter((i) => i.status !== null).length;
    const totalItems = items.length;

    return (
      <div className="flex-1 flex flex-col px-4">
        {/* Header: Job + Vendor */}
        <div className="py-4 border-b border-border">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-mono text-text-secondary bg-bg-surface px-3 py-1 rounded-full">
              {order.id}
            </span>
            <span className="text-xs text-text-secondary">
              Zone{" "}
              <strong className="text-accent font-mono">{order.zoneId}</strong>
            </span>
          </div>
          <h2 className="text-xl font-black tracking-tight truncate">
            {order.vendor}
          </h2>
          <p className="text-sm text-text-secondary truncate">
            {order.jobName} &middot; {order.jobNumber} / {order.siteNumber}
          </p>

          {/* Progress dots */}
          <div className="flex items-center gap-1.5 mt-3">
            {items.map((it, i) => {
              let cls = "progress-dot";
              if (i === itemIdx) cls += " current";
              else if (it.status === "Delivered") cls += " done";
              else if (it.status === "Damaged" || it.status === "Backordered")
                cls += " issue";
              return <div key={i} className={cls} />;
            })}
            <span className="text-[10px] text-text-secondary ml-2 font-mono">
              {deliveredCount}/{totalItems}
            </span>
          </div>
        </div>

        {/* Current Item */}
        <div
          key={item.id}
          className="flex-1 flex flex-col py-6 animate-slide-up"
        >
          {/* Item info */}
          <div className="mb-6">
            <p className="text-xs text-text-secondary uppercase tracking-widest font-bold mb-1">
              Item {itemIdx + 1} of {totalItems}
            </p>
            <h3 className="text-2xl font-black leading-tight">
              {item.description}
            </h3>
            <p className="text-lg text-text-secondary mt-1">
              Ordered:{" "}
              <strong className="text-text-primary">{item.quantity}</strong>
            </p>
          </div>

          {/* Quantity stepper */}
          <div className="flex items-center gap-3 mb-8">
            <button
              type="button"
              className="stepper-btn w-16 h-16"
              onClick={() => adjustQty(-1)}
              disabled={item.deliveredQty <= 0}
            >
              −
            </button>
            <div className="flex-1 flex items-center justify-center rounded-2xl border-3 border-accent/50 bg-bg-surface py-4">
              <span className="text-4xl font-black font-mono text-accent tabular-nums">
                {item.deliveredQty}
              </span>
              <span className="text-lg text-text-secondary ml-2">
                / {item.quantity}
              </span>
            </div>
            <button
              type="button"
              className="stepper-btn w-16 h-16"
              onClick={() => adjustQty(1)}
              disabled={item.deliveredQty >= item.quantity}
            >
              +
            </button>
          </div>

          {/* Quick-set buttons */}
          <div className="grid grid-cols-2 gap-2 mb-8">
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
                className={`tap-target rounded-xl border-2 px-3 py-3 text-sm font-bold transition-colors ${
                  item.deliveredQty === qty
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-border bg-bg-surface text-text-secondary hover:border-accent/40"
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
        <div className="pb-4 space-y-3">
          <button
            onClick={() => {
              updateItem("Delivered", item.quantity);
            }}
            className="action-btn action-btn-delivered"
          >
            <Svg d={icons.check} size={22} />
            Full Delivery
          </button>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => updateItem("Partial", item.deliveredQty || 0)}
              className="action-btn action-btn-partial text-sm"
            >
              <Svg d={icons.backorder} size={20} />
              Partial
            </button>
            <button
              onClick={() => updateItem("Damaged", 0)}
              className="action-btn action-btn-damaged text-sm"
            >
              <Svg d={icons.damaged} size={20} />
              Damaged
            </button>
          </div>
          <button
            onClick={() => updateItem("Backordered", 0)}
            className="action-btn action-btn-backordered text-sm"
          >
            <Svg d={icons.backorder} size={20} />
            Backordered
          </button>
        </div>

        {/* Next / Prev nav */}
        <div className="pb-6 flex items-center gap-3">
          {itemIdx > 0 ? (
            <button
              onClick={goPrev}
              className="tap-target flex items-center gap-2 rounded-xl border-2 border-border bg-bg-surface px-5 py-3 text-sm font-bold hover:border-accent/40 shrink-0"
            >
              <Svg d={icons.arrowLeft} size={18} />
              Prev
            </button>
          ) : (
            <div className="w-24 shrink-0" />
          )}
          <button
            onClick={goNext}
            className="tap-target flex-1 flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-4 text-base font-black text-white hover:bg-accent/90 transition-colors shadow-lg shadow-accent/10"
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
      <div className="flex-1 flex flex-col px-4">
        <div className="py-4 border-b border-border">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono text-text-secondary bg-bg-surface px-3 py-1 rounded-full">
              {order.id}
            </span>
          </div>
          <h2 className="text-xl font-black tracking-tight">{order.vendor}</h2>
          <p className="text-sm text-text-secondary">
            {order.jobName} &middot; Zone {order.zoneId}
          </p>
        </div>

        <div className="flex-1 py-4 space-y-3 overflow-y-auto">
          <h3 className="text-sm font-bold uppercase tracking-wider text-text-secondary">
            Review ({items.length} items)
          </h3>
          {items.map((it, i) => (
            <div
              key={it.id}
              onClick={() => {
                setItemIdx(i);
                setStep("checkoff");
              }}
              className="flex items-center gap-3 rounded-xl border border-border bg-bg-surface px-4 py-3 cursor-pointer hover:border-accent/30 transition-colors"
            >
              <div
                className={`size-3 rounded-full shrink-0 ${
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
                <p className="text-sm font-semibold truncate">
                  {it.description}
                </p>
                <p className="text-xs text-text-secondary">
                  {it.deliveredQty}/{it.quantity} &middot;{" "}
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
        <div className="flex flex-wrap gap-2 py-3 border-t border-border">
          <span className="status-pill bg-accent-green/15 text-accent-green border border-accent-green/20">
            {delivered} Delivered
          </span>
          {partial > 0 && (
            <span className="status-pill bg-accent-purple/15 text-accent-purple border border-accent-purple/20">
              {partial} Partial
            </span>
          )}
          {damaged > 0 && (
            <span className="status-pill bg-accent-red/15 text-accent-red border border-accent-red/20">
              {damaged} Damaged
            </span>
          )}
          {backordered > 0 && (
            <span className="status-pill bg-accent-amber/15 text-accent-amber border border-accent-amber/20">
              {backordered} Backordered
            </span>
          )}
        </div>

        {/* Note input toggle */}
        {hasIssues && !showNoteInput && (
          <button
            onClick={() => setShowNoteInput(true)}
            className="tap-target w-full rounded-xl border-2 border-amber-500/30 bg-amber-500/5 text-amber-400 px-4 py-3 text-sm font-bold mb-2"
          >
            Add explanation for missing/damaged items
          </button>
        )}
        {showNoteInput && (
          <textarea
            value={vendorNote}
            onChange={(e) => setVendorNote(e.target.value)}
            placeholder="Explain any missing, backordered, or damaged items…"
            rows={2}
            className="w-full rounded-xl border-2 border-border bg-bg-surface px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent mb-2 resize-none"
          />
        )}

        {/* Submit */}
        <div className="pb-6 pt-2">
          <button
            onClick={handleSubmit}
            className={`action-btn text-white ${
              allDelivered
                ? "bg-accent-green border-accent-green"
                : "bg-accent-amber border-accent-amber"
            }`}
          >
            <Svg d={icons.check} size={22} />
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
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-6">
        <div
          className={`size-20 rounded-full flex items-center justify-center ${
            allDelivered
              ? "bg-accent-green/20 animate-pulse-green"
              : "bg-accent-amber/20"
          }`}
        >
          <Svg d={icons.check} size={40} />
        </div>
        <div>
          <h2 className="text-2xl font-black mb-1">
            {allDelivered ? "Delivery Complete" : "Partial Delivery Submitted"}
          </h2>
          <p className="text-text-secondary">
            Order {order.id} &middot; {order.vendor}
          </p>
          <p className="text-xs text-text-secondary mt-2">
            Dispatch has been notified.
          </p>
        </div>
        <button
          onClick={handleReset}
          className="action-btn border-border bg-bg-surface text-text-primary text-base"
          style={{ maxWidth: 280 }}
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
      Pending: "bg-accent-amber/15 text-accent-amber border-accent-amber/20",
      Partial: "bg-accent-purple/15 text-accent-purple border-accent-purple/20",
      Complete: "bg-accent-green/15 text-accent-green border-accent-green/20",
    };
    return `status-pill border ${map[status]}`;
  };

  return (
    <div className="flex-1 flex flex-col px-4 overflow-y-auto">
      <div className="py-4">
        <h1 className="text-2xl font-black tracking-tight">Orders</h1>
        <div className="flex gap-3 mt-3">
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
              className="flex items-center gap-2 bg-bg-surface rounded-xl px-4 py-2"
            >
              <span className={`text-lg font-black ${s.color}`}>{s.count}</span>
              <span className="text-xs text-text-secondary">{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2 pb-6">
        {mockOrders.map((o) => (
          <div
            key={o.id}
            className="rounded-xl border border-border bg-bg-surface overflow-hidden"
          >
            <button
              onClick={() => setExpanded(expanded === o.id ? null : o.id)}
              className="w-full flex items-center gap-3 px-4 py-4 text-left tap-target"
            >
              <div
                className={`size-3 rounded-full shrink-0 ${
                  o.status === "Pending"
                    ? "bg-accent-amber"
                    : o.status === "Partial"
                      ? "bg-accent-purple"
                      : "bg-accent-green"
                }`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold truncate">{o.vendor}</span>
                  <span className={statusPill(o.status)}>{o.status}</span>
                </div>
                <p className="text-xs text-text-secondary truncate">
                  {o.jobName} &middot; Zone {o.zoneId} &middot; {o.items.length}{" "}
                  items
                </p>
              </div>
            </button>

            {expanded === o.id && (
              <div className="border-t border-border px-4 py-3 space-y-2 animate-slide-up">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-text-secondary">Job #</span>
                    <p className="font-mono font-bold">{o.jobNumber}</p>
                  </div>
                  <div>
                    <span className="text-text-secondary">Site #</span>
                    <p className="font-mono font-bold">{o.siteNumber}</p>
                  </div>
                  <div>
                    <span className="text-text-secondary">Zone</span>
                    <p className="font-mono font-bold text-accent">
                      {o.zoneId}
                    </p>
                  </div>
                  <div>
                    <span className="text-text-secondary">Created</span>
                    <p>{new Date(o.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
                <div className="space-y-1 pt-2">
                  <p className="text-xs font-bold text-text-secondary uppercase tracking-wider">
                    Items
                  </p>
                  {o.items.map((it) => (
                    <div
                      key={it.id}
                      className="flex items-center justify-between text-sm bg-bg-card rounded-lg px-3 py-2"
                    >
                      <span className="truncate flex-1 mr-2">
                        {it.description}
                      </span>
                      <span className="text-xs text-text-secondary shrink-0 tabular-nums">
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
    <div className="flex-1 flex flex-col px-4 overflow-y-auto">
      <div className="py-4 text-center">
        <h1 className="text-xl font-black tracking-widest text-accent uppercase">
          StageVerify
        </h1>
        <p className="text-xs text-text-secondary tracking-[0.2em] uppercase mt-1">
          Delivery Staging Board
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 pb-6">
        {stagingZones.map((zone) => {
          const order = displayOrders.find((o) => o.id === zone.currentOrderId);
          const statusColor =
            order?.status === "Pending"
              ? "border-accent-amber"
              : order?.status === "Partial"
                ? "border-accent-purple"
                : order?.status === "Complete"
                  ? "border-accent-green"
                  : "border-border";

          return (
            <div
              key={zone.id}
              className={`rounded-xl border-2 ${statusColor} bg-bg-surface p-4 ${
                !order ? "border-dashed opacity-40" : ""
              }`}
            >
              <span className="text-3xl font-black font-mono text-accent">
                {zone.id}
              </span>
              <p className="text-xs text-text-secondary">{zoneDesc(zone.id)}</p>
              {order ? (
                <>
                  <div className="h-px bg-border my-2" />
                  <p className="text-sm font-bold truncate">{order.vendor}</p>
                  <p className="text-xs text-text-secondary truncate">
                    {order.jobName}
                  </p>
                  <span
                    className={`status-pill mt-2 text-xs ${
                      order.status === "Pending"
                        ? "bg-accent-amber/15 text-accent-amber"
                        : order.status === "Partial"
                          ? "bg-accent-purple/15 text-accent-purple"
                          : "bg-accent-green/15 text-accent-green"
                    }`}
                  >
                    {order.status}
                  </span>
                </>
              ) : (
                <p className="text-xs text-text-secondary mt-3">Available</p>
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
    <div className="flex-1 flex flex-col px-4 overflow-y-auto">
      <div className="py-4 flex items-center justify-between">
        <h1 className="text-2xl font-black tracking-tight">Dispatch Log</h1>
        <span className="text-xs text-text-secondary bg-bg-surface rounded-lg px-3 py-1.5 font-mono">
          Read-Only
        </span>
      </div>

      <div className="space-y-2 pb-6">
        {mockConfirmations.map((log) => (
          <div
            key={log.id}
            className="rounded-xl border border-border bg-bg-surface overflow-hidden"
          >
            <button
              onClick={() => setExpanded(expanded === log.id ? null : log.id)}
              className="w-full flex items-center gap-3 px-4 py-4 text-left tap-target"
            >
              <div
                className={`size-3 rounded-full shrink-0 ${
                  log.status === "Complete"
                    ? "bg-accent-green"
                    : "bg-accent-purple"
                }`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm font-bold ${
                      log.status === "Complete"
                        ? "text-accent-green"
                        : "text-accent-purple"
                    }`}
                  >
                    {log.status}
                  </span>
                  <span className="text-xs text-text-secondary">
                    {log.orderId}
                  </span>
                </div>
                <p className="text-xs text-text-secondary truncate">
                  {log.vendor} &middot; {log.jobName} &middot; Zone {log.zoneId}
                </p>
              </div>
              <span className="text-[10px] text-text-secondary shrink-0">
                {new Date(log.confirmedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </button>

            {expanded === log.id && (
              <div className="border-t border-border px-4 py-3 space-y-2 animate-slide-up text-xs">
                <div className="grid grid-cols-2 gap-1">
                  <span className="text-text-secondary">Job / Site</span>
                  <span>
                    {log.jobName} / {log.siteNumber}
                  </span>
                  <span className="text-text-secondary">Time</span>
                  <span>{new Date(log.confirmedAt).toLocaleString()}</span>
                </div>
                <div className="space-y-1 pt-1">
                  <p className="text-text-secondary font-bold uppercase">
                    Items
                  </p>
                  {log.items.map((it) => (
                    <div
                      key={it.id}
                      className="flex items-center justify-between bg-bg-card rounded-lg px-3 py-1.5"
                    >
                      <span className="truncate flex-1 mr-2">
                        {it.description}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        <span
                          className={
                            it.deliveredQty < it.quantity
                              ? "text-accent-amber"
                              : "text-accent-green"
                          }
                        >
                          {it.deliveredQty}
                        </span>
                        /{it.quantity}
                        {it.missingQty > 0 && (
                          <span className="text-accent-red ml-1">
                            (-{it.missingQty})
                          </span>
                        )}
                        <span className="ml-1 text-text-secondary">
                          {it.status}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
                {log.vendorNote && (
                  <div className="border-t border-border pt-2 mt-1">
                    <p className="text-text-secondary font-bold mb-1">Note:</p>
                    <p className="italic">{log.vendorNote}</p>
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
   MAIN APP — bottom tab bar shell
   ================================================================ */
export default function App() {
  const [tab, setTab] = useState<Tab>("scan");

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "scan", label: "Scan In", icon: icons.scan },
    { id: "orders", label: "Orders", icon: icons.list },
    { id: "display", label: "Board", icon: icons.display },
    { id: "dispatch", label: "Dispatch", icon: icons.truck },
  ];

  return (
    <div className="app-container flex flex-col min-h-screen min-h-dvh bg-bg-primary">
      {/* Screen content */}
      {tab === "scan" && <ScanScreen />}
      {tab === "orders" && <OrdersScreen />}
      {tab === "display" && <DisplayScreen />}
      {tab === "dispatch" && <DispatchScreen />}

      {/* Bottom Tab Bar */}
      <nav className="bottom-nav">
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
