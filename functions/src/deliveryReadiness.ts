/** Server-side two-source readiness (mirrors src/dispatcher/readiness.ts). */

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
  openBlockingIssueCount?: number;
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

export function computeStagingAssignmentComplete(
  delivery: Pick<
    DeliveryDoc,
    | "stagingLocationId"
    | "additionalStagingLocationIds"
    | "vendorPhysicalDropoffConfirmed"
  >,
  items: ItemDoc[],
): boolean {
  const anyReceived = items.some((item) => item.qtyReceived > 0);
  const vendorConfirmedDropoff = delivery.vendorPhysicalDropoffConfirmed === true;
  if (!anyReceived && !vendorConfirmedDropoff) return true;
  return Boolean(delivery.stagingLocationId?.trim());
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

  if (!vendorOrderComplete) blockReasons.push("vendor_order_incomplete");
  if (!physicalDropoffComplete) blockReasons.push("physical_dropoff_incomplete");
  if (!stagingAssignmentComplete) {
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
  if (
    delivery.status !== "ready_for_pickup" &&
    delivery.status !== "complete"
  ) {
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
