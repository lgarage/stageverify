import { useCallback, useMemo, useState } from "react";
import {
  addStagingLocation,
  firestoreDataService,
  listGloballyAssignedStagingLocationIdsForDelivery,
  mapOccupancyByLocationId,
  releasePlannedStagingLocation,
} from "./dispatcher/firestoreService";
import {
  type DeliveryOrder,
  type StagingLocation,
} from "./dispatcher/models";
import {
  isStagingLocationOccupiedError,
  recommendNeedMoreSpaceSpots,
} from "./dispatcher/stagingOccupancy";
import { getAllStagingLocationIds } from "./dispatcher/models";

type SpaceTier = "pick" | "shelf" | "ground" | "large" | "release";

const DISPATCHER_PHONE = "9203360110";
const DISPATCHER_PHONE_DISPLAY = "920-336-0110";

interface ReleasePromptSpot {
  id: string;
  code: string;
  label: string;
}

function formatSizeLine(
  loc: StagingLocation,
  defaults: { w: number; d: number },
): string {
  const w = loc.widthFt ?? defaults.w;
  const d = loc.depthFt ?? defaults.d;
  return `${w} × ${d} ft`;
}

function uniqueSpots(spots: StagingLocation[]): StagingLocation[] {
  const seen = new Set<string>();
  return spots.filter((loc) => {
    if (seen.has(loc.id)) return false;
    seen.add(loc.id);
    return true;
  });
}

function unresolvedPlannedAfterNms(
  delivery: DeliveryOrder,
  selectedSpotIds: Set<string>,
  locById: Map<string, StagingLocation>,
): ReleasePromptSpot[] {
  return (delivery.plannedStagingLocationIds ?? [])
    .filter((id) => !selectedSpotIds.has(id))
    .map((id) => {
      const loc = locById.get(id);
      return {
        id,
        code: loc?.code ?? id,
        label: loc?.label ?? id,
      };
    });
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
  const [suggestedSpots, setSuggestedSpots] = useState<StagingLocation[]>([]);
  const [selectedSpotIds, setSelectedSpotIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirmLabel, setConfirmLabel] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [releaseQueue, setReleaseQueue] = useState<ReleasePromptSpot[]>([]);
  const [releaseIndex, setReleaseIndex] = useState(0);
  const [releaseBusy, setReleaseBusy] = useState(false);

  const tierLabel = tier === "shelf" ? "Shelf spot" : "Ground spot";
  const currentRelease = releaseQueue[releaseIndex];

  const loadTierSpot = useCallback(
    async (selectedTier: "shelf" | "ground") => {
      setLoading(true);
      setLoadError(null);
      setSelectedSpotIds(new Set());
      try {
        const all = await firestoreDataService.listStagingLocations();
        const occupancy = await mapOccupancyByLocationId(localDelivery.id);
        const globallyAssigned =
          await listGloballyAssignedStagingLocationIdsForDelivery(
            localDelivery.id,
          );
        const recs = recommendNeedMoreSpaceSpots(
          all,
          localDelivery,
          Object.keys(occupancy),
          globallyAssigned,
        );
        const primary =
          selectedTier === "shelf" ? recs.shelfSpot : recs.groundSpot;
        const adjacent =
          selectedTier === "ground" ? (recs.adjacentGroundSpots ?? []) : [];
        const spots = uniqueSpots(
          primary
            ? [primary, ...adjacent.filter((loc) => loc.id !== primary.id)]
            : adjacent,
        );
        setSuggestedSpots(spots);
        if (spots.length > 0) {
          setSelectedSpotIds(new Set(spots.map((loc) => loc.id)));
        } else {
          setLoadError(
            selectedTier === "shelf"
              ? "No shelf spots available right now."
              : "No ground spots available right now.",
          );
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

  const selectedSpots = useMemo(
    () => suggestedSpots.filter((loc) => selectedSpotIds.has(loc.id)),
    [suggestedSpots, selectedSpotIds],
  );

  const toggleSpot = (locId: string, checked: boolean) => {
    setSelectedSpotIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(locId);
      else next.delete(locId);
      return next;
    });
  };

  const finishWithConfirm = (updated: DeliveryOrder, labels: string) => {
    setLocalDelivery(updated);
    onDeliveryUpdated?.(updated);
    setConfirmLabel(labels);
    window.setTimeout(() => {
      setConfirmLabel(null);
      onClose();
    }, 2000);
  };

  const beginReleasePrompts = async (updated: DeliveryOrder) => {
    const all = await firestoreDataService.listStagingLocations();
    const locById = new Map(all.map((loc) => [loc.id, loc]));
    const queue = unresolvedPlannedAfterNms(updated, selectedSpotIds, locById);
    if (queue.length === 0) {
      finishWithConfirm(
        updated,
        selectedSpots.map((loc) => loc.label).join(", "),
      );
      return;
    }
    setLocalDelivery(updated);
    onDeliveryUpdated?.(updated);
    setReleaseQueue(queue);
    setReleaseIndex(0);
    setTier("release");
  };

  const handleAddSelectedSpots = async () => {
    if (selectedSpots.length === 0) return;
    setAdding(true);
    try {
      let updated = localDelivery;
      for (const loc of selectedSpots) {
        if (getAllStagingLocationIds(updated).includes(loc.id)) continue;
        await addStagingLocation(updated.id, loc.id);
        if (!updated.stagingLocationId?.trim()) {
          updated = { ...updated, stagingLocationId: loc.id };
        } else {
          updated = {
            ...updated,
            additionalStagingLocationIds: [
              ...(updated.additionalStagingLocationIds ?? []),
              loc.id,
            ],
          };
        }
      }
      await beginReleasePrompts(updated);
    } catch (err) {
      if (isStagingLocationOccupiedError(err)) {
        await refreshAfterOccupiedConflict();
      } else {
        setLoadError("Could not add spot(s). Try again.");
      }
    } finally {
      setAdding(false);
    }
  };

  const advanceReleaseQueue = async (
    refreshed: DeliveryOrder | null,
    placed: boolean,
  ) => {
    const base = refreshed ?? localDelivery;
    setLocalDelivery(base);
    onDeliveryUpdated?.(base);

    const nextIndex = releaseIndex + 1;
    if (nextIndex >= releaseQueue.length) {
      const labels = selectedSpots.map((loc) => loc.label).join(", ");
      finishWithConfirm(base, labels);
      return;
    }
    setReleaseIndex(nextIndex);
    if (!placed && refreshed) {
      const all = await firestoreDataService.listStagingLocations();
      const locById = new Map(all.map((loc) => [loc.id, loc]));
      const remaining = unresolvedPlannedAfterNms(
        refreshed,
        selectedSpotIds,
        locById,
      );
      if (remaining.length > 0) {
        setReleaseQueue(remaining);
        setReleaseIndex(0);
      }
    }
  };

  const handleReleaseAnswer = async (placed: boolean) => {
    if (!currentRelease) return;
    setReleaseBusy(true);
    setLoadError(null);
    try {
      const refreshed = await releasePlannedStagingLocation(
        localDelivery.id,
        currentRelease.id,
        placed,
      );
      await advanceReleaseQueue(refreshed, placed);
    } catch {
      setLoadError("Could not save your answer. Try again.");
    } finally {
      setReleaseBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60"
      onClick={onClose}
    >
      <div
        className="rounded-t-2xl border-t border-border bg-bg-primary px-4 pt-5 pb-[calc(env(safe-area-inset-bottom,16px)+20px)] max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        data-testid="vendor-need-more-space-flow"
      >
        {confirmLabel ? (
          <p className="text-center text-sm font-medium text-accent-green py-8">
            ✓ Added {confirmLabel}
          </p>
        ) : tier === "release" && currentRelease ? (
          <>
            <h2
              className="text-lg font-bold text-text-primary text-center mb-2"
              data-testid={`release-prompt-${currentRelease.code}`}
            >
              Did you place anything in {currentRelease.code}?
            </h2>
            <p className="text-sm text-text-secondary text-center mb-5">
              {currentRelease.label} was planned, but you picked other spots.
            </p>
            {loadError && (
              <p className="text-sm text-accent-red text-center mb-3">
                {loadError}
              </p>
            )}
            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                data-testid="release-prompt-yes"
                disabled={releaseBusy}
                onClick={() => void handleReleaseAnswer(true)}
                className="w-full rounded-xl bg-accent-green py-4 text-base font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50 active:scale-[0.98]"
              >
                Yes — I placed material there
              </button>
              <button
                type="button"
                data-testid="release-prompt-no"
                disabled={releaseBusy}
                onClick={() => void handleReleaseAnswer(false)}
                className="w-full rounded-xl bg-bg-secondary py-4 text-base font-semibold text-text-primary hover:bg-bg-surface transition-colors disabled:opacity-50 active:scale-[0.98]"
              >
                No — release this spot
              </button>
            </div>
          </>
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
              {tierLabel}
            </h2>
            <p className="text-xs text-text-secondary text-center mb-3">
              Select one or more adjacent spots (empty + unassigned only).
            </p>
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
            {!loading && suggestedSpots.length > 0 && (
              <div
                className="rounded-xl border border-border bg-bg-surface p-4 mt-2"
                data-testid="nms-spot-multi-select"
              >
                <p className="text-[10px] uppercase tracking-widest text-text-secondary mb-2">
                  Available spots
                </p>
                <div className="flex flex-col gap-2 mb-4">
                  {suggestedSpots.map((loc) => (
                    <label
                      key={loc.id}
                      data-testid={`nms-spot-option-${loc.code}`}
                      className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5 cursor-pointer hover:bg-bg-secondary"
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={selectedSpotIds.has(loc.id)}
                        disabled={adding}
                        onChange={(e) => toggleSpot(loc.id, e.target.checked)}
                      />
                      <span className="flex-1">
                        <span className="font-semibold text-text-primary">
                          {loc.label}
                        </span>
                        <span className="block text-xs text-text-secondary mt-0.5">
                          {formatSizeLine(
                            loc,
                            tier === "shelf"
                              ? { w: 3, d: 3 }
                              : { w: 4, d: 4 },
                          )}
                          {loc.adjacentGroupId
                            ? ` · group ${loc.adjacentGroupId}`
                            : ""}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  data-testid="nms-add-selected-spots"
                  disabled={adding || selectedSpots.length === 0}
                  onClick={() => void handleAddSelectedSpots()}
                  className="w-full rounded-xl bg-accent-green py-3 text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50 active:scale-[0.98]"
                >
                  {adding
                    ? "Adding…"
                    : `Add ${selectedSpots.length} selected spot${selectedSpots.length === 1 ? "" : "s"}`}
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
