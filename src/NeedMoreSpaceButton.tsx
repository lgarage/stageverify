import { useCallback, useEffect, useState } from "react";
import {
  addStagingLocation,
  firestoreDataService,
} from "./dispatcher/firestoreService";
import {
  getAllStagingLocationIds,
  type DeliveryOrder,
  type StagingLocation,
} from "./dispatcher/models";

const sortByProximity = (a: StagingLocation, b: StagingLocation): number =>
  (a.sortOrder ?? 999) - (b.sortOrder ?? 999);

const isShelfSpace = (type: StagingLocation["type"]): boolean =>
  type === "shelf" || type === "bin";

const isGroundSpace = (type: StagingLocation["type"]): boolean =>
  type === "ground";

interface NeedMoreSpaceButtonProps {
  delivery: DeliveryOrder;
  onDeliveryUpdated?: (delivery: DeliveryOrder) => void;
  className?: string;
}

function LocationGroup({
  title,
  locations,
  disabled,
  confirmId,
  onSelect,
}: {
  title: string;
  locations: StagingLocation[];
  disabled: boolean;
  confirmId: string | null;
  onSelect: (locationId: string) => void;
}) {
  if (locations.length === 0) return null;

  return (
    <div className="mb-6 last:mb-0">
      <p className="text-[10px] uppercase tracking-widest text-text-secondary mb-3">
        {title}
      </p>
      <div className="space-y-2">
        {locations.map((loc) => {
          const isConfirming = confirmId === loc.id;
          return (
            <button
              key={loc.id}
              type="button"
              disabled={disabled || isConfirming}
              onClick={() => onSelect(loc.id)}
              className={`w-full rounded-xl border px-4 py-3 text-left transition-colors active:scale-[0.98] ${
                isConfirming
                  ? "border-accent-green/30 bg-accent-green/10 text-accent-green"
                  : "border-border bg-bg-surface text-text-primary hover:bg-bg-secondary disabled:opacity-50"
              }`}
            >
              <span className="font-medium">{loc.label}</span>
              <span className="ml-2 text-xs text-text-secondary capitalize">
                {loc.type}
              </span>
              {isConfirming && (
                <span className="block text-xs font-medium text-accent-green mt-1">
                  Added!
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function NeedMoreSpaceButton({
  delivery,
  onDeliveryUpdated,
  className = "",
}: NeedMoreSpaceButtonProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [localDelivery, setLocalDelivery] = useState(delivery);
  const [locations, setLocations] = useState<StagingLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    setLocalDelivery(delivery);
  }, [delivery]);

  const loadLocations = useCallback(async () => {
    setLoading(true);
    try {
      const all = await firestoreDataService.listStagingLocations();
      const assigned = new Set(getAllStagingLocationIds(localDelivery));
      setLocations(
        all.filter((loc) => !assigned.has(loc.id)).sort(sortByProximity),
      );
    } finally {
      setLoading(false);
    }
  }, [localDelivery]);

  const openModal = () => {
    setModalOpen(true);
    void loadLocations();
  };

  const handleSelect = async (locationId: string) => {
    setAdding(true);
    try {
      await addStagingLocation(localDelivery.id, locationId);
      const updated: DeliveryOrder = {
        ...localDelivery,
        additionalStagingLocationIds: [
          ...(localDelivery.additionalStagingLocationIds ?? []),
          locationId,
        ],
      };
      setLocalDelivery(updated);
      onDeliveryUpdated?.(updated);
      setConfirmId(locationId);
      window.setTimeout(() => {
        setConfirmId(null);
        setModalOpen(false);
      }, 800);
    } finally {
      setAdding(false);
    }
  };

  const shelfLocations = locations.filter((loc) => isShelfSpace(loc.type));
  const groundLocations = locations.filter((loc) => isGroundSpace(loc.type));

  useEffect(() => {
    if (!modalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !adding) setModalOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [modalOpen, adding]);

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className={`w-full rounded-xl border border-border bg-bg-card py-4 text-base font-medium hover:bg-bg-surface transition-colors active:scale-[0.98] text-text-primary ${className}`}
      >
        Need More Space?
      </button>

      {modalOpen && (
        <div
          className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center p-4 z-50"
          onClick={() => {
            if (!adding) setModalOpen(false);
          }}
        >
          <div
            className="bg-bg-surface rounded-t-2xl sm:rounded-2xl p-6 w-full max-w-md border border-border max-h-[85vh] overflow-y-auto animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold text-text-primary mb-2 text-center">
              Add Staging Location
            </h3>
            <p className="text-sm text-text-secondary text-center mb-6">
              Closest available spots are listed first.
            </p>

            {loading ? (
              <p className="text-sm text-text-secondary text-center py-8">
                Loading locations…
              </p>
            ) : locations.length === 0 ? (
              <p className="text-sm text-text-secondary text-center py-8">
                No additional staging locations available.
              </p>
            ) : (
              <>
                <LocationGroup
                  title="Shelf Space"
                  locations={shelfLocations}
                  disabled={adding}
                  confirmId={confirmId}
                  onSelect={(id) => void handleSelect(id)}
                />
                <LocationGroup
                  title="Floor/Ground Space"
                  locations={groundLocations}
                  disabled={adding}
                  confirmId={confirmId}
                  onSelect={(id) => void handleSelect(id)}
                />
              </>
            )}

            <button
              type="button"
              onClick={() => setModalOpen(false)}
              disabled={adding}
              className="w-full mt-6 py-3 text-text-secondary font-medium text-sm bg-bg-secondary rounded-lg disabled:opacity-50"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
