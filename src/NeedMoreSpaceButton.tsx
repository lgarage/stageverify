import { useCallback, useEffect, useState } from "react";
import {
  addStagingLocation,
  firestoreDataService,
} from "./dispatcher/firestoreService";
import {
  getAllStagingLocationIds,
  isLocationActive,
  isOversizedSpot,
  type DeliveryOrder,
  type StagingLocation,
} from "./dispatcher/models";

type FlowState =
  | "idle"
  | "suggesting"
  | "promptOversized"
  | "suggestingOversized"
  | "done";

const sortByProximity = (a: StagingLocation, b: StagingLocation): number =>
  (a.sortOrder ?? 999) - (b.sortOrder ?? 999);

function pickStandardSpot(
  locations: StagingLocation[],
  assigned: Set<string>,
): StagingLocation | undefined {
  return locations
    .filter(
      (loc) =>
        isLocationActive(loc) &&
        !assigned.has(loc.id) &&
        !isOversizedSpot(loc),
    )
    .sort(sortByProximity)[0];
}

function pickOversizedSpot(
  locations: StagingLocation[],
  assigned: Set<string>,
): StagingLocation | undefined {
  return locations
    .filter(
      (loc) =>
        isLocationActive(loc) &&
        !assigned.has(loc.id) &&
        isOversizedSpot(loc),
    )
    .sort(sortByProximity)[0];
}

function formatDimensions(loc: StagingLocation): string {
  const w = loc.widthFt;
  const d = loc.depthFt;
  if (w != null && d != null) return `${w}×${d} ft`;
  return "";
}

function formatOversizedLine(loc: StagingLocation): string {
  const w = loc.widthFt ?? 4;
  const d = loc.depthFt ?? 10;
  return `ground · ${w}×${d} ft`;
}

interface NeedMoreSpaceButtonProps {
  delivery: DeliveryOrder;
  onDeliveryUpdated?: (delivery: DeliveryOrder) => void;
  className?: string;
}

export function NeedMoreSpaceButton({
  delivery,
  onDeliveryUpdated,
  className = "",
}: NeedMoreSpaceButtonProps) {
  const [flowState, setFlowState] = useState<FlowState>("idle");
  const [localDelivery, setLocalDelivery] = useState(delivery);
  const [standardSpot, setStandardSpot] = useState<StagingLocation | undefined>();
  const [oversizedSpot, setOversizedSpot] = useState<StagingLocation | undefined>();
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirmLabel, setConfirmLabel] = useState<string | null>(null);
  const [noSpotsMessage, setNoSpotsMessage] = useState(false);

  useEffect(() => {
    setLocalDelivery(delivery);
  }, [delivery]);

  const refreshRecommendations = useCallback(
    (locations: StagingLocation[]) => {
      const assigned = new Set(getAllStagingLocationIds(localDelivery));
      setStandardSpot(pickStandardSpot(locations, assigned));
      setOversizedSpot(pickOversizedSpot(locations, assigned));
    },
    [localDelivery],
  );

  const loadAndRecommend = useCallback(async (): Promise<void> => {
    setLoading(true);
    setNoSpotsMessage(false);
    try {
      const all = await firestoreDataService.listStagingLocations();
      const assigned = new Set(getAllStagingLocationIds(localDelivery));
      const standard = pickStandardSpot(all, assigned);
      const oversized = pickOversizedSpot(all, assigned);
      setStandardSpot(standard);
      setOversizedSpot(oversized);

      if (standard) {
        setFlowState("suggesting");
      } else if (oversized) {
        setFlowState("suggestingOversized");
      } else {
        setNoSpotsMessage(true);
        window.setTimeout(() => setFlowState("done"), 3000);
      }
    } finally {
      setLoading(false);
    }
  }, [localDelivery]);

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

  const handleAccept = async (
    loc: StagingLocation,
    nextAfterConfirm: FlowState,
  ) => {
    setAdding(true);
    try {
      await addStagingLocation(localDelivery.id, loc.id);
      applyAddedLocation(loc.id, loc.label);
      window.setTimeout(() => {
        setConfirmLabel(null);
        void firestoreDataService.listStagingLocations().then((all) => {
          refreshRecommendations(all);
        });
        setFlowState(nextAfterConfirm);
      }, 2000);
    } finally {
      setAdding(false);
    }
  };

  const openOversizedFlow = () => {
    void firestoreDataService.listStagingLocations().then((all) => {
      const assigned = new Set(getAllStagingLocationIds(localDelivery));
      const oversized = pickOversizedSpot(all, assigned);
      setOversizedSpot(oversized);
      if (oversized) {
        setFlowState("suggestingOversized");
      } else {
        setNoSpotsMessage(true);
        window.setTimeout(() => setFlowState("done"), 3000);
      }
    });
  };

  if (flowState === "done") {
    if (noSpotsMessage) {
      return (
        <p className="text-sm text-text-secondary text-center py-2">
          No additional spots available — ask staff for assistance.
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

  if (noSpotsMessage) {
    return (
      <p className="text-sm text-text-secondary text-center py-4">
        No additional spots available — ask staff for assistance.
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

  if (flowState === "promptOversized") {
    return (
      <button
        type="button"
        onClick={openOversizedFlow}
        className={`w-full rounded-xl border border-border bg-bg-card py-4 text-base font-medium hover:bg-bg-surface transition-colors active:scale-[0.98] text-text-primary ${className}`}
      >
        Need an even bigger spot?
      </button>
    );
  }

  if (flowState === "suggesting" && standardSpot) {
    const dims = formatDimensions(standardSpot);
    return (
      <div
        className={`rounded-xl border border-border bg-bg-card p-4 space-y-4 ${className}`}
      >
        <div className="text-center">
          <p className="text-base font-medium text-text-primary">
            Need more space?
          </p>
          <p className="text-sm text-text-secondary mt-2">
            Closest available spot: {standardSpot.label} ({standardSpot.type}
            {dims ? ` · ${dims}` : ""})
          </p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            disabled={adding}
            onClick={() => void handleAccept(standardSpot, "promptOversized")}
            className="flex-1 rounded-xl bg-accent-green py-3 text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50 active:scale-[0.98]"
          >
            Accept
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
    );
  }

  if (flowState === "suggestingOversized" && oversizedSpot) {
    return (
      <div
        className={`rounded-xl border border-border bg-bg-card p-4 space-y-4 ${className}`}
      >
        <div className="text-center">
          <p className="text-base font-medium text-text-primary">
            Need an even bigger spot?
          </p>
          <p className="text-sm text-text-secondary mt-2">
            Closest large spot: {oversizedSpot.label} (
            {formatOversizedLine(oversizedSpot)})
          </p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            disabled={adding}
            onClick={() => void handleAccept(oversizedSpot, "done")}
            className="flex-1 rounded-xl bg-accent-green py-3 text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50 active:scale-[0.98]"
          >
            Accept
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
    );
  }

  return null;
}
