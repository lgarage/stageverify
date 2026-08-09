import type {
  DeliveryDetails,
  DeliveryOrder,
  DeliveryStatus,
  VendorPinBootstrap,
} from "./models";

const DELIVERY_STATUSES = new Set<string>([
  "pending",
  "shipped",
  "arrived",
  "partial",
  "ready_for_pickup",
  "complete",
  "issue",
  "picked_up",
  "installed",
]);

function asStatus(value: string | undefined): DeliveryStatus {
  if (value && DELIVERY_STATUSES.has(value)) {
    return value as DeliveryStatus;
  }
  return "pending";
}

/** Build a hub-safe DeliveryDetails shell from PIN bootstrap (no items yet). */
export function deliveryDetailsFromVendorPinBootstrap(
  bootstrap: VendorPinBootstrap,
): DeliveryDetails {
  const now = new Date().toISOString();
  const delivery: DeliveryOrder = {
    id: bootstrap.deliveryId,
    orderNumber: bootstrap.orderNumber?.trim() || bootstrap.deliveryId,
    jobId: bootstrap.jobId?.trim() || "",
    vendorId: bootstrap.vendorId,
    vendorName: bootstrap.vendorName,
    purchaseOrderId: bootstrap.purchaseOrderId,
    deliveryDate: bootstrap.deliveryDate?.trim() || now.slice(0, 10),
    stagingLocationId: bootstrap.stagingLocationId,
    plannedStagingLocationIds: bootstrap.plannedStagingLocationIds,
    status: asStatus(bootstrap.status),
    vendorInvoiceNumber: bootstrap.vendorInvoiceNumber,
    invoiceFulfillmentMethod:
      bootstrap.invoiceFulfillmentMethod === "delivery" ||
      bootstrap.invoiceFulfillmentMethod === "will_call_pickup" ||
      bootstrap.invoiceFulfillmentMethod === "unknown"
        ? bootstrap.invoiceFulfillmentMethod
        : undefined,
    vendorPhysicalDropoffConfirmed: bootstrap.vendorPhysicalDropoffConfirmed,
    vendorPhysicalDropoffConfirmedAt:
      bootstrap.vendorPhysicalDropoffConfirmedAt,
    createdAt: now,
    updatedAt: now,
  };

  return {
    delivery,
    vendor: {
      id: bootstrap.vendorId,
      name: bootstrap.vendorName,
      createdAt: now,
    },
    job: bootstrap.jobId
      ? {
          id: bootstrap.jobId,
          jobNumber: bootstrap.jobId,
          jobName: bootstrap.jobName?.trim() || "Delivery",
          status: "active",
          createdAt: now,
          updatedAt: now,
        }
      : undefined,
    purchaseOrder:
      bootstrap.purchaseOrderId || bootstrap.poNumber
        ? {
            id: bootstrap.purchaseOrderId ?? `po-${bootstrap.deliveryId}`,
            jobId: bootstrap.jobId ?? "",
            vendorId: bootstrap.vendorId,
            poNumber: bootstrap.poNumber?.trim() || "—",
            status: "open",
          }
        : undefined,
    stagingLocation: bootstrap.stagingLocationId
      ? {
          id: bootstrap.stagingLocationId,
          code: bootstrap.stagingLocationCode?.trim() || "—",
          label: bootstrap.stagingLocationCode?.trim() || "—",
          type: "other",
          status: "Active",
        }
      : undefined,
    items: [],
    statusHistory: [],
    pickupEvents: [],
    materialIssues: [],
  };
}
