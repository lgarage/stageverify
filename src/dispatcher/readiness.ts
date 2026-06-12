import type {
  DeliveryOrder,
  DeliveryStatus,
  Item,
  PurchaseOrder,
  ReadinessStatus,
} from "./models";
import { getAllStagingLocationIds } from "./models";

/** Evidence sources distinguishable in audit history. */
export type ReadinessEvidenceSource =
  | "vendor_email"
  | "physical_checkin"
  | "dispatcher"
  | "system";

export interface DeliveryReadinessEvidence {
  vendorOrderComplete: boolean;
  vendorOrderCompleteAt?: string;
  vendorOrderCompleteSource?: ReadinessEvidenceSource;
  physicalDropoffComplete: boolean;
  physicalDropoffCompleteAt?: string;
  stagingAssignmentComplete: boolean;
  readinessBlockReasons: string[];
}

export interface DeliveryReadinessResult {
  readyForPickup: boolean;
  readinessStatus: ReadinessStatus;
  deliveryStatus: DeliveryStatus;
  evidence: DeliveryReadinessEvidence;
}

export interface POReadinessResult {
  poId: string;
  readyForPickup: boolean;
  deliveryResults: DeliveryReadinessResult[];
  blockReasons: string[];
}

export interface JobReadinessResult {
  jobId: string;
  allReadyForPickup: boolean;
  poResults: POReadinessResult[];
  deliveryResults: DeliveryReadinessResult[];
  blockReasons: string[];
}

function hasOutstandingQuantities(items: Item[]): boolean {
  return items.some(
    (item) =>
      item.qtyReceived < item.qtyOrdered ||
      item.qtyMissing > 0 ||
      item.qtyBackordered > 0,
  );
}

function hasUnresolvedDamage(items: Item[]): boolean {
  return items.some((item) => item.qtyDamaged > 0);
}

/** Physical drop-off: all required qty received, no shortage/backorder/damage outstanding. */
export function computePhysicalDropoffComplete(items: Item[]): boolean {
  if (items.length === 0) return false;
  if (hasOutstandingQuantities(items)) return false;
  if (hasUnresolvedDamage(items)) return false;
  return items.every((item) => item.qtyReceived === item.qtyOrdered);
}

/** Staging: primary zone assigned when any material was received. */
export function computeStagingAssignmentComplete(
  delivery: Pick<
    DeliveryOrder,
    "stagingLocationId" | "additionalStagingLocationIds"
  >,
  items: Item[],
): boolean {
  const anyReceived = items.some((item) => item.qtyReceived > 0);
  if (!anyReceived) return true;
  return Boolean(delivery.stagingLocationId?.trim());
}

export function buildDeliveryReadinessEvidence(
  delivery: DeliveryOrder,
  items: Item[],
): DeliveryReadinessEvidence {
  const blockReasons: string[] = [];
  const vendorOrderComplete = delivery.vendorOrderComplete === true;
  const physicalDropoffComplete = computePhysicalDropoffComplete(items);
  const stagingAssignmentComplete = computeStagingAssignmentComplete(
    delivery,
    items,
  );
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

  return {
    vendorOrderComplete,
    vendorOrderCompleteAt: delivery.vendorOrderCompleteAt,
    vendorOrderCompleteSource: delivery.vendorOrderCompleteSource,
    physicalDropoffComplete,
    physicalDropoffCompleteAt: delivery.physicalDropoffCompleteAt,
    stagingAssignmentComplete,
    readinessBlockReasons: blockReasons,
  };
}

/**
 * Authoritative two-source readiness for one delivery.
 * Does not trust client-supplied status strings.
 */
export function computeDeliveryReadiness(
  delivery: DeliveryOrder,
  items: Item[],
): DeliveryReadinessResult {
  if (delivery.status === "picked_up" || delivery.status === "installed") {
    return {
      readyForPickup: false,
      readinessStatus: "picked_up",
      deliveryStatus: delivery.status,
      evidence: buildDeliveryReadinessEvidence(delivery, items),
    };
  }

  const evidence = buildDeliveryReadinessEvidence(delivery, items);
  const readyForPickup = evidence.readinessBlockReasons.length === 0;

  if (readyForPickup) {
    return {
      readyForPickup: true,
      readinessStatus: "ready_for_pickup",
      deliveryStatus: "ready_for_pickup",
      evidence,
    };
  }

  const anyReceived = items.some((item) => item.qtyReceived > 0);
  const vendorOnly =
    evidence.vendorOrderComplete && !evidence.physicalDropoffComplete;
  const physicalOnly =
    evidence.physicalDropoffComplete && !evidence.vendorOrderComplete;

  let deliveryStatus: DeliveryStatus = delivery.status;
  if (anyReceived || vendorOnly || physicalOnly) {
    deliveryStatus = "partial";
  } else if (delivery.status === "pending" || delivery.status === "shipped") {
    deliveryStatus = delivery.status;
  } else if (delivery.status === "arrived") {
    deliveryStatus = "arrived";
  } else if (delivery.status === "issue") {
    deliveryStatus = "issue";
  } else {
    deliveryStatus = "partial";
  }

  return {
    readyForPickup: false,
    readinessStatus: "not_ready",
    deliveryStatus,
    evidence,
  };
}

export function computePOReadiness(
  po: PurchaseOrder,
  deliveries: DeliveryOrder[],
  itemsByDelivery: Map<string, Item[]>,
): POReadinessResult {
  const poDeliveries = deliveries.filter((d) => d.purchaseOrderId === po.id);
  const deliveryResults = poDeliveries.map((delivery) =>
    computeDeliveryReadiness(
      delivery,
      itemsByDelivery.get(delivery.id) ?? [],
    ),
  );
  const blockReasons = deliveryResults.flatMap((r) =>
    r.readyForPickup ? [] : r.evidence.readinessBlockReasons,
  );
  return {
    poId: po.id,
    readyForPickup:
      poDeliveries.length > 0 &&
      deliveryResults.every((result) => result.readyForPickup),
    deliveryResults,
    blockReasons: [...new Set(blockReasons)],
  };
}

export function computeJobReadiness(
  jobId: string,
  deliveries: DeliveryOrder[],
  purchaseOrders: PurchaseOrder[],
  itemsByDelivery: Map<string, Item[]>,
): JobReadinessResult {
  const jobDeliveries = deliveries.filter((d) => d.jobId === jobId);
  const jobPOs = purchaseOrders.filter((po) => po.jobId === jobId);
  const deliveryResults = jobDeliveries.map((delivery) =>
    computeDeliveryReadiness(
      delivery,
      itemsByDelivery.get(delivery.id) ?? [],
    ),
  );
  const poResults = jobPOs.map((po) =>
    computePOReadiness(po, jobDeliveries, itemsByDelivery),
  );
  const blockReasons = deliveryResults.flatMap((r) =>
    r.readyForPickup ? [] : r.evidence.readinessBlockReasons,
  );
  return {
    jobId,
    allReadyForPickup:
      jobDeliveries.length > 0 &&
      deliveryResults.every((result) => result.readyForPickup),
    poResults,
    deliveryResults,
    blockReasons: [...new Set(blockReasons)],
  };
}

/** Locations not yet marked picked up (partial pickup support). */
export function remainingStagingLocationIds(
  delivery: DeliveryOrder,
): string[] {
  const all = getAllStagingLocationIds(delivery);
  const picked = new Set(delivery.pickedUpStagingLocationIds ?? []);
  return all.filter((id) => !picked.has(id));
}

export function isDeliveryFullyPickedUp(delivery: DeliveryOrder): boolean {
  if (delivery.status === "picked_up" || delivery.status === "installed") {
    return true;
  }
  const remaining = remainingStagingLocationIds(delivery);
  return remaining.length === 0 && getAllStagingLocationIds(delivery).length > 0;
}
