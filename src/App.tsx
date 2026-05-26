import { useState, type ReactNode } from "react";
import { mockOrders, stagingZones, mockConfirmations } from "./mockData";
import type { Order, OrderStatus, ItemStatus } from "./types";

/* ── Helpers ── */
const statusBadge = (status: OrderStatus) => {
  const map: Record<OrderStatus, string> = {
    Pending:
      "bg-accent-amber/15 text-accent-amber border border-accent-amber/30",
    Partial:
      "bg-accent-purple/15 text-accent-purple border border-accent-purple/30",
    Complete:
      "bg-accent-green/15 text-accent-green border border-accent-green/30",
  };
  return `inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider ${map[status]}`;
};

const itemStatusBadge = (status: ItemStatus) => {
  const map: Record<ItemStatus, string> = {
    Delivered:
      "bg-accent-green/15 text-accent-green border border-accent-green/30",
    Partial:
      "bg-accent-purple/15 text-accent-purple border border-accent-purple/30",
    Backordered:
      "bg-accent-amber/15 text-accent-amber border border-accent-amber/30",
    Damaged: "bg-accent-red/15 text-accent-red border border-accent-red/30",
  };
  return `inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${map[status]}`;
};

const statusDot = (status: OrderStatus) => {
  const map: Record<OrderStatus, string> = {
    Pending: "bg-accent-amber",
    Partial: "bg-accent-purple",
    Complete: "bg-accent-green",
  };
  return `size-2 rounded-full ${map[status]}`;
};

const counts = () => {
  let pending = 0,
    partial = 0,
    complete = 0;
  for (const o of mockOrders) {
    if (o.status === "Pending") pending++;
    else if (o.status === "Partial") partial++;
    else complete++;
  }
  return { pending, partial, complete, total: pending + partial + complete };
};

const zoneStatusColor = (zoneId: string) => {
  const zone = stagingZones.find((z) => z.id === zoneId);
  if (!zone || !zone.currentOrderId) return "bg-gray-600";
  const order = mockOrders.find((o) => o.id === zone.currentOrderId);
  if (!order) return "bg-gray-600";
  if (order.status === "Pending") return "bg-accent-amber";
  if (order.status === "Partial") return "bg-accent-purple";
  return "bg-accent-green";
};

const zoneStatusLabel = (zoneId: string) => {
  const zone = stagingZones.find((z) => z.id === zoneId);
  if (!zone || !zone.currentOrderId) return "Available";
  const order = mockOrders.find((o) => o.id === zone.currentOrderId);
  return order?.status ?? "Available";
};

/* ── Icons (inline SVGs) ── */
const Icon = ({ name }: { name: string }) => {
  const paths: Record<string, ReactNode> = {
    dashboard: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z"
      />
    ),
    orders: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
      />
    ),
    display: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
      />
    ),
    zones: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
      />
    ),
    checkin: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 4v1m6 11h2m-6 0h-2.48a2.504 2.504 0 01-2.22-1.34l-.6-1.2M12 4a8 8 0 100 16 8 8 0 000-16zm0 0v4m0 4h.01"
      />
    ),
    dispatch: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
      />
    ),
    plus: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 4v16m8-8H4"
      />
    ),
    truck: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 17a2 2 0 11-4 0 2 2 0 014 0zm10 0a2 2 0 11-4 0 2 2 0 014 0zM13 17V6m0 0l4 4m-4-4L9 10m4 7h4"
      />
    ),
    clipboard: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
      />
    ),
    mail: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
      />
    ),
  };
  return (
    <svg
      className="size-5 shrink-0"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      {paths[name]}
    </svg>
  );
};

/* ── Navigation ── */
type Section =
  | "dashboard"
  | "activeOrders"
  | "entryDisplay"
  | "stagingZones"
  | "vendorCheckIn"
  | "dispatchStatus";

const navItems: { id: Section; label: string; icon: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "activeOrders", label: "Active Orders", icon: "orders" },
  { id: "entryDisplay", label: "Entry Display", icon: "display" },
  { id: "stagingZones", label: "Staging Zones", icon: "zones" },
  { id: "vendorCheckIn", label: "Vendor Check-In", icon: "checkin" },
  { id: "dispatchStatus", label: "Dispatch Status", icon: "dispatch" },
];

/* ── Dashboard ── */
function Dashboard() {
  const c = counts();
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <span className="text-sm text-text-secondary">
          {new Date().toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </span>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Orders", value: c.total, color: "text-accent" },
          {
            label: "Pending",
            value: c.pending,
            color: "text-accent-amber",
          },
          {
            label: "Partial",
            value: c.partial,
            color: "text-accent-purple",
          },
          {
            label: "Complete",
            value: c.complete,
            color: "text-accent-green",
          },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-border bg-bg-card p-5"
          >
            <p className="text-xs font-medium uppercase tracking-widest text-text-secondary">
              {card.label}
            </p>
            <p className={`mt-2 text-3xl font-bold ${card.color}`}>
              {card.value}
            </p>
          </div>
        ))}
      </div>

      {/* Recent Orders */}
      <div className="rounded-xl border border-border bg-bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider">
            Active Orders
          </h2>
          <span className="text-xs text-text-secondary">
            Tap an order for details
          </span>
        </div>
        <div className="divide-y divide-border">
          {mockOrders.map((o) => (
            <div
              key={o.id}
              className="flex items-center gap-4 px-5 py-3.5 hover:bg-white/[0.02] transition-colors cursor-pointer"
            >
              <div className={statusDot(o.status)} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">
                    {o.vendor}
                  </span>
                  <span className={statusBadge(o.status)}>{o.status}</span>
                </div>
                <p className="text-xs text-text-secondary mt-0.5 truncate">
                  {o.jobName} &middot; {o.jobNumber} &middot; Zone {o.zoneId}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-text-secondary">
                  {o.items.length} items
                </p>
                <p className="text-xs text-text-secondary">
                  {new Date(o.createdAt).toLocaleDateString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Active Orders ── */
function ActiveOrders() {
  const [selected, setSelected] = useState<Order | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Active Orders</h1>
        <button className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 transition-colors">
          <Icon name="plus" />
          Create Order
        </button>
      </div>

      <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wider text-text-secondary">
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Order ID</th>
                <th className="px-5 py-3">Vendor</th>
                <th className="px-5 py-3">Job / Site</th>
                <th className="px-5 py-3">Zone</th>
                <th className="px-5 py-3">Items</th>
                <th className="px-5 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {mockOrders.map((o) => (
                <tr
                  key={o.id}
                  className={`hover:bg-white/[0.02] transition-colors cursor-pointer ${
                    selected?.id === o.id ? "bg-white/[0.04]" : ""
                  }`}
                  onClick={() => setSelected(selected?.id === o.id ? null : o)}
                >
                  <td className="px-5 py-3">
                    <span className={statusBadge(o.status)}>{o.status}</span>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs">{o.id}</td>
                  <td className="px-5 py-3">{o.vendor}</td>
                  <td className="px-5 py-3">
                    <p className="font-medium">{o.jobName}</p>
                    <p className="text-xs text-text-secondary">
                      {o.jobNumber} / {o.siteNumber}
                    </p>
                  </td>
                  <td className="px-5 py-3 font-mono font-bold text-accent">
                    {o.zoneId}
                  </td>
                  <td className="px-5 py-3">{o.items.length}</td>
                  <td className="px-5 py-3 text-text-secondary text-xs">
                    {new Date(o.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selected && (
          <div className="border-t border-border p-5">
            <h3 className="font-semibold mb-3">
              {selected.id} — {selected.vendor}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
              <div>
                <p className="text-xs text-text-secondary uppercase tracking-wider">
                  Job Name
                </p>
                <p className="text-sm">{selected.jobName}</p>
              </div>
              <div>
                <p className="text-xs text-text-secondary uppercase tracking-wider">
                  Job #
                </p>
                <p className="text-sm font-mono">{selected.jobNumber}</p>
              </div>
              <div>
                <p className="text-xs text-text-secondary uppercase tracking-wider">
                  Site #
                </p>
                <p className="text-sm font-mono">{selected.siteNumber}</p>
              </div>
              <div>
                <p className="text-xs text-text-secondary uppercase tracking-wider">
                  Zone
                </p>
                <p className="text-sm font-mono font-bold text-accent">
                  {selected.zoneId}
                </p>
              </div>
            </div>
            <div>
              <p className="text-xs text-text-secondary uppercase tracking-wider mb-2">
                Line Items
              </p>
              <div className="space-y-1.5">
                {selected.items.map((it) => (
                  <div
                    key={it.id}
                    className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <div className="flex-1">
                      <span>{it.description}</span>
                      <span className="text-text-secondary ml-2">
                        Qty: {it.quantity}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-text-secondary">
                      {it.status !== null && (
                        <>
                          <span>Delivered: {it.deliveredQty}</span>
                          <span className={itemStatusBadge(it.status)}>
                            {it.status}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Entry Display Board ── */
function EntryDisplay() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">
          Entry Display Board
        </h1>
        <span className="text-xs text-text-secondary bg-bg-card border border-border rounded-lg px-3 py-1.5 font-mono">
          Live Preview
        </span>
      </div>

      {/* Simulated display board */}
      <div className="rounded-xl border-2 border-accent/40 bg-black p-8 shadow-lg shadow-accent/5">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-black tracking-widest text-accent uppercase">
            StageVerify
          </h2>
          <p className="text-text-secondary text-sm mt-1">
            Delivery Staging Board
          </p>
          <div className="mx-auto mt-4 h-px w-32 bg-gradient-to-r from-transparent via-accent/40 to-transparent" />
        </div>

        <div className="grid grid-cols-3 gap-4">
          {stagingZones.map((zone) => {
            const order = mockOrders.find((o) => o.id === zone.currentOrderId);
            return (
              <div
                key={zone.id}
                className="rounded-lg border border-border bg-bg-card/80 p-4 text-center"
              >
                <p
                  className={`text-lg font-black font-mono ${
                    order ? "text-accent" : "text-text-secondary"
                  }`}
                >
                  {zone.id}
                </p>
                <p className="text-xs text-text-secondary mt-1">
                  {zone.description}
                </p>
                {order ? (
                  <div className="mt-3 pt-3 border-t border-border">
                    <p className="text-sm font-semibold truncate">
                      {order.vendor}
                    </p>
                    <p className="text-xs text-text-secondary truncate">
                      {order.jobName}
                    </p>
                    <span className={statusBadge(order.status)}>
                      {order.status}
                    </span>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-accent-green font-semibold uppercase tracking-wider">
                    Available
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-center text-xs text-text-secondary mt-6">
          Scan QR code at your assigned zone to confirm delivery
        </p>
      </div>

      <p className="text-xs text-text-secondary bg-bg-card border border-border rounded-lg p-3">
        This board would be displayed on a large monitor at the shop entrance.
        Zone assignments update automatically as dispatchers create orders.
      </p>
    </div>
  );
}

/* ── Staging Zones ── */
function StagingZones() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Staging Zones</h1>
        <span className="text-xs text-text-secondary">
          {stagingZones.length} zones configured
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stagingZones.map((zone) => {
          const order = mockOrders.find((o) => o.id === zone.currentOrderId);
          return (
            <div
              key={zone.id}
              className="rounded-xl border border-border bg-bg-card overflow-hidden"
            >
              <div className="p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className={`size-10 rounded-lg flex items-center justify-center font-black font-mono text-lg ${
                      order
                        ? "bg-accent/20 text-accent"
                        : "bg-gray-700/50 text-text-secondary"
                    }`}
                  >
                    {zone.id}
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{zone.label}</p>
                    <p className="text-xs text-text-secondary">
                      {zone.description}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div
                    className={`size-2.5 rounded-full ${zoneStatusColor(zone.id)}`}
                  />
                  <span className="text-xs font-medium">
                    {zoneStatusLabel(zone.id)}
                  </span>
                </div>

                {order && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <p className="text-xs text-text-secondary">Active Order</p>
                    <p className="text-sm font-medium">{order.vendor}</p>
                    <p className="text-xs text-text-secondary">
                      {order.jobName}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {order.items.slice(0, 3).map((it) => (
                        <span
                          key={it.id}
                          className="text-[10px] bg-bg-secondary text-text-secondary rounded px-2 py-0.5 truncate max-w-[180px]"
                        >
                          {it.description}
                        </span>
                      ))}
                      {order.items.length > 3 && (
                        <span className="text-[10px] text-text-secondary">
                          +{order.items.length - 3} more
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* QR Code Placeholder */}
                <div className="mt-4 flex justify-center">
                  <div className="size-20 rounded-lg border-2 border-dashed border-border flex items-center justify-center bg-bg-secondary">
                    <span className="text-[10px] text-text-secondary text-center leading-tight">
                      QR
                      <br />
                      Code
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Vendor Check-In ── */
function VendorCheckIn() {
  const [selectedZone, setSelectedZone] = useState<string>("G21");
  const [step, setStep] = useState<"select" | "checkoff" | "done">("select");
  const [vendorNote, setVendorNote] = useState("");

  const order = mockOrders.find(
    (o) => o.zoneId === selectedZone && o.status === "Pending",
  );
  const [items, setItems] = useState(order?.items ?? []);

  const handleDeliveredQty = (itemId: string, value: string) => {
    const num = parseInt(value, 10);
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it;
        const clamped = isNaN(num)
          ? 0
          : Math.max(0, Math.min(num, it.quantity));
        const missingQty = it.quantity - clamped;
        // Auto-set status based on quantity rules
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
      prev.map((it) => (it.id === itemId ? { ...it, status } : it)),
    );
  };

  const anyMissingOrPartial = items.some(
    (it) =>
      it.status === "Partial" ||
      it.status === "Backordered" ||
      it.status === "Damaged" ||
      it.missingQty > 0,
  );

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
    setStep("select");
    setVendorNote("");
    setItems(
      order?.items.map((it) => ({
        ...it,
        deliveredQty: 0,
        missingQty: 0,
        status: null,
      })) ?? [],
    );
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Vendor Check-In</h1>
      <p className="text-sm text-text-secondary">
        Simulates the vendor scanning a zone QR code and confirming delivered
        quantities per item.
      </p>

      {step === "select" && (
        <div className="rounded-xl border border-border bg-bg-card p-6">
          <h2 className="text-lg font-semibold mb-4">Step 1 — Select Zone</h2>
          <div className="grid grid-cols-3 gap-3 mb-6">
            {stagingZones.map((zone) => {
              const hasPending = mockOrders.some(
                (o) => o.zoneId === zone.id && o.status === "Pending",
              );
              return (
                <button
                  key={zone.id}
                  onClick={() => {
                    setSelectedZone(zone.id);
                  }}
                  className={`rounded-lg border p-4 text-center transition-colors ${
                    selectedZone === zone.id
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border bg-bg-secondary hover:border-accent/40"
                  } ${!hasPending ? "opacity-40" : ""}`}
                  disabled={!hasPending}
                >
                  <p className="text-2xl font-black font-mono">{zone.id}</p>
                  <p className="text-xs text-text-secondary mt-1">
                    {zone.description}
                  </p>
                  {!hasPending && (
                    <p className="text-[10px] text-text-secondary mt-1">
                      No pending orders
                    </p>
                  )}
                </button>
              );
            })}
          </div>
          <button
            onClick={() => {
              const o = mockOrders.find(
                (o2) => o2.zoneId === selectedZone && o2.status === "Pending",
              );
              if (o) {
                setItems(
                  o.items.map((it) => ({
                    ...it,
                    deliveredQty: 0,
                    missingQty: 0,
                    status: null,
                  })),
                );
                setStep("checkoff");
              }
            }}
            disabled={
              !mockOrders.some(
                (o) => o.zoneId === selectedZone && o.status === "Pending",
              )
            }
            className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Continue to Check-Off
          </button>
        </div>
      )}

      {step === "checkoff" && order && (
        <div className="rounded-xl border border-border bg-bg-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Step 2 — Item Check-Off</h2>
              <p className="text-sm text-text-secondary">
                Zone {order.zoneId} &middot; {order.vendor} &middot;{" "}
                {order.jobName}
              </p>
            </div>
            <span className="font-mono text-xs bg-bg-secondary px-3 py-1 rounded border border-border">
              {order.id}
            </span>
          </div>

          <div className="space-y-3 mb-6">
            {items.map((item) => (
              <div
                key={item.id}
                className="rounded-lg border border-border bg-bg-secondary p-4"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium">{item.description}</p>
                    <p className="text-xs text-text-secondary">
                      Quantity ordered: <strong>{item.quantity}</strong>
                    </p>
                  </div>
                  <span className={itemStatusBadge(item.status ?? "Partial")}>
                    {item.status ?? "—"}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-3 mb-3">
                  {/* Quantity Delivered */}
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-text-secondary mb-1">
                      Qty Delivered
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={item.quantity}
                      value={item.deliveredQty}
                      onChange={(e) =>
                        handleDeliveredQty(item.id, e.target.value)
                      }
                      className="w-full rounded-lg border border-border bg-bg-card px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors"
                    />
                  </div>

                  {/* Quantity Missing (auto-calculated) */}
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-text-secondary mb-1">
                      Qty Missing
                    </label>
                    <div className="w-full rounded-lg border border-border bg-bg-card/60 px-3 py-2 text-sm text-text-secondary">
                      {item.missingQty}
                    </div>
                  </div>

                  {/* Status Selector */}
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-text-secondary mb-1">
                      Status
                    </label>
                    <select
                      value={item.status ?? ""}
                      onChange={(e) =>
                        handleStatusChange(
                          item.id,
                          e.target.value as ItemStatus,
                        )
                      }
                      className="w-full rounded-lg border border-border bg-bg-card px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors"
                    >
                      <option value="" disabled>
                        Select status
                      </option>
                      <option value="Delivered">Delivered</option>
                      <option value="Partial">Partial</option>
                      <option value="Backordered">Backordered</option>
                      <option value="Damaged">Damaged</option>
                    </select>
                  </div>
                </div>

                {/* Validation hints */}
                {item.deliveredQty > item.quantity && (
                  <p className="text-xs text-accent-red mt-1">
                    Delivered quantity cannot exceed ordered quantity (
                    {item.quantity}).
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Vendor Note */}
          <div className="mb-6">
            <label className="block text-sm font-medium mb-2">
              Delivery notes / missing item explanation
            </label>
            <textarea
              value={vendorNote}
              onChange={(e) => setVendorNote(e.target.value)}
              placeholder="Explain any missing, backordered, or damaged items…"
              rows={3}
              className="w-full rounded-lg border border-border bg-bg-secondary px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors resize-none"
            />
          </div>

          {/* Summary */}
          <div className="rounded-lg border border-border bg-bg-secondary p-3 mb-6">
            <p className="text-xs text-text-secondary mb-1">
              Overall Order Status
            </p>
            <span className={statusBadge(overallStatus)}>{overallStatus}</span>
            {anyMissingOrPartial && (
              <p className="text-xs text-text-secondary mt-2">
                This order has items that are not fully delivered.
              </p>
            )}
          </div>

          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {canSubmit
              ? overallStatus === "Complete"
                ? "Submit Confirmation (Complete)"
                : "Submit Confirmation (Partial)"
              : "Select a status for each item to continue"}
          </button>
        </div>
      )}

      {step === "done" && (
        <div className="rounded-xl border border-accent-green/30 bg-accent-green/5 p-8 text-center">
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
          <h2 className="text-xl font-bold mb-2">Confirmation Submitted</h2>
          <p className="text-text-secondary mb-2">
            Order {order?.id} has been marked as{" "}
            <strong
              className={
                overallStatus === "Partial"
                  ? "text-accent-purple"
                  : "text-accent-green"
              }
            >
              {overallStatus}
            </strong>
          </p>
          <p className="text-xs text-text-secondary">
            Dispatch has been notified. A confirmation log entry has been
            created.
          </p>
          <button
            onClick={handleReset}
            className="mt-6 rounded-lg border border-border bg-bg-card px-4 py-2 text-sm font-medium hover:bg-bg-secondary transition-colors"
          >
            New Check-In
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Dispatch Status ── */
function DispatchStatus() {
  const [selectedLog, setSelectedLog] = useState<number | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Dispatch Status</h1>
        <span className="text-xs text-text-secondary bg-bg-card border border-border rounded-lg px-3 py-1.5 font-mono">
          Read-Only
        </span>
      </div>

      {/* Confirmation Feed */}
      <div className="rounded-xl border border-border bg-bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider">
            Confirmation Log
          </h2>
          <span className="text-xs text-text-secondary">
            Latest confirmations — click a log to preview the email
          </span>
        </div>
        <div className="divide-y divide-border">
          {mockConfirmations.map((log, idx) => (
            <div
              key={log.id}
              onClick={() => setSelectedLog(selectedLog === idx ? null : idx)}
              className={`px-5 py-4 cursor-pointer hover:bg-white/[0.02] transition-colors ${
                selectedLog === idx ? "bg-white/[0.04]" : ""
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Icon name="mail" />
                    <span
                      className={`text-sm font-semibold ${
                        log.status === "Complete"
                          ? "text-accent-green"
                          : "text-accent-purple"
                      }`}
                    >
                      {log.status} Delivery
                    </span>
                    <span className="text-xs text-text-secondary">
                      {log.orderId}
                    </span>
                  </div>
                  <p className="text-sm">{log.vendor}</p>
                  <p className="text-xs text-text-secondary">
                    {log.jobName} &middot; Zone {log.zoneId}
                  </p>
                </div>
                <span className="text-xs text-text-secondary">
                  {new Date(log.confirmedAt).toLocaleString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Email Notification Preview */}
      {selectedLog !== null &&
        (() => {
          const log = mockConfirmations[selectedLog];
          return (
            <div className="rounded-xl border border-border bg-bg-card p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wider mb-4">
                Email Notification Preview
              </h2>
              <div className="rounded-lg border border-border bg-bg-secondary p-5 font-mono text-xs text-text-secondary space-y-2">
                <div className="flex gap-2">
                  <span className="text-text-primary shrink-0">From:</span>
                  <span>stageverify@example.com</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-text-primary shrink-0">To:</span>
                  <span>dispatch@example.com</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-text-primary shrink-0">Subject:</span>
                  <span>
                    Delivery Confirmation — {log.orderId} ({log.status})
                  </span>
                </div>
                <div className="border-t border-border my-2 pt-3 space-y-2">
                  <div className="grid grid-cols-2 gap-y-1">
                    <span className="text-text-primary">Order:</span>
                    <span>{log.orderId}</span>

                    <span className="text-text-primary">Vendor:</span>
                    <span>{log.vendor}</span>

                    <span className="text-text-primary">Job / Site:</span>
                    <span>
                      {log.jobName} / {log.siteNumber}
                    </span>

                    <span className="text-text-primary">Zone:</span>
                    <span>{log.zoneId}</span>

                    <span className="text-text-primary">Status:</span>
                    <span
                      className={
                        log.status === "Complete"
                          ? "text-accent-green font-semibold"
                          : "text-accent-purple font-semibold"
                      }
                    >
                      {log.status.toUpperCase()}
                    </span>

                    <span className="text-text-primary">Time:</span>
                    <span>{new Date(log.confirmedAt).toLocaleString()}</span>
                  </div>

                  {/* Items table */}
                  <div className="border-t border-border pt-2 mt-2">
                    <p className="text-text-primary font-semibold mb-2">
                      Item Details:
                    </p>
                    <div className="space-y-1.5">
                      {log.items.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between bg-bg-card rounded px-3 py-1.5"
                        >
                          <span className="text-text-primary truncate flex-1 mr-3">
                            {item.description}
                          </span>
                          <div className="flex items-center gap-3 text-[11px] shrink-0">
                            <span>
                              <span className="text-text-secondary">Ord:</span>{" "}
                              {item.quantity}
                            </span>
                            <span>
                              <span className="text-text-secondary">Del:</span>{" "}
                              <span
                                className={
                                  item.deliveredQty < item.quantity
                                    ? "text-accent-amber"
                                    : "text-accent-green"
                                }
                              >
                                {item.deliveredQty}
                              </span>
                            </span>
                            <span>
                              <span className="text-text-secondary">Miss:</span>{" "}
                              <span
                                className={
                                  item.missingQty > 0 ? "text-accent-red" : ""
                                }
                              >
                                {item.missingQty}
                              </span>
                            </span>
                            <span
                              className={
                                item.status === "Delivered"
                                  ? "text-accent-green"
                                  : item.status === "Partial"
                                    ? "text-accent-purple"
                                    : item.status === "Backordered"
                                      ? "text-accent-amber"
                                      : "text-accent-red"
                              }
                            >
                              {item.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Vendor note */}
                  {log.vendorNote && (
                    <div className="border-t border-border pt-2 mt-2">
                      <p className="text-text-primary font-semibold mb-1">
                        Vendor Note:
                      </p>
                      <p className="italic">{log.vendorNote}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}

/* ── Main App ── */
export default function App() {
  const [activeSection, setActiveSection] = useState<Section>("dashboard");

  const renderSection = () => {
    switch (activeSection) {
      case "dashboard":
        return <Dashboard />;
      case "activeOrders":
        return <ActiveOrders />;
      case "entryDisplay":
        return <EntryDisplay />;
      case "stagingZones":
        return <StagingZones />;
      case "vendorCheckIn":
        return <VendorCheckIn />;
      case "dispatchStatus":
        return <DispatchStatus />;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-bg-primary">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 border-r border-border bg-bg-sidebar flex flex-col">
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-border">
          <div className="size-9 rounded-lg bg-accent flex items-center justify-center">
            <svg
              className="size-5 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
              />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight leading-tight">
              StageVerify
            </h1>
            <p className="text-[10px] text-text-secondary uppercase tracking-wider">
              HVAC Staging
            </p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors text-left ${
                activeSection === item.id
                  ? "bg-accent/15 text-accent"
                  : "text-text-secondary hover:text-text-primary hover:bg-white/[0.04]"
              }`}
            >
              <Icon name={item.icon} />
              {item.label}
            </button>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-border px-5 py-3">
          <p className="text-[10px] text-text-secondary">
            StageVerify MVP v0.1
          </p>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-8">{renderSection()}</main>
    </div>
  );
}
