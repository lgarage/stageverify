import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  firestoreDataService,
  resolveMaterialIssue,
  listShopStockMappings,
} from "../firestoreService";
import {
  buildShopStockLinesFromPickList,
  shopStockLocationNoteFromLines,
} from "../shopStockMapping";
import { formatPickupError } from "../pickupErrors";
import { newPickupClientOperationId } from "../pickupClientOperationId";
import { ISSUE_RESOLUTION_TYPE_LABEL, type IssueResolutionType } from "../models";
import type { DeliveryDetails, DeliveryStatus, StagingLocation } from "../index";
import { useDispatcherPortal } from "../DispatcherPortalContext";
import {
  buildManualReceiveStagingNavigateUrl,
  clearPendingManualItemReceive,
  deliveryHasAnyStagingRefs,
  manualDeliveredRequiresPhysicalStagingGate,
  writePendingManualItemReceive,
} from "../manualItemReceiveStaging";
import { DetailContent } from "./DeliveryDetailContent";
import { ViewOriginalPdfButton } from "./ViewOriginalPdfButton";

const NAVY = "#0a3161";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

function showPickupCompletedToast(): void {
  const testId = "delivery-pickup-completed-toast";
  document.querySelector(`[data-testid="${testId}"]`)?.remove();
  const el = document.createElement("div");
  el.setAttribute("data-testid", testId);
  Object.assign(el.style, {
    position: "fixed",
    bottom: "24px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "9999",
    padding: "12px 20px",
    borderRadius: "8px",
    backgroundColor: "var(--admin-success-bg, #ecfdf5)",
    color: "var(--admin-success-text, #166534)",
    border: "1px solid var(--admin-success-border, #bbf7d0)",
    fontSize: "14px",
    fontWeight: "700",
    fontFamily: FONT,
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
  });
  el.textContent = "Pickup completed";
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 4000);
}

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
  onOpenDelivery: _onOpenDelivery,
}: Props) {
  void _onOpenDelivery;
  const navigate = useNavigate();
  const { emailProviderConnected, refreshPortalData } = useDispatcherPortal();
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [selectedDetails, setSelectedDetails] =
    useState<DeliveryDetails | null>(null);
  const [mutationLoading, setMutationLoading] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [stagingLocations, setStagingLocations] = useState<StagingLocation[]>(
    [],
  );
  const [stagingLocationsReady, setStagingLocationsReady] = useState(false);
  const pickupOperationIds = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    void firestoreDataService
      .listStagingLocations()
      .then((locs) => {
        setStagingLocations(locs);
        setStagingLocationsReady(true);
      })
      .catch(() => {
        setStagingLocationsReady(true);
      });
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
    // Refresh list rows AND portal zonesSnapshot occupancy so Staging Map
    // fallback / list chips never keep a pre-pickup occupied paint after
    // Complete Pickup clears staging (live onSnapshot is primary; snapshot
    // refresh covers navigate-away/back + hard-refresh-adjacent paths).
    await Promise.all([
      Promise.resolve(onDataChanged?.()),
      refreshPortalData(),
    ]);
  };

  /** Close drawer after a successful DeliveryStatus workflow mutation. */
  const closeAfterSuccessfulStatusChange = useCallback(() => {
    onClose();
  }, [onClose]);

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
      if (updatedDetails) {
        await refreshAfter(updatedDetails);
        closeAfterSuccessfulStatusChange();
      } else {
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
        operationId = newPickupClientOperationId();
        pickupOperationIds.current.set(deliveryId, operationId);
      }
      const jobId = selectedDetails?.delivery.jobId?.trim();
      if (!jobId) {
        throw new Error(
          "This delivery is not linked to a job — cannot record pickup.",
        );
      }
      await firestoreDataService.recordPickupEvent(
        deliveryId,
        jobId,
        technicianName,
        itemsSummary,
        undefined,
        operationId,
      );
      pickupOperationIds.current.delete(deliveryId);
      const updatedDetails =
        await firestoreDataService.getDeliveryDetails(deliveryId);
      if (updatedDetails) {
        if (updatedDetails.delivery.status !== "picked_up") {
          setMutationError(
            "Pickup saved but status did not update — refresh and try again.",
          );
          return;
        }
        showPickupCompletedToast();
        await refreshAfter(updatedDetails);
        closeAfterSuccessfulStatusChange();
      } else setMutationError("Failed to record pickup.");
    } catch (e) {
      setMutationError(formatPickupError(e));
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

  const handleUpdateFulfillmentMethod = async (
    method: "delivery" | "will_call_pickup",
  ) => {
    if (!deliveryId) return;
    setMutationLoading(true);
    setMutationError(null);
    try {
      const updatedDetails = await firestoreDataService.updateFulfillmentMethod(
        deliveryId,
        method,
      );
      if (updatedDetails) await refreshAfter(updatedDetails);
      else setMutationError("Failed to update fulfillment method.");
    } catch (e) {
      setMutationError(
        "An unexpected error occurred while updating fulfillment.",
      );
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

    if (status === "Not Delivered") {
      clearPendingManualItemReceive();
    }

    if (
      manualDeliveredRequiresPhysicalStagingGate(selectedDetails.delivery, status)
    ) {
      writePendingManualItemReceive({
        deliveryId,
        itemId,
        qtyOrdered,
        qtyReceived,
        qtyMissing,
        createdAt: new Date().toISOString(),
      });
      setMutationError(null);
      onClose();
      navigate(
        buildManualReceiveStagingNavigateUrl(deliveryId, itemId, {
          reassign: deliveryHasAnyStagingRefs(selectedDetails.delivery),
        }),
      );
      return;
    }

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
      clearPendingManualItemReceive();
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

  const handleNavigateToAssignLocation = useCallback(
    (id: string) => {
      onClose();
      navigate(`/zones?assignDelivery=${encodeURIComponent(id)}`);
    },
    [navigate, onClose],
  );

  const handleNavigateToChangeLocation = useCallback(
    (id: string) => {
      onClose();
      navigate(
        `/zones?assignDelivery=${encodeURIComponent(id)}&reassign=1`,
      );
    },
    [navigate, onClose],
  );

  const handleNavigateToStagingMap = useCallback(
    (spotCode: string) => {
      onClose();
      navigate(`/zones?focusSpot=${encodeURIComponent(spotCode)}`);
    },
    [navigate, onClose],
  );

  if (!deliveryId) return null;

  return (
    <div
      data-testid="delivery-detail-drawer"
      data-delivery-id={deliveryId}
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
        className="admin-card"
        style={{
          height: "100%",
          width: "100%",
          maxWidth: 480,
          backgroundColor: "var(--admin-surface)",
          border: "1px solid var(--admin-border)",
          borderRadius: "var(--admin-radius-lg) 0 0 var(--admin-radius-lg)",
          boxShadow: "var(--admin-shadow-card)",
          padding: 0,
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
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            padding: "15px 20px",
            borderBottom: "1px solid var(--admin-border)",
            position: "sticky",
            top: 0,
            backgroundColor: "var(--admin-surface)",
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
                color: "var(--admin-accent-soft)",
              }}
            >
              Delivery Details
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: 12,
                color: "var(--admin-text-muted)",
                marginTop: 2,
              }}
            >
              Click outside or press Esc to close
            </p>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 8,
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              className="admin-btn"
              data-testid="delivery-drawer-close"
              onClick={onClose}
              style={{
                padding: "0 14px",
                border: "1px solid var(--admin-border)",
                borderRadius: "var(--admin-control-radius)",
                backgroundColor: "var(--admin-surface-2)",
                color: "var(--admin-text)",
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer",
                outline: "none",
                fontFamily: FONT,
              }}
            >
              ✕ Close
            </button>
            <ViewOriginalPdfButton
              vendorInvoiceImportId={
                selectedDetails?.delivery.vendorInvoiceImportId
              }
              font={FONT}
            />
          </div>
        </div>

        <div style={{ padding: "var(--admin-space-5)", flex: 1 }}>
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
            onUpdateFulfillmentMethod={handleUpdateFulfillmentMethod}
            onUpdateIssueSummary={handleUpdateIssueSummary}
            onSetDeliverToSiteConfirmed={handleSetDeliverToSiteConfirmed}
            onUpdateItemReceiptStatus={handleUpdateItemReceiptStatus}
            onUpdateShopStockPickList={handleUpdateShopStockPickList}
            stagingLocations={stagingLocations}
            stagingLocationsReady={stagingLocationsReady}
            onResolveMaterialIssue={handleResolveMaterialIssue}
            emailProviderConnected={emailProviderConnected}
            onNavigateToAssignLocation={handleNavigateToAssignLocation}
            onNavigateToChangeLocation={handleNavigateToChangeLocation}
            onNavigateToStagingMap={handleNavigateToStagingMap}
            onJobReleased={() => void onDataChanged?.()}
          />
        </div>
      </div>
    </div>
  );
}
