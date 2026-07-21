import { useEffect, useRef, useState } from "react";
import {
  firestoreDataService,
  markDeliveryShipped,
  resolveMaterialIssue,
  listShopStockMappings,
} from "../firestoreService";
import {
  buildShopStockLinesFromPickList,
  shopStockLocationNoteFromLines,
} from "../shopStockMapping";
import { ISSUE_RESOLUTION_TYPE_LABEL, type IssueResolutionType } from "../models";
import type { DeliveryDetails, DeliveryStatus, StagingLocation } from "../index";
import { useDispatcherPortal } from "../DispatcherPortalContext";
import { DetailContent } from "./DeliveryDetailContent";

const NAVY = "#0a3161";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

type Props = {
  deliveryId: string | null;
  onClose: () => void;
  /** Called after successful mutations so list/map can refresh. */
  onDataChanged?: () => void | Promise<void>;
  /** Open another delivery in this same drawer (job sibling links). */
  onOpenDelivery?: (deliveryId: string) => void;
};

/**
 * Shared delivery pullout drawer — same shell + DetailContent used on
 * Dispatcher Dashboard and Staging Map.
 */
export function DeliveryDetailDrawer({
  deliveryId,
  onClose,
  onDataChanged,
  onOpenDelivery,
}: Props) {
  const { emailProviderConnected } = useDispatcherPortal();
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [selectedDetails, setSelectedDetails] =
    useState<DeliveryDetails | null>(null);
  const [mutationLoading, setMutationLoading] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [stagingLocations, setStagingLocations] = useState<StagingLocation[]>(
    [],
  );
  const pickupOperationIds = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    void firestoreDataService.listStagingLocations().then(setStagingLocations);
  }, []);

  useEffect(() => {
    if (!deliveryId) {
      setSelectedDetails(null);
      setDetailError(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    setMutationError(null);
    void firestoreDataService
      .getDeliveryDetails(deliveryId)
      .then((detail) => {
        if (cancelled) return;
        if (!detail) {
          setDetailError("Delivery details not found.");
          setSelectedDetails(null);
          return;
        }
        setSelectedDetails(detail);
      })
      .catch(() => {
        if (cancelled) return;
        setDetailError("Unable to load delivery details.");
        setSelectedDetails(null);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deliveryId]);

  useEffect(() => {
    if (!deliveryId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deliveryId, onClose]);

  const refreshAfter = async (details: DeliveryDetails | null) => {
    if (details) setSelectedDetails(details);
    await onDataChanged?.();
  };

  const handleUpdateStagingLocation = async (
    stagingLocationId: string,
  ): Promise<void> => {
    if (!deliveryId) return;
    setMutationLoading(true);
    setMutationError(null);
    try {
      const updated = await firestoreDataService.updateStagingLocation(
        deliveryId,
        stagingLocationId,
      );
      if (updated) await refreshAfter(updated);
      else setMutationError("Failed to move order to that spot.");
    } catch (e) {
      setMutationError(
        "An unexpected error occurred while moving this order.",
      );
      console.error(e);
    } finally {
      setMutationLoading(false);
    }
  };

  const handleUpdatePlannedStagingLocations = async (
    plannedIds: string[],
  ): Promise<void> => {
    if (!deliveryId) return;
    setMutationLoading(true);
    setMutationError(null);
    try {
      const updated = await firestoreDataService.updatePlannedStagingLocations(
        deliveryId,
        plannedIds,
      );
      if (updated) await refreshAfter(updated);
      else setMutationError("Failed to update planned staging locations.");
    } catch (e) {
      setMutationError(
        "An unexpected error occurred while updating planned locations.",
      );
      console.error(e);
    } finally {
      setMutationLoading(false);
    }
  };

  const handleUpdateJobPickupScheduled = async (
    scheduled: boolean,
  ): Promise<void> => {
    const jobId = selectedDetails?.job?.id;
    if (!jobId || !deliveryId) return;
    setMutationLoading(true);
    setMutationError(null);
    try {
      const updatedJob = await firestoreDataService.updateJobPickupScheduled(
        jobId,
        scheduled,
      );
      if (updatedJob) {
        const refreshed =
          await firestoreDataService.getDeliveryDetails(deliveryId);
        await refreshAfter(
          refreshed ??
            (selectedDetails
              ? { ...selectedDetails, job: updatedJob }
              : null),
        );
      } else {
        setMutationError("Failed to update Pickup Scheduled.");
      }
    } catch (e) {
      setMutationError(
        "An unexpected error occurred while updating Pickup Scheduled.",
      );
      console.error(e);
    } finally {
      setMutationLoading(false);
    }
  };

  const handleUpdateStatus = async (
    toStatus: DeliveryStatus,
    reason?: string,
  ) => {
    if (!deliveryId) return;
    setMutationLoading(true);
    setMutationError(null);
    try {
      const updatedDetails = await firestoreDataService.updateDeliveryStatus(
        deliveryId,
        toStatus,
        reason,
      );
      if (updatedDetails) await refreshAfter(updatedDetails);
      else {
        setMutationError(
          "Failed to update status. The transition may be invalid.",
        );
      }
    } catch (e) {
      setMutationError("An unexpected error occurred while updating status.");
      console.error(e);
    } finally {
      setMutationLoading(false);
    }
  };

  const handleRecordPickup = async (
    technicianName: string,
    itemsSummary: string,
  ) => {
    if (!deliveryId) return;
    setMutationLoading(true);
    setMutationError(null);
    try {
      let operationId = pickupOperationIds.current.get(deliveryId);
      if (!operationId) {
        operationId = `pickup-${deliveryId}-${crypto.randomUUID()}`;
        pickupOperationIds.current.set(deliveryId, operationId);
      }
      await firestoreDataService.recordPickupEvent(
        deliveryId,
        technicianName,
        itemsSummary,
        undefined,
        operationId,
      );
      const updatedDetails =
        await firestoreDataService.getDeliveryDetails(deliveryId);
      if (updatedDetails) await refreshAfter(updatedDetails);
      else setMutationError("Failed to record pickup.");
    } catch (e) {
      setMutationError("An unexpected error occurred while recording pickup.");
      console.error(e);
    } finally {
      setMutationLoading(false);
    }
  };

  const handleResolveMaterialIssue = async (
    issueId: string,
    resolutionType: IssueResolutionType,
    resolutionNote: string,
  ) => {
    if (!deliveryId) return;
    setMutationLoading(true);
    setMutationError(null);
    try {
      await resolveMaterialIssue({
        issueId,
        resolutionType,
        resolutionNote:
          resolutionNote.trim() ||
          ISSUE_RESOLUTION_TYPE_LABEL[resolutionType],
      });
      const updatedDetails =
        await firestoreDataService.getDeliveryDetails(deliveryId);
      if (updatedDetails) await refreshAfter(updatedDetails);
    } catch (e) {
      setMutationError("Failed to resolve material issue.");
      console.error(e);
    } finally {
      setMutationLoading(false);
    }
  };

  const handleRevertStatus = async () => {
    if (!deliveryId) return;
    setMutationLoading(true);
    setMutationError(null);
    try {
      const updatedDetails = await firestoreDataService.revertDeliveryStatus(
        deliveryId,
        "dispatcher",
      );
      if (updatedDetails) await refreshAfter(updatedDetails);
      else setMutationError("Failed to revert status.");
    } catch (e) {
      setMutationError("An unexpected error occurred while reverting status.");
      console.error(e);
    } finally {
      setMutationLoading(false);
    }
  };

  const handleMarkShipped = async () => {
    if (!deliveryId) return;
    setMutationLoading(true);
    setMutationError(null);
    try {
      await markDeliveryShipped(deliveryId);
      const updatedDetails =
        await firestoreDataService.getDeliveryDetails(deliveryId);
      if (updatedDetails) await refreshAfter(updatedDetails);
      else setMutationError("Failed to mark delivery as shipped.");
    } catch (e) {
      setMutationError("An unexpected error occurred while marking shipped.");
      console.error(e);
    } finally {
      setMutationLoading(false);
    }
  };

  const handleUpdateIssueSummary = async (summary: string): Promise<void> => {
    if (!deliveryId) return;
    setMutationLoading(true);
    setMutationError(null);
    try {
      const updated = await firestoreDataService.updateIssueSummary(
        deliveryId,
        summary,
      );
      if (updated) setSelectedDetails(updated);
      await onDataChanged?.();
    } catch (err) {
      setMutationError(
        err instanceof Error ? err.message : "Failed to update issue",
      );
    } finally {
      setMutationLoading(false);
    }
  };

  const handleSetDeliverToSiteConfirmed = async (
    confirmed: boolean,
  ): Promise<void> => {
    if (!deliveryId) return;
    setMutationLoading(true);
    setMutationError(null);
    try {
      const updated = await firestoreDataService.setDeliverToSiteConfirmed(
        deliveryId,
        confirmed,
      );
      if (updated) await refreshAfter(updated);
      else setMutationError("Failed to update site delivery confirmation.");
    } catch (err) {
      setMutationError(
        err instanceof Error
          ? err.message
          : "Failed to update site delivery confirmation.",
      );
      console.error(err);
    } finally {
      setMutationLoading(false);
    }
  };

  const handleUpdateItemReceiptStatus = async (
    itemId: string,
    status: "Not Delivered" | "Delivered",
  ): Promise<void> => {
    if (!deliveryId || !selectedDetails) return;
    const item = selectedDetails.items.find((i) => i.id === itemId);
    if (!item) {
      setMutationError("Item not found on this delivery.");
      return;
    }
    const qtyOrdered = item.qtyOrdered;
    const qtyReceived = status === "Delivered" ? qtyOrdered : 0;
    const qtyMissing = Math.max(0, qtyOrdered - qtyReceived);
    setMutationLoading(true);
    setMutationError(null);
    try {
      await firestoreDataService.updateItemQty(
        deliveryId,
        itemId,
        qtyOrdered,
        qtyReceived,
        qtyMissing,
      );
      const updatedDetails =
        await firestoreDataService.getDeliveryDetails(deliveryId);
      if (updatedDetails) await refreshAfter(updatedDetails);
      else setMutationError("Updated item qty but failed to reload delivery.");
    } catch (err) {
      setMutationError(
        err instanceof Error ? err.message : "Failed to update item status.",
      );
      console.error(err);
    } finally {
      setMutationLoading(false);
    }
  };

  const handleUpdateShopStockPickList = async (
    items: string[],
    locationNote: string,
    linkedMappingId?: string,
  ): Promise<void> => {
    if (!deliveryId) return;
    setMutationLoading(true);
    setMutationError(null);
    try {
      const mappings = await listShopStockMappings();
      const shopStockLines = buildShopStockLinesFromPickList(
        items,
        mappings,
        linkedMappingId,
      );
      const resolvedNote =
        locationNote.trim() ||
        shopStockLocationNoteFromLines(shopStockLines, mappings);
      const updated = await firestoreDataService.updateShopStockPickList(
        deliveryId,
        items,
        resolvedNote,
        shopStockLines,
      );
      if (updated) setSelectedDetails(updated);
      await onDataChanged?.();
    } catch (err) {
      setMutationError(
        err instanceof Error
          ? err.message
          : "Failed to update shop stock pick list",
      );
    } finally {
      setMutationLoading(false);
    }
  };

  if (!deliveryId) return null;

  return (
    <div
      data-testid="delivery-detail-drawer"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        backgroundColor: "rgba(10,15,30,0.55)",
        backdropFilter: "blur(3px)",
        display: "flex",
        justifyContent: "flex-end",
      }}
      onClick={onClose}
    >
      <div
        style={{
          height: "100%",
          width: "100%",
          maxWidth: 480,
          backgroundColor: "#fff",
          borderLeft: "1px solid #e0e3e8",
          boxShadow: "-8px 0 40px rgba(0,0,0,0.18)",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          fontFamily: FONT,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "15px 20px",
            borderBottom: "1px solid #e0e3e8",
            position: "sticky",
            top: 0,
            backgroundColor: "#fff",
            zIndex: 10,
            boxShadow: "rgba(0,0,0,0.08) 0px 2px 6px 0px",
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 700,
                color: NAVY,
              }}
            >
              Delivery Details
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: 12,
                color: "#9ca3af",
                marginTop: 2,
              }}
            >
              Click outside or press Esc to close
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "5px 12px",
              border: "1px solid #ccd0d7",
              borderRadius: 4,
              backgroundColor: "#f9fafb",
              color: "#333",
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer",
              outline: "none",
              fontFamily: FONT,
            }}
          >
            ✕ Close
          </button>
        </div>

        <div style={{ padding: "20px", flex: 1 }}>
          <DetailContent
            loading={detailLoading}
            error={detailError}
            details={selectedDetails}
            navy={NAVY}
            font={FONT}
            mutationLoading={mutationLoading}
            mutationError={mutationError}
            onUpdateStatus={handleUpdateStatus}
            onRecordPickup={handleRecordPickup}
            onRevertStatus={handleRevertStatus}
            onMarkShipped={handleMarkShipped}
            onUpdateIssueSummary={handleUpdateIssueSummary}
            onSetDeliverToSiteConfirmed={handleSetDeliverToSiteConfirmed}
            onUpdateItemReceiptStatus={handleUpdateItemReceiptStatus}
            onUpdateShopStockPickList={handleUpdateShopStockPickList}
            stagingLocations={stagingLocations}
            onUpdatePlannedStagingLocations={handleUpdatePlannedStagingLocations}
            onUpdateStagingLocation={handleUpdateStagingLocation}
            onOpenDelivery={(id) => {
              if (onOpenDelivery) onOpenDelivery(id);
              else onClose();
            }}
            onUpdateJobPickupScheduled={handleUpdateJobPickupScheduled}
            onDeliveryOrderUpdated={(delivery) => {
              setSelectedDetails((prev) =>
                prev ? { ...prev, delivery } : prev,
              );
              void onDataChanged?.();
            }}
            onResolveMaterialIssue={handleResolveMaterialIssue}
            emailProviderConnected={emailProviderConnected}
          />
        </div>
      </div>
    </div>
  );
}
