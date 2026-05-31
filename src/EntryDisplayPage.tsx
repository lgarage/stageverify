import { useEffect, useState } from "react";
import {
  deliveryOrders,
  items,
  stagingLocations,
  vendors,
  jobs,
} from "./dispatcher/mockData";
import type { DeliveryStatus } from "./dispatcher/models";

function getDisplayData() {
  const activeEntries = stagingLocations
    .filter((loc) => loc.active)
    .flatMap((loc) => {
      const delivery = deliveryOrders.find(
        (d) => d.stagingLocationId === loc.id && d.status !== "picked_up",
      );
      if (!delivery) return [];
      const vendor = vendors.find((v) => v.id === delivery.vendorId);
      const job = jobs.find((j) => j.id === delivery.jobId);
      const itemCount = items.filter(
        (i) => i.deliveryOrderId === delivery.id,
      ).length;
      return [{ loc, delivery, vendor, job, itemCount }];
    });

  const availableLocs = stagingLocations.filter(
    (loc) =>
      loc.active &&
      !deliveryOrders.some(
        (d) => d.stagingLocationId === loc.id && d.status !== "picked_up",
      ),
  );

  return { activeEntries, availableLocs };
}

const statusDotColor = (status: DeliveryStatus): string => {
  const map: Record<DeliveryStatus, string> = {
    pending: "bg-accent-amber",
    arrived: "bg-accent",
    partial: "bg-accent-purple",
    complete: "bg-accent-green",
    issue: "bg-accent-red",
    picked_up: "bg-text-secondary",
  };
  return map[status] ?? "bg-text-secondary";
};

const statusTextColor = (status: DeliveryStatus): string => {
  const map: Record<DeliveryStatus, string> = {
    pending: "text-accent-amber",
    arrived: "text-accent",
    partial: "text-accent-purple",
    complete: "text-accent-green",
    issue: "text-accent-red",
    picked_up: "text-text-secondary",
  };
  return map[status] ?? "text-text-secondary";
};

const statusLabel = (status: DeliveryStatus): string =>
  status.replace("_", " ").toUpperCase();

/* ── Component ── */
export function EntryDisplayPage() {
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [tick, setTick] = useState(0);
  const { activeEntries, availableLocs } = getDisplayData();
  void tick;

  useEffect(() => {
    const updateCurrentTime = () => {
      setCurrentTime(new Date());
      setTick((t) => t + 1);
    };

    const intervalId = window.setInterval(updateCurrentTime, 30_000);
    return () => window.clearInterval(intervalId);
  }, []);

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
            {currentTime.toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
          <p className="text-sm text-text-secondary mt-1 font-mono">
            {currentTime.toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
      </header>

      {/* Main Grid */}
      <main className="flex-1 p-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-7xl mx-auto">
          {activeEntries.map((entry) => {
            return (
              <div
                key={entry.loc.id}
                className="relative rounded-2xl border border-border bg-bg-card p-8 flex flex-col shadow-lg"
              >
                {/* Zone location code - BIG */}
                <div className="flex items-baseline gap-4 mb-6">
                  <span className="text-6xl sm:text-7xl font-light font-mono tracking-tight text-text-primary">
                    {entry.loc.code}
                  </span>
                  <span className="text-sm text-text-secondary uppercase tracking-widest">
                    {entry.loc.label}
                  </span>
                </div>

                <div className="h-px bg-border mb-6" />

                {/* Destination info */}
                <div className="space-y-2 flex-1">
                  <div className="flex items-baseline gap-3">
                    <span className="text-2xl sm:text-3xl font-medium text-text-primary">
                      {entry.vendor?.name ?? "Unknown Vendor"}
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
                    {entry.job?.jobName ?? ""}
                  </p>
                </div>

                {/* Status and order info */}
                <div className="mt-8 pt-6 border-t border-border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className={`size-2 rounded-full ${statusDotColor(entry.delivery.status)}`}
                    />
                    <span
                      className={`text-[10px] font-medium uppercase tracking-widest ${statusTextColor(entry.delivery.status)}`}
                    >
                      {statusLabel(entry.delivery.status)}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-text-secondary font-mono block mb-1">
                      {entry.delivery.orderNumber}
                    </span>
                    <span className="text-[10px] text-text-secondary uppercase tracking-widest">
                      {entry.itemCount}{" "}
                      {entry.itemCount === 1 ? "item" : "items"}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Available zones */}
          {availableLocs.map((loc) => (
              <div
                key={loc.id}
                className="rounded-2xl border border-dashed border-border bg-bg-surface/30 p-8 flex flex-col items-center justify-center text-center min-h-[240px]"
              >
                <span className="text-5xl font-light font-mono text-text-secondary/50 tracking-tight">
                  {loc.code}
                </span>
                <span className="text-[10px] text-text-secondary mt-4 uppercase tracking-widest">
                  Available
                </span>
                <span className="text-xs text-text-secondary/50 mt-2">
                  {loc.label}
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
          {activeEntries.length} active &middot; {availableLocs.length} available
        </p>
      </footer>
    </div>
  );
}
