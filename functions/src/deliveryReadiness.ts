/** Server-side two-source readiness (mirrors src/dispatcher/readiness.ts). */

import { skipsShopStaging } from "./invoice/invoiceShellDisplayHelpers";
import type { InvoiceFulfillmentMethod } from "./invoice/types";

export type DeliveryStatus =
  | "pending"
  | "shipped"
  | "arrived"
  | "partial"
  | "ready_for_pickup"
  | "complete"
  | "issue"
  | "picked_up"
  | "installed";

export type ReadinessStatus =
  | "ordering"
  | "not_ready"
  | "ready_for_pickup"
  | "picked_up";

export type VendorDeliveryMode = "full_checkin" | "exception_only";

export interface DeliveryDoc {
  id?: string;
  status: DeliveryStatus;
  vendorOrderComplete?: boolean;
  vendorOrderCompleteAt?: string;
  vendorOrderCompleteSource?: string;
  vendorPhysicalDropoffConfirmed?: boolean;
  vendorPhysicalDropoffConfirmedAt?: string;
  deliveredAt?: string;
  physicalDropoffSource?: string;
  vendorDeliveryMode?: VendorDeliveryMode;
  physicalDropoffComplete?: boolean;
  physicalDropoffCompleteAt?: string;
  stagingAssignmentComplete?: boolean;
  stagingLocationId?: string;
  additionalStagingLocationIds?: string[];
  plannedStagingLocationIds?: string[];
  openBlockingIssueCount?: number;
  vendorInvoiceImportId?: string;
  invoiceImportStatus?: string;
  invoiceFulfillmentMethod?: InvoiceFulfillmentMethod;
  invoiceDeliverToSite?: boolean;
  createdFromInvoiceImport?: boolean;
}

export interface ItemDoc {
  qtyOrdered: number;
  qtyReceived: number;
  qtyMissing: number;
  qtyDamaged: number;
  qtyBackordered: number;
}

export interface DeliveryReadinessEvidence {
  vendorOrderComplete: boolean;
  physicalDropoffComplete: boolean;
  stagingAssignmentComplete: boolean;
  readinessBlockReasons: string[];
}

export interface DeliveryReadinessResult {
  readyForPickup: boolean;
  readinessStatus: ReadinessStatus;
  deliveryStatus: DeliveryStatus;
  evidence: DeliveryReadinessEvidence;
  physicalDropoffComplete: boolean;
  physicalDropoffCompleteAt?: string;
  stagingAssignmentComplete: boolean;
}

function hasOutstandingQuantities(items: ItemDoc[]): boolean {
  return items.some(
    (item) =>
      item.qtyReceived < item.qtyOrdered ||
      item.qtyMissing > 0 ||
      item.qtyBackordered > 0,
  );
}

function hasUnresolvedDamage(items: ItemDoc[]): boolean {
  return items.some((item) => item.qtyDamaged > 0);
}

function hasExceptionOnlyItemConflicts(items: ItemDoc[]): boolean {
  return items.some(
    (item) =>
      item.qtyMissing > 0 ||
      item.qtyDamaged > 0 ||
      item.qtyBackordered > 0,
  );
}

function computeQtyBasedPhysicalDropoffComplete(items: ItemDoc[]): boolean {
  if (items.length === 0) return false;
  if (hasOutstandingQuantities(items) || hasUnresolvedDamage(items)) return false;
  return items.every((item) => item.qtyReceived === item.qtyOrdered);
}

/** Physical drop-off: qty check-in (full_checkin) or vendor DELIVERED evidence (exception_only). */
export function computePhysicalDropoffComplete(
  delivery: Pick<DeliveryDoc, "vendorPhysicalDropoffConfirmed">,
  items: ItemDoc[],
  vendorDeliveryMode?: VendorDeliveryMode,
): boolean {
  const mode = vendorDeliveryMode ?? "full_checkin";

  if (mode === "exception_only") {
    if (delivery.vendorPhysicalDropoffConfirmed !== true) return false;
    if (items.length === 0) return false;
    return !hasExceptionOnlyItemConflicts(items);
  }

  return computeQtyBasedPhysicalDropoffComplete(items);
}

/**
 * Shop staging assignment present on the delivery document (display SoT parity).
 * Counts stagingLocationId, additionalStagingLocationIds, and plannedStagingLocationIds.
 * plannedStagingLocationIds is the Invoice Review / Assign Location write until a later
 * path promotes to stagingLocationId — compatibility fallback so readiness matches UI.
 */
export function deliveryHasCurrentShopStagingAssignment(
  delivery: Pick<
    DeliveryDoc,
    | "stagingLocationId"
    | "additionalStagingLocationIds"
    | "plannedStagingLocationIds"
  >,
): boolean {
  if (delivery.stagingLocationId?.trim()) return true;
  if (
    (delivery.additionalStagingLocationIds ?? []).some(
      (id) => typeof id === "string" && id.trim().length > 0,
    )
  ) {
    return true;
  }
  if (
    (delivery.plannedStagingLocationIds ?? []).some(
      (id) => typeof id === "string" && id.trim().length > 0,
    )
  ) {
    return true;
  }
  return false;
}

/** Physical + planned shop staging ids (parity with FE collectDeliveryStagingCodes id union). */
export function getShopStagingAssignmentIds(
  delivery: Pick<
    DeliveryDoc,
    | "stagingLocationId"
    | "additionalStagingLocationIds"
    | "plannedStagingLocationIds"
  >,
): string[] {
  const ids = new Set<string>();
  if (delivery.stagingLocationId?.trim()) {
    ids.add(delivery.stagingLocationId.trim());
  }
  for (const id of delivery.additionalStagingLocationIds ?? []) {
    if (typeof id === "string" && id.trim()) ids.add(id.trim());
  }
  for (const id of delivery.plannedStagingLocationIds ?? []) {
    if (typeof id === "string" && id.trim()) ids.add(id.trim());
  }
  return [...ids];
}

export function computeStagingAssignmentComplete(
  delivery: Pick<
    DeliveryDoc,
    | "stagingLocationId"
    | "additionalStagingLocationIds"
    | "plannedStagingLocationIds"
    | "vendorPhysicalDropoffConfirmed"
  >,
  items: ItemDoc[],
): boolean {
  const anyReceived = items.some((item) => item.qtyReceived > 0);
  const vendorConfirmedDropoff = delivery.vendorPhysicalDropoffConfirmed === true;
  if (!anyReceived && !vendorConfirmedDropoff) return true;
  return deliveryHasCurrentShopStagingAssignment(delivery);
}

export function computeDeliveryReadiness(
  delivery: DeliveryDoc,
  items: ItemDoc[],
  now: string,
  vendorDeliveryMode?: VendorDeliveryMode,
): DeliveryReadinessResult {
  const physicalDropoffComplete = computePhysicalDropoffComplete(
    delivery,
    items,
    vendorDeliveryMode,
  );
  const stagingAssignmentComplete = computeStagingAssignmentComplete(
    delivery,
    items,
  );
  const physicalDropoffCompleteAt = physicalDropoffComplete
    ? delivery.physicalDropoffCompleteAt ??
      delivery.vendorPhysicalDropoffConfirmedAt ??
      now
    : undefined;

  const blockReasons: string[] = [];
  const vendorOrderComplete = delivery.vendorOrderComplete === true;
  const blockingIssues = (delivery.openBlockingIssueCount ?? 0) > 0;
  const skipShopReceipt = skipsShopStaging(delivery);

  if (!vendorOrderComplete) blockReasons.push("vendor_order_incomplete");
  if (!physicalDropoffComplete && !skipShopReceipt) {
    blockReasons.push("physical_dropoff_incomplete");
  }
  if (!stagingAssignmentComplete && !skipShopReceipt) {
    blockReasons.push("staging_assignment_incomplete");
  }
  if (blockingIssues) blockReasons.push("unresolved_blocking_issues");
  if (hasUnresolvedDamage(items)) blockReasons.push("unresolved_damage");
  if (items.some((item) => item.qtyBackordered > 0)) {
    blockReasons.push("unresolved_backorder");
  }

  const evidence: DeliveryReadinessEvidence = {
    vendorOrderComplete,
    physicalDropoffComplete,
    stagingAssignmentComplete,
    readinessBlockReasons: blockReasons,
  };

  if (delivery.status === "picked_up" || delivery.status === "installed") {
    return {
      readyForPickup: false,
      readinessStatus: "picked_up",
      deliveryStatus: delivery.status,
      evidence,
      physicalDropoffComplete,
      physicalDropoffCompleteAt,
      stagingAssignmentComplete,
    };
  }

  if (delivery.invoiceImportStatus === "closed_picked_up") {
    return {
      readyForPickup: false,
      readinessStatus: "picked_up",
      deliveryStatus: "picked_up",
      evidence,
      physicalDropoffComplete,
      physicalDropoffCompleteAt,
      stagingAssignmentComplete,
    };
  }

  const readyForPickup = blockReasons.length === 0;
  if (readyForPickup) {
    return {
      readyForPickup: true,
      readinessStatus: "ready_for_pickup",
      deliveryStatus: "ready_for_pickup",
      evidence,
      physicalDropoffComplete,
      physicalDropoffCompleteAt,
      stagingAssignmentComplete,
    };
  }

  const anyReceived = items.some((item) => item.qtyReceived > 0);
  const vendorOnly = vendorOrderComplete && !physicalDropoffComplete;
  const physicalOnly = physicalDropoffComplete && !vendorOrderComplete;

  let deliveryStatus: DeliveryStatus;
  if (anyReceived) {
    deliveryStatus = "partial";
  } else if (vendorOnly || physicalOnly) {
    // One-source evidence with zero qty — not qty-partial.
    deliveryStatus =
      delivery.status === "pending" || delivery.status === "shipped"
        ? delivery.status
        : "arrived";
  } else if (
    delivery.status === "pending" ||
    delivery.status === "shipped" ||
    delivery.status === "arrived" ||
    delivery.status === "issue"
  ) {
    deliveryStatus = delivery.status;
  } else {
    deliveryStatus = "partial";
  }

  return {
    readyForPickup: false,
    readinessStatus: "not_ready",
    deliveryStatus,
    evidence,
    physicalDropoffComplete,
    physicalDropoffCompleteAt,
    stagingAssignmentComplete,
  };
}

/** Pickup eligibility: blocking issues may block readiness promotion only. */
export function isPickupEligible(
  delivery: DeliveryDoc,
  items: ItemDoc[],
  vendorDeliveryMode?: VendorDeliveryMode,
): { eligible: boolean; reason?: string } {
  if (delivery.status === "picked_up" || delivery.status === "installed") {
    return { eligible: false, reason: "already_picked_up" };
  }

  const skipShopStagingPickup = skipsShopStaging(delivery);
  const allowedStatuses: DeliveryStatus[] = skipShopStagingPickup
    ? [
        "pending",
        "shipped",
        "arrived",
        "partial",
        "ready_for_pickup",
        "complete",
      ]
    : ["ready_for_pickup", "complete", "partial", "arrived"];

  if (!allowedStatuses.includes(delivery.status)) {
    return { eligible: false, reason: "delivery_not_ready_for_pickup" };
  }

  const readiness = computeDeliveryReadiness(
    delivery,
    items,
    new Date().toISOString(),
    vendorDeliveryMode,
  );
  const pickupBlockReasons = readiness.evidence.readinessBlockReasons.filter(
    (reason) => reason !== "unresolved_blocking_issues",
  );
  if (pickupBlockReasons.length > 0) {
    return {
      eligible: false,
      reason: pickupBlockReasons.join(", ") || "not_ready",
    };
  }
  return { eligible: true };
}

/**
 * Dispatcher manual-pickup authority — records actual pickup even when system
 * readiness is incomplete. Does not replace {@link isPickupEligible} (token /
 * technician paths stay readiness-gated).
 */
export function isDispatcherPickupEligible(
  delivery: DeliveryDoc,
  items: ItemDoc[],
  vendorDeliveryMode?: VendorDeliveryMode,
): {
  eligible: boolean;
  reason?: string;
  readiness: DeliveryReadinessResult;
} {
  const readiness = computeDeliveryReadiness(
    delivery,
    items,
    new Date().toISOString(),
    vendorDeliveryMode,
  );
  if (delivery.status === "picked_up" || delivery.status === "installed") {
    return { eligible: false, reason: "already_picked_up", readiness };
  }

  const allowedStatuses: DeliveryStatus[] = [
    "pending",
    "shipped",
    "arrived",
    "partial",
    "ready_for_pickup",
    "complete",
  ];
  if (!allowedStatuses.includes(delivery.status)) {
    return {
      eligible: false,
      reason: "delivery_not_pickup_eligible",
      readiness,
    };
  }
  return { eligible: true, readiness };
}
