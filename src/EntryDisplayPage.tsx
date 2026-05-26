import { mockOrders, stagingZones, zoneNamingReference } from "./mockData";
import type { OrderStatus } from "./types";

/* ── Status helpers ── */
const statusColor = (status: OrderStatus): string => {
  const map: Record<OrderStatus, string> = {
    Pending: "text-accent-amber",
    Partial: "text-accent-purple",
    Complete: "text-accent-green",
  };
  return map[status];
};

const statusLabel = (status: OrderStatus): string => {
  return status.toUpperCase();
};

const zoneDescription = (zoneId: string): string => {
  return zoneNamingReference[zoneId] ?? zoneId;
};

/* ── Component ── */
export function EntryDisplayPage() {
  const activeZones = stagingZones.filter((z) => z.currentOrderId !== null);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-white/10 px-8 py-6 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-3xl font-black tracking-widest uppercase text-accent">
            StageVerify
          </h1>
          <p className="text-sm text-white/40 mt-1 uppercase tracking-[0.3em]">
            Delivery Staging Board
          </p>
        </div>
        <div className="text-right">
          <p className="text-xl font-mono text-white/70">
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
          <p className="text-sm text-white/30 mt-0.5">
            {new Date().toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
      </header>

      {/* Main Grid */}
      <main className="flex-1 p-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-7xl mx-auto">
          {activeZones.map((zone) => {
            const order = mockOrders.find((o) => o.id === zone.currentOrderId);
            if (!order) return null;

            return (
              <div
                key={zone.id}
                className="relative rounded-2xl border-2 border-white/10 bg-white/[0.03] p-6 flex flex-col"
              >
                {/* Zone location code - BIG */}
                <div className="flex items-baseline gap-3 mb-4">
                  <span className="text-6xl sm:text-7xl font-black font-mono tracking-tight text-accent">
                    {zone.id}
                  </span>
                  <span className="text-lg text-white/40 font-medium">
                    {zoneDescription(zone.id)}
                  </span>
                </div>

                <div className="h-px bg-gradient-to-r from-white/10 via-white/5 to-transparent mb-4" />

                {/* Destination info */}
                <div className="space-y-2 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl sm:text-3xl font-bold text-white">
                      {order.vendor}
                    </span>
                    <svg
                      className="size-5 text-accent shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 7l5 5m0 0l-5 5m5-5H6"
                      />
                    </svg>
                  </div>
                  <p className="text-xl text-white/50 font-medium">
                    {order.jobName}
                  </p>
                </div>

                {/* Status and order info */}
                <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className={`size-2.5 rounded-full ${
                        order.status === "Pending"
                          ? "bg-accent-amber"
                          : order.status === "Partial"
                            ? "bg-accent-purple"
                            : "bg-accent-green"
                      }`}
                    />
                    <span
                      className={`text-sm font-semibold uppercase tracking-wider ${statusColor(order.status)}`}
                    >
                      {statusLabel(order.status)}
                    </span>
                  </div>
                  <span className="text-xs text-white/30 font-mono">
                    {order.id}
                  </span>
                </div>

                {/* Qty info */}
                <div className="mt-2 text-xs text-white/30">
                  {order.items.length}{" "}
                  {order.items.length === 1 ? "item" : "items"}
                </div>
              </div>
            );
          })}

          {/* Available zones */}
          {stagingZones
            .filter((z) => z.currentOrderId === null)
            .map((zone) => (
              <div
                key={zone.id}
                className="rounded-2xl border-2 border-dashed border-white/[0.06] bg-transparent p-6 flex flex-col items-center justify-center text-center min-h-[200px]"
              >
                <span className="text-5xl font-black font-mono text-white/15 tracking-tight">
                  {zone.id}
                </span>
                <span className="text-sm text-white/20 mt-2 uppercase tracking-wider font-semibold">
                  Available
                </span>
                <span className="text-xs text-white/10 mt-1">
                  {zoneDescription(zone.id)}
                </span>
              </div>
            ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 px-8 py-3 flex items-center justify-between shrink-0">
        <p className="text-xs text-white/20">
          Scan QR code at your assigned zone to confirm delivery
        </p>
        <p className="text-xs text-white/15 font-mono">
          {activeZones.length} active &middot;{" "}
          {stagingZones.length - activeZones.length} available
        </p>
      </footer>
    </div>
  );
}
