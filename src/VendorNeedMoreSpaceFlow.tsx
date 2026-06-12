import { useCallback, useState } from "react";
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

type SpaceTier = "pick" | "shelf" | "ground" | "large";

const DISPATCHER_PHONE = "9203360110";
const DISPATCHER_PHONE_DISPLAY = "920-336-0110";

function formatSizeLine(
  loc: StagingLocation,
  defaults: { w: number; d: number },
): string {
  const w = loc.widthFt ?? defaults.w;
  const d = loc.depthFt ?? defaults.d;
  return `${w} × ${d} ft`;
}

interface VendorNeedMoreSpaceFlowProps {
  delivery: DeliveryOrder;
  onDeliveryUpdated?: (delivery: DeliveryOrder) => void;
  onClose: () => void;
}

export function VendorNeedMoreSpaceFlow({
  delivery,
  onDeliveryUpdated,
  onClose,
}: VendorNeedMoreSpaceFlowProps) {
  const [tier, setTier] = useState<SpaceTier>("pick");
  const [localDelivery, setLocalDelivery] = useState(delivery);
  const [shelfSpot, setShelfSpot] = useState<StagingLocation | undefined>();
  const [groundSpot, setGroundSpot] = useState<StagingLocation | undefined>();
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirmLabel, setConfirmLabel] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadTierSpot = useCallback(
    async (selectedTier: "shelf" | "ground") => {
      setLoading(true);
      setLoadError(null);
      try {
        const all = await firestoreDataService.listStagingLocations();
        const occupancy = await mapOccupancyByLocationId(localDelivery.id);
        const recs = recommendNeedMoreSpaceSpots(
          all,
          localDelivery,
          Object.keys(occupancy),
        );
        if (selectedTier === "shelf") {
          setShelfSpot(recs.shelfSpot);
          setGroundSpot(undefined);
          if (!recs.shelfSpot) {
            setLoadError("No shelf spots available right now.");
          }
        } else {
          setGroundSpot(recs.groundSpot);
          setShelfSpot(undefined);
          if (!recs.groundSpot) {
            setLoadError("No ground spots available right now.");
          }
        }
        setTier(selectedTier);
      } catch {
        setLoadError("Could not load staging options. Try again.");
      } finally {
        setLoading(false);
      }
    },
    [localDelivery],
  );

  const refreshAfterOccupiedConflict = useCallback(async () => {
    setConfirmLabel(null);
    window.alert(
      "That spot was just taken by another order. Showing the next available options.",
    );
    if (tier === "shelf") await loadTierSpot("shelf");
    else if (tier === "ground") await loadTierSpot("ground");
  }, [tier, loadTierSpot]);

  const handleAddSpot = async (loc: StagingLocation) => {
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
        onClose();
      }, 2000);
    } catch (err) {
      if (isStagingLocationOccupiedError(err)) {
        await refreshAfterOccupiedConflict();
      } else {
        setLoadError("Could not add spot. Try again.");
      }
    } finally {
      setAdding(false);
    }
  };

  const activeSpot = tier === "shelf" ? shelfSpot : groundSpot;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60"
      onClick={onClose}
    >
      <div
        className="rounded-t-2xl border-t border-border bg-bg-primary px-4 pt-5 pb-[calc(env(safe-area-inset-bottom,16px)+20px)] max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {confirmLabel ? (
          <p className="text-center text-sm font-medium text-accent-green py-8">
            ✓ Added {confirmLabel}
          </p>
        ) : tier === "pick" ? (
          <>
            <h2 className="text-lg font-bold text-text-primary text-center">
              Need more space?
            </h2>
            <p className="text-sm text-text-secondary text-center mt-1 mb-5">
              Where do you need additional space?
            </p>
            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => void loadTierSpot("shelf")}
                disabled={loading}
                className="w-full rounded-xl bg-accent py-4 text-base font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50 active:scale-[0.98]"
              >
                Shelf
              </button>
              <button
                type="button"
                onClick={() => void loadTierSpot("ground")}
                disabled={loading}
                className="w-full rounded-xl bg-bg-secondary py-4 text-base font-semibold text-text-primary hover:bg-bg-surface transition-colors disabled:opacity-50 active:scale-[0.98]"
              >
                Ground
              </button>
              <button
                type="button"
                onClick={() => setTier("large")}
                className="w-full rounded-xl border border-border bg-bg-surface py-4 text-base font-semibold text-text-primary hover:bg-bg-secondary transition-colors active:scale-[0.98]"
              >
                Large / Oversized Delivery
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-full mt-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary"
            >
              Cancel
            </button>
          </>
        ) : tier === "large" ? (
          <>
            <h2 className="text-lg font-bold text-text-primary text-center mb-2">
              Large / Oversized Delivery
            </h2>
            <div className="rounded-2xl border border-border bg-bg-surface p-5 text-center">
              <p className="text-sm text-text-secondary leading-relaxed mb-4">
                Examples: long pipe, strut, duct, large equipment, or material
                requiring many locations.
              </p>
              <p className="text-sm font-medium text-text-primary mb-4">
                Need more than a few spots?
              </p>
              <p className="text-sm text-text-secondary mb-5">
                Call dispatcher:
                <br />
                <span className="text-text-primary font-semibold">
                  {DISPATCHER_PHONE_DISPLAY}
                </span>
              </p>
              <a
                href={`tel:${DISPATCHER_PHONE}`}
                className="block w-full rounded-xl bg-accent-green py-4 text-[17px] font-bold text-white text-center hover:opacity-90 transition-opacity active:scale-[0.98]"
              >
                Call Dispatcher
              </a>
            </div>
            <button
              type="button"
              onClick={() => setTier("pick")}
              className="w-full mt-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary"
            >
              ← Back
            </button>
          </>
        ) : (
          <>
            <h2 className="text-lg font-bold text-text-primary text-center mb-1">
              {tier === "shelf" ? "Shelf spot" : "Ground spot"}
            </h2>
            {loading && (
              <p className="text-sm text-text-secondary text-center py-8">
                Loading locations…
              </p>
            )}
            {loadError && !loading && (
              <p className="text-sm text-accent-red text-center py-4">
                {loadError}
              </p>
            )}
            {activeSpot && !loading && (
              <div className="rounded-xl border border-border bg-bg-surface p-4 mt-4">
                <p className="text-[10px] uppercase tracking-widest text-text-secondary mb-1">
                  Recommended
                </p>
                <p className="font-semibold text-text-primary text-lg">
                  {activeSpot.label}
                </p>
                <p className="text-xs text-text-secondary mt-1">
                  {formatSizeLine(
                    activeSpot,
                    tier === "shelf" ? { w: 3, d: 3 } : { w: 4, d: 4 },
                  )}
                </p>
                <button
                  type="button"
                  disabled={adding}
                  onClick={() => void handleAddSpot(activeSpot)}
                  className="mt-4 w-full rounded-xl bg-accent-green py-3 text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50 active:scale-[0.98]"
                >
                  Add this spot
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => setTier("pick")}
              className="w-full mt-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary"
            >
              ← Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}
