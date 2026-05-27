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
    <div className="min-h-screen bg-bg-primary text-text-primary flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-8 py-6 flex items-center justify-between shrink-0 bg-bg-card">
        <div>
          <h1 className="text-3xl font-light tracking-widest uppercase text-text-primary">
            StageVerify
          </h1>
          <p className="text-[10px] text-text-secondary mt-2 uppercase tracking-[0.3em]">
            Delivery Staging Board
          </p>
        </div>
        <div className="text-right">
          <p className="text-xl font-light font-mono text-text-primary">
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
          <p className="text-sm text-text-secondary mt-1 font-mono">
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
                className="relative rounded-2xl border border-border bg-bg-card p-8 flex flex-col shadow-lg"
              >
                {/* Zone location code - BIG */}
                <div className="flex items-baseline gap-4 mb-6">
                  <span className="text-6xl sm:text-7xl font-light font-mono tracking-tight text-text-primary">
                    {zone.id}
                  </span>
                  <span className="text-sm text-text-secondary uppercase tracking-widest">
                    {zoneDescription(zone.id)}
                  </span>
                </div>

                <div className="h-px bg-border mb-6" />

                {/* Destination info */}
                <div className="space-y-2 flex-1">
                  <div className="flex items-baseline gap-3">
                    <span className="text-2xl sm:text-3xl font-medium text-text-primary">
                      {order.vendor}
                    </span>
                    <svg
                      className="size-5 text-text-secondary shrink-0"
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
                  <p className="text-xl text-text-secondary font-light">
                    {order.jobName}
                  </p>
                </div>

                {/* Status and order info */}
                <div className="mt-8 pt-6 border-t border-border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className={`size-2 rounded-full ${
                        order.status === "Pending"
                          ? "bg-accent-amber"
                          : order.status === "Partial"
                            ? "bg-accent-purple"
                            : "bg-accent-green"
                      }`}
                    />
                    <span
                      className={`text-[10px] font-medium uppercase tracking-widest ${statusColor(order.status)}`}
                    >
                      {statusLabel(order.status)}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-text-secondary font-mono block mb-1">
                      {order.id}
                    </span>
                    <span className="text-[10px] text-text-secondary uppercase tracking-widest">
                      {order.items.length}{" "}
                      {order.items.length === 1 ? "item" : "items"}
                    </span>
                  </div>
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
                className="rounded-2xl border border-dashed border-border bg-bg-surface/30 p-8 flex flex-col items-center justify-center text-center min-h-[240px]"
              >
                <span className="text-5xl font-light font-mono text-text-secondary/50 tracking-tight">
                  {zone.id}
                </span>
                <span className="text-[10px] text-text-secondary mt-4 uppercase tracking-widest">
                  Available
                </span>
                <span className="text-xs text-text-secondary/50 mt-2">
                  {zoneDescription(zone.id)}
                </span>
              </div>
            ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border px-8 py-4 flex items-center justify-between shrink-0 bg-bg-card">
        <p className="text-[10px] text-text-secondary uppercase tracking-widest">
          Scan QR code at your assigned zone to confirm delivery
        </p>
        <p className="text-[10px] text-text-secondary font-mono uppercase tracking-widest">
          {activeZones.length} active &middot;{" "}
          {stagingZones.length - activeZones.length} available
        </p>
      </footer>
    </div>
  );
}
