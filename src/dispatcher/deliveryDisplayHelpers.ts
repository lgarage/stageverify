import type { DeliveryOrder, Item, MaterialIssue } from "./models";
import { MATERIAL_ISSUE_TYPE_LABEL } from "./models";
import { deliveryReadinessDisplayLabel } from "./jobReadinessDisplay";
import {
  computeDeliveryReadiness,
  type DeliveryReadinessResult,
  type ReadinessComputeOptions,
} from "./readiness";

export const READINESS_BLOCK_LABEL: Record<string, string> = {
  vendor_order_incomplete: "Vendor order not complete",
  physical_dropoff_incomplete: "Physical drop-off not complete",
  staging_assignment_incomplete: "Staging location not assigned",
  unresolved_blocking_issues: "Open blocking material issues",
  unresolved_damage: "Unresolved damage on items",
  unresolved_backorder: "Unresolved backorder on items",
};

const OPEN_ISSUE_STATUSES = new Set(["open", "assigned"]);

export function sumItemQtyOrdered(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.qtyOrdered, 0);
}

export function sumItemQtyReceived(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.qtyReceived, 0);
}

export function countOpenMaterialIssues(
  materialIssues?: MaterialIssue[],
): number {
  if (!materialIssues) return 0;
  return materialIssues.filter((issue) => OPEN_ISSUE_STATUSES.has(issue.status))
    .length;
}

/** Prefer live materialIssues over persisted delivery counters when available. */
export function countOpenBlockingIssues(
  delivery: Pick<DeliveryOrder, "openBlockingIssueCount">,
  materialIssues?: MaterialIssue[],
): number {
  if (materialIssues !== undefined) {
    return materialIssues.filter(
      (issue) =>
        OPEN_ISSUE_STATUSES.has(issue.status) && issue.blocking === true,
    ).length;
  }
  return delivery.openBlockingIssueCount ?? 0;
}

export function openBlockingMaterialIssues(
  materialIssues?: MaterialIssue[],
): MaterialIssue[] {
  if (!materialIssues) return [];
  return materialIssues.filter(
    (issue) =>
      OPEN_ISSUE_STATUSES.has(issue.status) && issue.blocking === true,
  );
}

export interface DeliveryDisplayState {
  readiness: DeliveryReadinessResult;
  statusDisplayLabel: string;
  issueSummary: string;
  actionRequired: boolean;
  blockerLabels: string[];
  openIssueCount: number;
  openBlockingIssueCount: number;
}

export function computeDeliveryDisplayState(
  delivery: DeliveryOrder,
  items: Item[],
  materialIssues?: MaterialIssue[],
  options?: ReadinessComputeOptions,
): DeliveryDisplayState {
  const openBlockingIssueCount = countOpenBlockingIssues(
    delivery,
    materialIssues,
  );
  const readiness = computeDeliveryReadiness(delivery, items, {
    ...options,
    openBlockingIssueCount,
  });
  const statusDisplayLabel = deliveryReadinessDisplayLabel(
    delivery,
    readiness,
    items,
    materialIssues,
  );
  const blockerLabels = buildBlockerLabels(
    delivery,
    items,
    materialIssues,
    readiness,
  );
  const issueSummary = buildComputedIssueSummary(
    delivery,
    items,
    materialIssues,
    readiness,
  );
  const openIssueCount =
    materialIssues !== undefined
      ? countOpenMaterialIssues(materialIssues)
      : (delivery.openIssueCount ?? 0);

  return {
    readiness,
    statusDisplayLabel,
    issueSummary,
    actionRequired: blockerLabels.length > 0 || !readiness.readyForPickup,
    blockerLabels,
    openIssueCount,
    openBlockingIssueCount,
  };
}

function buildBlockerLabels(
  delivery: DeliveryOrder,
  items: Item[],
  materialIssues: MaterialIssue[] | undefined,
  readiness: DeliveryReadinessResult,
): string[] {
  const labels: string[] = [];
  for (const reason of readiness.evidence.readinessBlockReasons) {
    const label = READINESS_BLOCK_LABEL[reason];
    if (label && !labels.includes(label)) {
      labels.push(label);
    }
  }
  if (
    !delivery.stagingLocationId?.trim() &&
    items.some((item) => item.qtyReceived > 0) &&
    !labels.includes("Staging location not assigned")
  ) {
    labels.push("Staging location not assigned");
  }
  for (const issue of openBlockingMaterialIssues(materialIssues)) {
    const line = `${MATERIAL_ISSUE_TYPE_LABEL[issue.type]}: ${issue.description?.trim() || "No description"}`;
    if (!labels.includes(line)) {
      labels.push(line);
    }
  }
  return labels;
}

function buildComputedIssueSummary(
  delivery: DeliveryOrder,
  items: Item[],
  materialIssues: MaterialIssue[] | undefined,
  readiness: DeliveryReadinessResult,
): string {
  if (readiness.readyForPickup) {
    return "";
  }

  const blockingIssues = openBlockingMaterialIssues(materialIssues);
  if (blockingIssues.length > 0) {
    const first = blockingIssues[0];
    const typeLabel = MATERIAL_ISSUE_TYPE_LABEL[first.type];
    const desc = first.description?.trim();
    const suffix =
      blockingIssues.length > 1
        ? ` (+${blockingIssues.length - 1} more)`
        : "";
    return desc ? `${typeLabel}: ${desc}${suffix}` : `${typeLabel}${suffix}`;
  }

  const reasons = readiness.evidence.readinessBlockReasons;
  if (reasons.includes("unresolved_backorder")) {
    const backordered = items.filter((item) => item.qtyBackordered > 0);
    if (backordered.length > 0) {
      return backordered.length === 1
        ? "1 item backordered"
        : `${backordered.length} items backordered`;
    }
  }
  if (reasons.includes("unresolved_damage")) {
    return "Unresolved damage";
  }
  if (reasons.includes("staging_assignment_incomplete")) {
    return "Staging not assigned";
  }
  if (reasons.includes("vendor_order_incomplete")) {
    return "Vendor order incomplete";
  }
  if (reasons.includes("physical_dropoff_incomplete")) {
    const missingQty = items.reduce((sum, item) => sum + item.qtyMissing, 0);
    if (missingQty > 0) {
      return missingQty === 1 ? "1 item missing" : `${missingQty} items missing`;
    }
    return "Physical drop-off incomplete";
  }
  if (reasons.includes("unresolved_blocking_issues")) {
    return "Open blocking issues";
  }

  const openCount =
    materialIssues !== undefined
      ? countOpenMaterialIssues(materialIssues)
      : (delivery.openIssueCount ?? 0);
  const manualSummary = delivery.issueSummary?.trim() ?? "";
  if (openCount > 0 && manualSummary) {
    return manualSummary;
  }

  return "";
}

export type ItemIssueDisplayStatus =
  | "Backordered"
  | "Not Delivered"
  | "Partial Delivery"
  | "Delivered"
  | "Resolved";

export interface ItemIssueRow {
  itemId: string;
  description: string;
  qty: number;
  status: ItemIssueDisplayStatus;
}

export interface ReceivedItemRow {
  itemId: string;
  description: string;
  qty: number;
}

export interface IssueSummaryPanelData {
  deliveryStatusLabel: string;
  itemsReceivedCount: number;
  itemsTotalCount: number;
  openIssuesCount: number;
  issueRows: ItemIssueRow[];
  receivedItems: ReceivedItemRow[];
}

export const ITEM_ISSUE_STATUS_COLOR: Record<ItemIssueDisplayStatus, string> = {
  Backordered: "#f57c00",
  "Not Delivered": "#c62828",
  "Partial Delivery": "#d97706",
  Delivered: "#2e7d32",
  Resolved: "#2e7d32",
};

export function deriveItemIssueDisplayStatus(
  item: Item,
): ItemIssueDisplayStatus | null {
  const outstanding = item.qtyOrdered - item.qtyReceived;
  if (item.qtyBackordered > 0) {
    return "Backordered";
  }
  if (outstanding <= 0 && item.qtyReceived > 0) {
    return null;
  }
  if (item.qtyReceived === 0) {
    return "Not Delivered";
  }
  if (item.qtyReceived > 0 && item.qtyReceived < item.qtyOrdered) {
    return "Partial Delivery";
  }
  return null;
}

export function deriveItemIssueQty(item: Item, status: ItemIssueDisplayStatus): number {
  if (status === "Backordered") {
    return item.qtyBackordered;
  }
  if (status === "Not Delivered") {
    return item.qtyOrdered;
  }
  if (status === "Partial Delivery") {
    return item.qtyOrdered - item.qtyReceived;
  }
  return item.qtyOrdered;
}

export function buildIssueSummaryPanelData(
  delivery: DeliveryOrder,
  items: Item[],
  materialIssues: MaterialIssue[] | undefined,
  options?: ReadinessComputeOptions,
): IssueSummaryPanelData {
  const display = computeDeliveryDisplayState(
    delivery,
    items,
    materialIssues,
    options,
  );
  const itemsTotalCount = sumItemQtyOrdered(items);
  const itemsReceivedCount = sumItemQtyReceived(items);

  const issueRows: ItemIssueRow[] = [];
  for (const item of items) {
    const status = deriveItemIssueDisplayStatus(item);
    if (!status) continue;
    issueRows.push({
      itemId: item.id,
      description: item.description,
      qty: deriveItemIssueQty(item, status),
      status,
    });
  }

  const receivedItems: ReceivedItemRow[] = items
    .filter((item) => item.qtyReceived > 0)
    .map((item) => ({
      itemId: item.id,
      description: item.description,
      qty: item.qtyReceived,
    }));

  const openMaterialCount = countOpenMaterialIssues(materialIssues);
  const openIssuesCount = issueRows.length + openMaterialCount;

  return {
    deliveryStatusLabel: display.statusDisplayLabel,
    itemsReceivedCount,
    itemsTotalCount,
    openIssuesCount,
    issueRows,
    receivedItems,
  };
}

const RECOMMENDED_ACTION_BY_BLOCKER: Record<string, string> = {
  "Vendor order not complete":
    "Confirm vendor order completion or review pending vendor email",
  "Physical drop-off not complete":
    "Follow up on outstanding delivery items with the vendor",
  "Staging location not assigned":
    "Assign a staging location for received items",
  "Open blocking material issues":
    "Resolve open blocking material issues before pickup",
  "Unresolved damage on items": "Review and resolve reported item damage",
  "Unresolved backorder on items":
    "Confirm backorder ETA or alternate sourcing with vendor",
  "Vendor email needs review": "Review vendor email proposals in Vendor Communications",
};

export function buildRecommendedActions(blockerLabels: string[]): string[] {
  const actions: string[] = [];
  for (const label of blockerLabels) {
    const mapped = RECOMMENDED_ACTION_BY_BLOCKER[label];
    if (mapped && !actions.includes(mapped)) {
      actions.push(mapped);
      continue;
    }
    if (
      !mapped &&
      !label.includes(":") &&
      !actions.some((a) => a.startsWith(label))
    ) {
      actions.push(`Address: ${label}`);
      continue;
    }
    if (label.includes(":") && !actions.includes("Resolve reported material issue")) {
      actions.push("Resolve reported material issue");
    }
  }
  if (actions.length === 0) {
    actions.push("Review delivery readiness evidence and take corrective action");
  }
  return actions;
}
