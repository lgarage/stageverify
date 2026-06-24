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
  openIssueExplanations: OpenIssueExplanation[];
  issueRows: ItemIssueRow[];
  receivedItems: ReceivedItemRow[];
}

/** Dispatcher-readable open-issue line for Issue Summary accordion. */
export interface OpenIssueExplanation {
  id: string;
  text: string;
}

const DISPATCHER_WHY_BY_BLOCK_REASON: Record<string, string> = {
  vendor_order_incomplete: "Vendor has not confirmed this order is complete",
  physical_dropoff_incomplete:
    "Physical drop-off at the shop has not been confirmed",
  staging_assignment_incomplete:
    "Received items do not have a staging location assigned",
  unresolved_blocking_issues: "Open blocking material issues must be resolved",
  unresolved_damage: "Reported item damage has not been resolved",
  unresolved_backorder: "One or more items are on backorder",
};

const DISPATCHER_NEXT_BY_BLOCK_REASON: Record<string, string> = {
  vendor_order_incomplete:
    "Call or email vendor to confirm order status and delivery schedule",
  physical_dropoff_incomplete:
    "Verify physical drop-off when material arrives; update received quantities",
  staging_assignment_incomplete: "Assign a staging location for received items",
  unresolved_blocking_issues:
    "Resolve blocking material issues using Resolve Issue below",
  unresolved_damage: "Review and resolve reported item damage with the vendor",
  unresolved_backorder:
    "Confirm backorder ETA or alternate sourcing with the vendor",
};

export interface DrawerActionBannerContent {
  attentionHeadline: string;
  whyBullets: string[];
  nextStepBullets: string[];
  resolveDisabledReason: string;
  showReviewIssues: boolean;
  showCallVendor: boolean;
  showEmailVendor: boolean;
}

function explainItemIssueRow(row: ItemIssueRow): string {
  if (row.status === "Not Delivered") {
    return `${row.description} — none of ${row.qty} ordered unit${row.qty === 1 ? "" : "s"} received yet`;
  }
  if (row.status === "Partial Delivery") {
    return `${row.description} — ${row.qty} unit${row.qty === 1 ? "" : "s"} still outstanding`;
  }
  if (row.status === "Backordered") {
    return `${row.description} — ${row.qty} unit${row.qty === 1 ? "" : "s"} on backorder`;
  }
  return `${row.description} — ${row.status}`;
}

export function buildOpenIssueExplanations(
  delivery: DeliveryOrder,
  items: Item[],
  materialIssues: MaterialIssue[] | undefined,
  issueRows: ItemIssueRow[],
  options?: ReadinessComputeOptions,
): OpenIssueExplanation[] {
  const display = computeDeliveryDisplayState(
    delivery,
    items,
    materialIssues,
    options,
  );
  const explanations: OpenIssueExplanation[] = [];
  const seen = new Set<string>();

  const push = (id: string, text: string) => {
    if (seen.has(text)) return;
    seen.add(text);
    explanations.push({ id, text });
  };

  if (issueRows.length === 0) {
    for (const reason of display.readiness.evidence.readinessBlockReasons) {
      const text = DISPATCHER_WHY_BY_BLOCK_REASON[reason];
      if (text) push(`reason-${reason}`, text);
    }
    const itemsReceivedCount = sumItemQtyReceived(items);
    const itemsTotalCount = sumItemQtyOrdered(items);
    if (itemsReceivedCount === 0 && itemsTotalCount > 0) {
      push(
        "no-material-received",
        `No materials received at the shop yet (${itemsReceivedCount} of ${itemsTotalCount} units)`,
      );
    }
  }

  for (const row of issueRows) {
    push(`item-${row.itemId}`, explainItemIssueRow(row));
  }

  if (materialIssues) {
    for (const issue of materialIssues) {
      if (!OPEN_ISSUE_STATUSES.has(issue.status)) continue;
      const typeLabel = MATERIAL_ISSUE_TYPE_LABEL[issue.type];
      const desc = issue.description?.trim();
      push(
        `material-${issue.id}`,
        desc ? `${typeLabel}: ${desc}` : `${typeLabel} reported — needs review`,
      );
    }
  }

  return explanations;
}

export function buildDrawerActionBannerContent(
  delivery: DeliveryOrder,
  items: Item[],
  materialIssues: MaterialIssue[] | undefined,
  options?: {
    emailReviewRequired?: boolean;
    vendorPhone?: string;
    vendorEmail?: string;
  },
  computeOptions?: ReadinessComputeOptions,
): DrawerActionBannerContent {
  const display = computeDeliveryDisplayState(
    delivery,
    items,
    materialIssues,
    computeOptions,
  );
  const panel = buildIssueSummaryPanelData(
    delivery,
    items,
    materialIssues,
    computeOptions,
  );
  const whyBullets: string[] = [];
  const nextStepBullets: string[] = [];
  const seenWhy = new Set<string>();
  const seenNext = new Set<string>();

  const pushWhy = (text: string) => {
    if (seenWhy.has(text)) return;
    seenWhy.add(text);
    whyBullets.push(text);
  };
  const pushNext = (text: string) => {
    if (seenNext.has(text)) return;
    seenNext.add(text);
    nextStepBullets.push(text);
  };

  if (options?.emailReviewRequired) {
    pushWhy("Vendor email proposal needs dispatcher review");
    pushNext("Review vendor email proposals in Vendor Communications");
  }

  for (const reason of display.readiness.evidence.readinessBlockReasons) {
    const why = DISPATCHER_WHY_BY_BLOCK_REASON[reason];
    const next = DISPATCHER_NEXT_BY_BLOCK_REASON[reason];
    if (why) pushWhy(why);
    if (next) pushNext(next);
  }

  if (
    panel.itemsReceivedCount === 0 &&
    panel.itemsTotalCount > 0 &&
    display.readiness.evidence.readinessBlockReasons.includes(
      "physical_dropoff_incomplete",
    )
  ) {
    pushWhy(
      `No materials received at the shop yet (${panel.itemsReceivedCount} of ${panel.itemsTotalCount} units)`,
    );
  }

  for (const issue of openBlockingMaterialIssues(materialIssues)) {
    const typeLabel = MATERIAL_ISSUE_TYPE_LABEL[issue.type];
    const desc = issue.description?.trim();
    pushWhy(
      desc
        ? `Blocking ${typeLabel.toLowerCase()}: ${desc}`
        : `Blocking ${typeLabel.toLowerCase()} must be resolved`,
    );
    if (!seenNext.has("Resolve blocking material issues using Resolve Issue below")) {
      pushNext("Resolve blocking material issues using Resolve Issue below");
    }
  }

  for (const row of panel.issueRows) {
    if (row.status === "Backordered") {
      pushWhy(explainItemIssueRow(row));
    }
  }

  if (
    !delivery.stagingLocationId?.trim() &&
    items.some((item) => item.qtyReceived > 0)
  ) {
    pushWhy("Received items do not have a staging location assigned");
    pushNext("Assign a staging location for received items");
  }

  if (whyBullets.length === 0 && !display.readiness.readyForPickup) {
    pushWhy(display.statusDisplayLabel);
  }
  if (nextStepBullets.length === 0 && !display.readiness.readyForPickup) {
    pushNext("Review delivery readiness evidence and take corrective action");
  }

  const openBlockingIssueCount = display.openBlockingIssueCount;
  let resolveDisabledReason: string;
  if (openBlockingIssueCount > 0) {
    resolveDisabledReason =
      "Opens resolve flow for the first blocking material issue";
  } else if (panel.openIssuesCount > 0) {
    resolveDisabledReason =
      "No blocking material issue — review open items below or contact vendor";
  } else if (options?.emailReviewRequired) {
    resolveDisabledReason =
      "No material issue to resolve — review vendor email in Vendor Communications";
  } else {
    resolveDisabledReason = "No open blocking material issue to resolve";
  }

  const vendorPhone = options?.vendorPhone?.trim() ?? "";
  const vendorEmail = options?.vendorEmail?.trim() ?? "";

  return {
    attentionHeadline: display.readiness.readyForPickup
      ? "Review required before pickup"
      : "Order not ready for pickup",
    whyBullets,
    nextStepBullets,
    resolveDisabledReason,
    showReviewIssues:
      panel.openIssuesCount > 0 ||
      openBlockingMaterialIssues(materialIssues).length > 0,
    showCallVendor: vendorPhone.length > 0,
    showEmailVendor: vendorEmail.length > 0,
  };
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
  const openIssueExplanations = buildOpenIssueExplanations(
    delivery,
    items,
    materialIssues,
    issueRows,
    options,
  );

  return {
    deliveryStatusLabel: display.statusDisplayLabel,
    itemsReceivedCount,
    itemsTotalCount,
    openIssuesCount,
    openIssueExplanations,
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
