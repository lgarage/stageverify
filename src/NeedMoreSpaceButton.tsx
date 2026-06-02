import { useCallback, useEffect, useState } from "react";
import {
  addStagingLocation,
  firestoreDataService,
  mapOccupancyByLocationId,
} from "./dispatcher/firestoreService";
import {
  type DeliveryOrder,
  type StagingLocation,
} from "./dispatcher/models";
import {
  isStagingLocationOccupiedError,
  recommendNeedMoreSpaceSpots,
} from "./dispatcher/stagingOccupancy";

type FlowState = "idle" | "suggesting" | "suggestingOversized" | "done";

function formatSizeLine(
  loc: StagingLocation,
  defaults: { w: number; d: number },
): string {
  const w = loc.widthFt ?? defaults.w;
  const d = loc.depthFt ?? defaults.d;
  return `${w} × ${d} ft`;
}

interface NeedMoreSpaceButtonProps {
  delivery: DeliveryOrder;
  onDeliveryUpdated?: (delivery: DeliveryOrder) => void;
  className?: string;
}

function SpotCard({
  title,
  loc,
  sizeLine,
  disabled,
  onAdd,
}: {
  title: string;
  loc: StagingLocation;
  sizeLine: string;
  disabled: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-bg-surface p-3 min-w-0">
      <p className="text-[10px] uppercase tracking-widest text-text-secondary mb-1">
        {title}
      </p>
      <p className="font-semibold text-text-primary truncate">{loc.label}</p>
      <p className="text-xs text-text-secondary mt-1">{sizeLine}</p>
      <button
        type="button"
        disabled={disabled}
        onClick={onAdd}
        className="mt-3 w-full rounded-lg bg-accent-green py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50 active:scale-[0.98]"
      >
        Add this spot
      </button>
    </div>
  );
}

export function NeedMoreSpaceButton({
  delivery,
  onDeliveryUpdated,
  className = "",
}: NeedMoreSpaceButtonProps) {
  const [flowState, setFlowState] = useState<FlowState>("idle");
  const [localDelivery, setLocalDelivery] = useState(delivery);
  const [shelfSpot, setShelfSpot] = useState<StagingLocation | undefined>();
  const [groundSpot, setGroundSpot] = useState<StagingLocation | undefined>();
  const [oversizedSpot, setOversizedSpot] = useState<StagingLocation | undefined>();
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirmLabel, setConfirmLabel] = useState<string | null>(null);
  const [noLargerMessage, setNoLargerMessage] = useState(false);

  useEffect(() => {
    setLocalDelivery(delivery);
  }, [delivery]);

  const applyRecommendations = useCallback(
    (
      all: StagingLocation[],
      forDelivery: DeliveryOrder,
      occupiedIds: string[],
    ): boolean => {
      const { shelfSpot: shelf, groundSpot: ground, oversizedSpot: oversized } =
        recommendNeedMoreSpaceSpots(all, forDelivery, occupiedIds);
      setShelfSpot(shelf);
      setGroundSpot(ground);
      setOversizedSpot(oversized);

      if (shelf || ground) {
        setFlowState("suggesting");
        return true;
      }
      if (oversized) {
        setFlowState("suggestingOversized");
        return true;
      }
      return false;
    },
    [],
  );

  const loadAndRecommend = useCallback(async (): Promise<void> => {
    setLoading(true);
    setNoLargerMessage(false);
    try {
      const all = await firestoreDataService.listStagingLocations();
      const occupancy = await mapOccupancyByLocationId(localDelivery.id);
      const hasSpot = applyRecommendations(
        all,
        localDelivery,
        Object.keys(occupancy),
      );
      if (!hasSpot) {
        setNoLargerMessage(true);
        window.setTimeout(() => setFlowState("done"), 2500);
      }
    } finally {
      setLoading(false);
    }
  }, [applyRecommendations, localDelivery]);

  const refreshAfterOccupiedConflict = useCallback(async () => {
    setConfirmLabel(null);
    setNoLargerMessage(false);
    window.alert(
      "That spot was just taken by another order. Showing the next available options.",
    );
    await loadAndRecommend();
  }, [loadAndRecommend]);

  const applyAddedLocation = (locationId: string, label: string) => {
    const updated: DeliveryOrder = {
      ...localDelivery,
      additionalStagingLocationIds: [
        ...(localDelivery.additionalStagingLocationIds ?? []),
        locationId,
      ],
    };
    setLocalDelivery(updated);
    onDeliveryUpdated?.(updated);
    setConfirmLabel(label);
  };

  const handleTier1Add = async (loc: StagingLocation) => {
    setAdding(true);
    try {
      await addStagingLocation(localDelivery.id, loc.id);
      const updated: DeliveryOrder = {
        ...localDelivery,
        additionalStagingLocationIds: [
          ...(localDelivery.additionalStagingLocationIds ?? []),
          loc.id,
        ],
      };
      setLocalDelivery(updated);
      onDeliveryUpdated?.(updated);
      setConfirmLabel(loc.label);
      window.setTimeout(() => {
        setConfirmLabel(null);
        void firestoreDataService.listStagingLocations().then(async (all) => {
          const occupancy = await mapOccupancyByLocationId(updated.id);
          const hasSpot = applyRecommendations(
            all,
            updated,
            Object.keys(occupancy),
          );
          if (!hasSpot) {
            setNoLargerMessage(true);
            window.setTimeout(() => setFlowState("done"), 2500);
          }
        });
      }, 2000);
    } catch (err) {
      if (isStagingLocationOccupiedError(err)) {
        await refreshAfterOccupiedConflict();
      } else {
        throw err;
      }
    } finally {
      setAdding(false);
    }
  };

  const handleTier2Add = async (loc: StagingLocation) => {
    setAdding(true);
    try {
      await addStagingLocation(localDelivery.id, loc.id);
      applyAddedLocation(loc.id, loc.label);
      window.setTimeout(() => {
        setConfirmLabel(null);
        setFlowState("done");
      }, 2000);
    } catch (err) {
      if (isStagingLocationOccupiedError(err)) {
        await refreshAfterOccupiedConflict();
      } else {
        throw err;
      }
    } finally {
      setAdding(false);
    }
  };

  if (flowState === "done") {
    if (noLargerMessage) {
      return (
        <p className="text-sm text-text-secondary text-center py-2">
          No larger spots available
        </p>
      );
    }
    return null;
  }

  if (confirmLabel) {
    return (
      <p className="text-sm font-medium text-accent-green text-center py-2">
        ✓ Added {confirmLabel}
      </p>
    );
  }

  if (loading) {
    return (
      <p className="text-sm text-text-secondary text-center py-4">
        Loading locations…
      </p>
    );
  }

  if (noLargerMessage && flowState !== "suggesting" && flowState !== "suggestingOversized") {
    return (
      <p className="text-sm text-text-secondary text-center py-4">
        No larger spots available
      </p>
    );
  }

  if (flowState === "idle") {
    return (
      <button
        type="button"
        onClick={() => void loadAndRecommend()}
        className={`w-full rounded-xl border border-border bg-bg-card py-4 text-base font-medium hover:bg-bg-surface transition-colors active:scale-[0.98] text-text-primary ${className}`}
      >
        Need More Space?
      </button>
    );
  }

  if (flowState === "suggesting" && (shelfSpot || groundSpot)) {
    return (
      <div
        className={`rounded-xl border border-border bg-bg-card p-4 space-y-4 ${className}`}
      >
        <p className="text-base font-medium text-text-primary text-center">
          Need more space?
        </p>

        <div
          className={`grid gap-3 ${
            shelfSpot && groundSpot ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"
          }`}
        >
          {shelfSpot && (
            <SpotCard
              title="Shelf spot"
              loc={shelfSpot}
              sizeLine={formatSizeLine(shelfSpot, { w: 3, d: 3 })}
              disabled={adding}
              onAdd={() => void handleTier1Add(shelfSpot)}
            />
          )}
          {groundSpot && (
            <SpotCard
              title="Ground spot"
              loc={groundSpot}
              sizeLine={formatSizeLine(groundSpot, { w: 4, d: 4 })}
              disabled={adding}
              onAdd={() => void handleTier1Add(groundSpot)}
            />
          )}
        </div>

        <button
          type="button"
          disabled={adding}
          onClick={() => setFlowState("done")}
          className="w-full py-2 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
        >
          No thanks
        </button>
      </div>
    );
  }

  if (flowState === "suggestingOversized" && oversizedSpot) {
    return (
      <div
        className={`rounded-xl border border-border bg-bg-card p-4 space-y-4 ${className}`}
      >
        <p className="text-base font-medium text-text-primary text-center">
          Need an even bigger spot?
        </p>

        <div className="rounded-xl border border-border bg-bg-surface p-4">
          <p className="text-[10px] uppercase tracking-widest text-text-secondary mb-1">
            Large ground spot
          </p>
          <p className="font-semibold text-text-primary">
            {oversizedSpot.label}
            <span className="text-text-secondary font-normal">
              {" "}
              · {formatSizeLine(oversizedSpot, { w: 4, d: 10 })}
            </span>
          </p>
          <div className="flex gap-3 mt-4">
            <button
              type="button"
              disabled={adding}
              onClick={() => void handleTier2Add(oversizedSpot)}
              className="flex-1 rounded-xl bg-accent-green py-3 text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50 active:scale-[0.98]"
            >
              Add this spot
            </button>
            <button
              type="button"
              disabled={adding}
              onClick={() => setFlowState("done")}
              className="flex-1 rounded-xl border border-border bg-bg-surface py-3 text-sm font-medium text-text-secondary hover:bg-bg-secondary transition-colors disabled:opacity-50 active:scale-[0.98]"
            >
              No thanks
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
