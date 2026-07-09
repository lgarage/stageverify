import type {
  DeliveryDetails,
  DeliveryOrder,
  Item,
  MaterialIssue,
  PickupEvent,
  PurchaseOrder,
  StagingLocation,
  StatusHistoryEvent,
} from "./models";
import {
  DELIVERY_STATUS_LABEL,
  MATERIAL_ISSUE_TYPE_LABEL,
  getAllStagingLocationIds,
  type DeliveryStatus,
} from "./models";
import {
  buildDeliverToSiteIssueSummary,
  isDeliverToSiteConfirmed,
  isInvoiceShellNoShopStaging,
  resolveDeliveryPoNumber,
} from "./invoice/invoiceShellDisplayHelpers";
import { deliveryReadinessDisplayLabel } from "./jobReadinessDisplay";
import {
  computeDeliveryReadiness,
  type DeliveryReadinessResult,
  type ReadinessComputeOptions,
} from "./readiness";

/** D12 — derived display when planned spots exist and material is still inbound. */
export function isReservedDisplayState(
  delivery: Pick<DeliveryOrder, "plannedStagingLocationIds" | "status">,
): boolean {
  const planned = delivery.plannedStagingLocationIds ?? [];
  if (planned.length === 0) return false;
  return delivery.status === "pending" || delivery.status === "shipped";
}

export function hasPlannedStagingLocations(
  delivery: Pick<DeliveryOrder, "plannedStagingLocationIds">,
): boolean {
  return (delivery.plannedStagingLocationIds?.length ?? 0) > 0;
}

/** Planned set differs from actual staging assignment (Phase 4 divergence). */
export function hasPlannedActualDivergence(delivery: DeliveryOrder): boolean {
  const planned = [...(delivery.plannedStagingLocationIds ?? [])].sort();
  if (planned.length === 0) return false;
  const actual = [...getAllStagingLocationIds(delivery)].sort();
  return planned.join(",") !== actual.join(",");
}

export function formatActualStagingCodes(
  delivery: DeliveryOrder,
  locById: Map<string, StagingLocation>,
): string | undefined {
  const ids = getAllStagingLocationIds(delivery);
  if (ids.length === 0) return undefined;
  return ids
    .map((id) => locById.get(id)?.code?.trim() || id)
    .filter(Boolean)
    .join(", ");
}

export function formatPlannedStagingCodes(
  delivery: DeliveryOrder,
  locById: Map<string, StagingLocation>,
): string {
  const ids = delivery.plannedStagingLocationIds ?? [];
  if (ids.length === 0) return "—";
  return ids
    .map((id) => locById.get(id)?.code?.trim() || id)
    .filter(Boolean)
    .join(", ");
}

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

/** Deliver-to-site confirmed: treat full order qty as received for display/counts. */
export function isDeliverToSiteFullyReceived(
  delivery: Pick<
    DeliveryOrder,
    "invoiceDeliverToSite" | "invoiceDeliverToSiteConfirmed"
  >,
): boolean {
  return (
    delivery.invoiceDeliverToSite === true &&
    isDeliverToSiteConfirmed(delivery)
  );
}

export function effectiveItemQtyReceived(
  delivery: Pick<
    DeliveryOrder,
    "invoiceDeliverToSite" | "invoiceDeliverToSiteConfirmed"
  >,
  item: Item,
): number {
  if (isDeliverToSiteFullyReceived(delivery)) {
    return item.qtyOrdered;
  }
  return item.qtyReceived;
}

export function sumEffectiveItemQtyReceived(
  delivery: Pick<
    DeliveryOrder,
    "invoiceDeliverToSite" | "invoiceDeliverToSiteConfirmed"
  >,
  items: Item[],
): number {
  if (isDeliverToSiteFullyReceived(delivery)) {
    return sumItemQtyOrdered(items);
  }
  return sumItemQtyReceived(items);
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

export interface DeliveryDisplayOptions {
  /** List Issue Summary shows Pickup Scheduled when delivery is ready for pickup. */
  jobPickupScheduled?: boolean;
}

/** List Issue Summary when staging zone is required but unassigned. */
export const DISPATCHER_STAGING_ACTION_ISSUE_SUMMARY =
  "Assign staging location";

/**
 * Dispatcher deliveries table: dark-orange action row when staging zone is
 * missing. Display-only — does not affect drawer readiness evidence.
 * Terminal installed deliveries are excluded (closed record).
 */
export function isDispatcherTableStagingActionRequired(
  delivery: Pick<
    DeliveryOrder,
    | "stagingLocationId"
    | "status"
    | "invoiceImportStatus"
    | "invoiceFulfillmentMethod"
    | "invoiceDeliverToSite"
    | "createdFromInvoiceImport"
  >,
): boolean {
  if (delivery.status === "installed") return false;
  if (isInvoiceShellNoShopStaging(delivery)) return false;
  return !delivery.stagingLocationId?.trim();
}

export interface DeliveryDisplayState {
  readiness: DeliveryReadinessResult;
  statusDisplayLabel: string;
  issueSummary: string;
  actionRequired: boolean;
  /** Table row: delivery exists but staging zone is unassigned. */
  missingStagingAssignment: boolean;
  blockerLabels: string[];
  openIssueCount: number;
  openBlockingIssueCount: number;
}

export function computeDeliveryDisplayState(
  delivery: DeliveryOrder,
  items: Item[],
  materialIssues?: MaterialIssue[],
  options?: ReadinessComputeOptions & DeliveryDisplayOptions,
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
    options,
  );
  const openIssueCount =
    materialIssues !== undefined
      ? countOpenMaterialIssues(materialIssues)
      : (delivery.openIssueCount ?? 0);
  const missingStagingAssignment =
    isDispatcherTableStagingActionRequired(delivery);

  return {
    readiness,
    statusDisplayLabel,
    issueSummary,
    actionRequired: blockerLabels.length > 0 || !readiness.readyForPickup,
    missingStagingAssignment,
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
    !isInvoiceShellNoShopStaging(delivery) &&
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
  displayOptions?: DeliveryDisplayOptions,
): string {
  if (isDispatcherTableStagingActionRequired(delivery)) {
    return DISPATCHER_STAGING_ACTION_ISSUE_SUMMARY;
  }

  const deliverToSiteSummary = buildDeliverToSiteIssueSummary(delivery);
  if (deliverToSiteSummary) {
    return deliverToSiteSummary;
  }

  if (
    delivery.invoiceDeliverToSite === true &&
    delivery.invoiceDeliverToSiteConfirmed === true
  ) {
    return "";
  }

  if (readiness.readyForPickup) {
    if (displayOptions?.jobPickupScheduled) {
      return "Pickup Scheduled";
    }
    return "";
  }

  const reasons = readiness.evidence.readinessBlockReasons;

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

export type DrawerBannerMode = "all_clear" | "calm_waiting" | "attention_required";

export interface DrawerActionBannerContent {
  bannerMode: DrawerBannerMode;
  attentionHeadline: string;
  whyBullets: string[];
  nextStepBullets: string[];
  resolveDisabledReason: string;
  showReviewIssues: boolean;
  showReviewVendorEmail: boolean;
  showCallVendor: boolean;
  showEmailVendor: boolean;
}

const CALM_PENDING_BLOCK_REASONS = new Set([
  "vendor_order_incomplete",
  "physical_dropoff_incomplete",
]);

function vendorClaimsDelivered(delivery: DeliveryOrder): boolean {
  return (
    delivery.vendorPhysicalDropoffConfirmed === true ||
    delivery.vendorOrderComplete === true
  );
}

/** True when an item table row is a dispatcher exception (not normal pending-not-delivered). */
export function isExceptionItemIssueRow(
  row: ItemIssueRow,
  itemsReceivedCount: number,
  delivery: DeliveryOrder,
): boolean {
  if (row.status === "Backordered" || row.status === "Partial Delivery") {
    return true;
  }
  if (row.status === "Not Delivered") {
    if (itemsReceivedCount === 0 && !vendorClaimsDelivered(delivery)) {
      return false;
    }
    return true;
  }
  return false;
}

export function filterExceptionItemIssueRows(
  issueRows: ItemIssueRow[],
  itemsReceivedCount: number,
  delivery: DeliveryOrder,
): ItemIssueRow[] {
  return issueRows.filter((row) =>
    isExceptionItemIssueRow(row, itemsReceivedCount, delivery),
  );
}

function countExceptionOpenIssues(
  delivery: DeliveryOrder,
  items: Item[],
  materialIssues: MaterialIssue[] | undefined,
  issueRows: ItemIssueRow[],
): number {
  const itemsReceivedCount = sumEffectiveItemQtyReceived(delivery, items);
  const exceptionRows = filterExceptionItemIssueRows(
    issueRows,
    itemsReceivedCount,
    delivery,
  );
  return exceptionRows.length + countOpenMaterialIssues(materialIssues);
}

function shouldIncludeReadinessBlockReasonForBanner(
  reason: string,
  itemsReceivedCount: number,
  delivery: DeliveryOrder,
): boolean {
  if (
    isInvoiceShellNoShopStaging(delivery) &&
    (reason === "physical_dropoff_incomplete" ||
      reason === "staging_assignment_incomplete")
  ) {
    return false;
  }
  if (
    CALM_PENDING_BLOCK_REASONS.has(reason) &&
    itemsReceivedCount === 0 &&
    !vendorClaimsDelivered(delivery)
  ) {
    return false;
  }
  return true;
}

function deliveryNeedsVendorOutreach(
  delivery: DeliveryOrder,
  items: Item[],
  materialIssues: MaterialIssue[] | undefined,
  exceptionRows: ItemIssueRow[],
  options?: { emailReviewRequired?: boolean },
  readinessBlockReasons?: string[],
): boolean {
  if (options?.emailReviewRequired) return true;
  if (openBlockingMaterialIssues(materialIssues).length > 0) return true;
  if (
    readinessBlockReasons?.includes("unresolved_backorder") ||
    readinessBlockReasons?.includes("unresolved_damage")
  ) {
    return true;
  }
  if (
    vendorClaimsDelivered(delivery) &&
    sumEffectiveItemQtyReceived(delivery, items) < sumItemQtyOrdered(items)
  ) {
    return true;
  }
  return exceptionRows.some(
    (row) => row.status === "Backordered" || row.status === "Partial Delivery",
  );
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

  const itemsReceivedCount = sumEffectiveItemQtyReceived(delivery, items);
  const exceptionRows = filterExceptionItemIssueRows(
    issueRows,
    itemsReceivedCount,
    delivery,
  );

  if (exceptionRows.length === 0) {
    for (const reason of display.readiness.evidence.readinessBlockReasons) {
      if (
        !shouldIncludeReadinessBlockReasonForBanner(
          reason,
          itemsReceivedCount,
          delivery,
        )
      ) {
        continue;
      }
      const text = DISPATCHER_WHY_BY_BLOCK_REASON[reason];
      if (text) push(`reason-${reason}`, text);
    }
  }

  for (const row of exceptionRows) {
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
  const exceptionRows = filterExceptionItemIssueRows(
    panel.issueRows,
    panel.itemsReceivedCount,
    delivery,
  );
  const readinessBlockReasons =
    display.readiness.evidence.readinessBlockReasons;

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

  const calmWaiting =
    !display.readiness.readyForPickup &&
    panel.itemsReceivedCount === 0 &&
    display.statusDisplayLabel === "Pending Delivery" &&
    exceptionRows.length === 0 &&
    openBlockingMaterialIssues(materialIssues).length === 0 &&
    !options?.emailReviewRequired &&
    !vendorClaimsDelivered(delivery);

  const deliverToSitePending =
    delivery.invoiceDeliverToSite === true &&
    delivery.invoiceDeliverToSiteConfirmed !== true;

  if (deliverToSitePending) {
    const label = delivery.invoiceDeliverToLabel?.trim();
    pushWhy(
      label
        ? `Vendor shipped to job site (${label}) — confirm when material is on site`
        : "Deliver-to-site order — confirm when material reaches the job site",
    );
    pushNext(
      label
        ? `Mark delivered to site in Issue Summary when ${label} has the material`
        : "Mark delivered to site in Issue Summary when the job site has the material",
    );
  }

  if (options?.emailReviewRequired) {
    pushWhy("Vendor email proposal needs dispatcher review");
    pushNext("Click Review Vendor Email to open matched email evidence below");
  }

  if (!calmWaiting) {
    for (const reason of readinessBlockReasons) {
      if (
        !shouldIncludeReadinessBlockReasonForBanner(
          reason,
          panel.itemsReceivedCount,
          delivery,
        )
      ) {
        continue;
      }
      const why = DISPATCHER_WHY_BY_BLOCK_REASON[reason];
      const next = DISPATCHER_NEXT_BY_BLOCK_REASON[reason];
      if (why) pushWhy(why);
      if (next) pushNext(next);
    }

    if (
      vendorClaimsDelivered(delivery) &&
      panel.itemsReceivedCount < panel.itemsTotalCount
    ) {
      pushWhy(
        "Vendor reported delivery but shop receipt does not match — verify material on site",
      );
      pushNext("Confirm physical receipt or follow up with vendor");
    }

    for (const issue of openBlockingMaterialIssues(materialIssues)) {
      const typeLabel = MATERIAL_ISSUE_TYPE_LABEL[issue.type];
      const desc = issue.description?.trim();
      pushWhy(
        desc
          ? `Blocking ${typeLabel.toLowerCase()}: ${desc}`
          : `Blocking ${typeLabel.toLowerCase()} must be resolved`,
      );
      if (
        !seenNext.has("Resolve blocking material issues using Resolve Issue below")
      ) {
        pushNext("Resolve blocking material issues using Resolve Issue below");
      }
    }

    for (const row of exceptionRows) {
      pushWhy(explainItemIssueRow(row));
      if (row.status === "Backordered" || row.status === "Partial Delivery") {
        pushNext("Confirm backorder ETA or follow up on outstanding items with vendor");
      }
    }

    if (
      !delivery.stagingLocationId?.trim() &&
      items.some((item) => item.qtyReceived > 0) &&
      !isInvoiceShellNoShopStaging(delivery)
    ) {
      pushWhy("Received items do not have a staging location assigned");
      pushNext("Assign a staging location for received items");
    }
  }

  const attentionRequired =
    !display.readiness.readyForPickup &&
    !calmWaiting &&
    (whyBullets.length > 0 ||
      openBlockingMaterialIssues(materialIssues).length > 0 ||
      options?.emailReviewRequired === true) ||
    (deliverToSitePending && display.readiness.readyForPickup);

  const openBlockingIssueCount = display.openBlockingIssueCount;
  let resolveDisabledReason: string;
  if (openBlockingIssueCount > 0) {
    resolveDisabledReason =
      "Opens resolve flow for the first blocking material issue";
  } else if (attentionRequired && panel.openIssuesCount > 0) {
    resolveDisabledReason =
      "No blocking material issue — review item exceptions below or contact vendor";
  } else if (options?.emailReviewRequired) {
    resolveDisabledReason =
      "No material issue to resolve — use Review Vendor Email above";
  } else if (calmWaiting) {
    resolveDisabledReason =
      "No dispatcher action required while waiting on vendor delivery";
  } else {
    resolveDisabledReason = "No open blocking material issue to resolve";
  }

  const vendorPhone = options?.vendorPhone?.trim() ?? "";
  const vendorEmail = options?.vendorEmail?.trim() ?? "";
  const needsVendorOutreach = deliveryNeedsVendorOutreach(
    delivery,
    items,
    materialIssues,
    exceptionRows,
    options,
    readinessBlockReasons,
  );

  let bannerMode: DrawerBannerMode;
  let attentionHeadline: string;
  const deliverToSiteConfirmed =
    delivery.invoiceDeliverToSite === true &&
    delivery.invoiceDeliverToSiteConfirmed === true;

  if (
    display.readiness.readyForPickup &&
    !options?.emailReviewRequired &&
    !deliverToSitePending
  ) {
    bannerMode = "all_clear";
    attentionHeadline = deliverToSiteConfirmed
      ? "Delivered to site — vendor order complete, material confirmed on job site."
      : "Ready for Pickup — vendor order complete, physical complete, no blocking issues.";
  } else if (calmWaiting) {
    bannerMode = "calm_waiting";
    attentionHeadline =
      "No material received yet. No dispatcher action required unless overdue or vendor says delivered.";
  } else {
    bannerMode = "attention_required";
    attentionHeadline =
      whyBullets[0] ??
      (display.readiness.readyForPickup
        ? "Review required before pickup"
        : "Order not ready for pickup — review exceptions below");
  }

  return {
    bannerMode,
    attentionHeadline,
    whyBullets: calmWaiting ? [] : whyBullets,
    nextStepBullets: calmWaiting ? [] : nextStepBullets,
    resolveDisabledReason,
    showReviewIssues:
      openBlockingMaterialIssues(materialIssues).length > 0 ||
      (attentionRequired && panel.openIssuesCount > 0),
    showReviewVendorEmail: options?.emailReviewRequired === true,
    showCallVendor:
      attentionRequired && needsVendorOutreach && vendorPhone.length > 0,
    showEmailVendor:
      attentionRequired && needsVendorOutreach && vendorEmail.length > 0,
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
  delivery?: Pick<
    DeliveryOrder,
    "invoiceDeliverToSite" | "invoiceDeliverToSiteConfirmed"
  >,
): ItemIssueDisplayStatus | null {
  const qtyReceived = delivery
    ? effectiveItemQtyReceived(delivery, item)
    : item.qtyReceived;
  const outstanding = item.qtyOrdered - qtyReceived;
  if (item.qtyBackordered > 0) {
    return "Backordered";
  }
  if (outstanding <= 0 && qtyReceived > 0) {
    return null;
  }
  if (qtyReceived === 0) {
    return "Not Delivered";
  }
  if (qtyReceived > 0 && qtyReceived < item.qtyOrdered) {
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
  const itemsReceivedCount = sumEffectiveItemQtyReceived(delivery, items);

  const issueRows: ItemIssueRow[] = [];
  for (const item of items) {
    const status = deriveItemIssueDisplayStatus(item, delivery);
    if (!status) continue;
    issueRows.push({
      itemId: item.id,
      description: item.description,
      qty: deriveItemIssueQty(item, status),
      status,
    });
  }

  const receivedItems: ReceivedItemRow[] = items
    .filter((item) => effectiveItemQtyReceived(delivery, item) > 0)
    .map((item) => ({
      itemId: item.id,
      description: item.description,
      qty: effectiveItemQtyReceived(delivery, item),
    }));

  const openIssuesCount = countExceptionOpenIssues(
    delivery,
    items,
    materialIssues,
    issueRows,
  );
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
  "Vendor email needs review": "Click Review Vendor Email to open matched email evidence",
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

const ACTIVITY_ACTOR_LABEL: Record<string, string> = {
  dispatcher: "Dispatcher",
  vendor: "Vendor",
  system: "System",
  technician: "Technician",
};

const DELIVERY_ACTIVITY_HEADLINE: Partial<Record<DeliveryStatus, string>> = {
  pending: "Order placed — awaiting delivery",
  shipped: "Shipment marked in transit",
  arrived: "Delivery received at shop",
  partial: "Partial delivery recorded",
  ready_for_pickup: "Items staged for pickup",
  complete: "Delivery marked complete",
  issue: "Delivery flagged with an issue",
  picked_up: "Pickup completed",
  installed: "Delivery marked installed",
};

export function formatActivityHistoryHeadline(event: StatusHistoryEvent): string {
  const to = event.toStatus.toLowerCase();
  if (event.entityType === "delivery_order") {
    if (to === "pending" || to === "ordered" || to.includes("pending")) {
      return "Order placed — awaiting delivery";
    }
    const deliveryStatus = to as DeliveryStatus;
    const mapped = DELIVERY_ACTIVITY_HEADLINE[deliveryStatus];
    if (mapped) return mapped;
    const label = DELIVERY_STATUS_LABEL[deliveryStatus];
    if (label) return `Delivery marked as ${label}`;
    const human = to.replace(/_/g, " ");
    return `Delivery updated — ${human}`;
  }
  if (event.entityType === "item") {
    if (to === "backordered") {
      return event.reason
        ? `Item backordered — ${event.reason}`
        : "Item marked backordered";
    }
    if (to === "received") return "Item received at shop";
    if (to === "damaged") return "Item damage reported";
    if (to === "pending") return "Item awaiting delivery";
    return `Item updated — ${to.replace(/_/g, " ")}`;
  }
  return "Activity recorded";
}

export function formatActivityHistoryMeta(event: StatusHistoryEvent): string {
  const actor = ACTIVITY_ACTOR_LABEL[event.actorType] ?? event.actorType;
  const name = event.actorName ? ` · ${event.actorName}` : "";
  return `${actor}${name} · ${new Date(event.createdAt).toLocaleString()}`;
}

function activityHistoryCollapseKey(event: StatusHistoryEvent): string {
  if (event.entityType === "item") {
    return `${event.entityType}:${event.entityId}:${event.toStatus.toLowerCase()}`;
  }
  return `${event.entityType}:${event.toStatus.toLowerCase()}`;
}

/** Compact view: newest first, keep one entry per entity/status (drops repeated arrived/partial noise). */
export function filterCompactActivityHistory(
  events: StatusHistoryEvent[],
): StatusHistoryEvent[] {
  const sorted = [...events].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const seen = new Set<string>();
  const deduped: StatusHistoryEvent[] = [];
  for (const event of sorted) {
    const key = activityHistoryCollapseKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(event);
  }
  return deduped;
}

/** Full view: all events newest first (no collapse). */
export function sortActivityHistoryNewestFirst(
  events: StatusHistoryEvent[],
): StatusHistoryEvent[] {
  return [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function selectTopActivityHistoryEvents(
  events: StatusHistoryEvent[],
  max = 3,
): StatusHistoryEvent[] {
  return filterCompactActivityHistory(events).slice(0, max);
}

/** Hide pickup summary when nothing received (avoids stale/demo noise at 0 qty). */
export function shouldShowPickupSummaryPanel(
  items: Item[],
  _pickupEvents: PickupEvent[],
): boolean {
  return sumItemQtyReceived(items) > 0;
}

type CopyPickupDetails = Pick<
  DeliveryDetails,
  "delivery" | "job" | "vendor" | "purchaseOrder"
>;

/** True when dispatcher can copy a meaningful pickup/order summary (no received qty required). */
export function deliveryHasCopyPickupIdentifyingInfo(
  details: CopyPickupDetails,
): boolean {
  const job = details.job;
  const hasJobIdentifier = Boolean(
    job?.jobNumber?.trim() || job?.jobName?.trim(),
  );
  const vendorName =
    details.vendor?.name?.trim() || details.delivery.vendorName?.trim() || "";
  const hasVendor = vendorName.length > 0;
  const delivery = details.delivery;
  const hasOrderIdentifier = Boolean(
    details.purchaseOrder?.poNumber?.trim() ||
      delivery.orderNumber?.trim() ||
      delivery.id?.trim(),
  );
  return hasJobIdentifier && hasVendor && hasOrderIdentifier;
}

export interface PickupClipboardJobContext {
  jobDeliveries: DeliveryOrder[];
  jobPurchaseOrders: PurchaseOrder[];
  stagingLocations: StagingLocation[];
}

/** Job-level pickup handoff — checklist link is source of truth for item/status detail. */
export function buildPickupInformationClipboardText(
  details: DeliveryDetails,
  pickupLink: string,
  jobContext?: PickupClipboardJobContext,
): string {
  const { delivery, job } = details;
  const deliveries = jobContext?.jobDeliveries ?? [delivery];
  const purchaseOrders = jobContext?.jobPurchaseOrders ?? [];
  const stagingLocations = jobContext?.stagingLocations ?? [];
  const locById = new Map(stagingLocations.map((loc) => [loc.id, loc]));

  const poNumbers = new Set<string>();
  const orderNumbers = new Set<string>();
  const stagingCodes = new Set<string>();

  for (const jobDelivery of deliveries) {
    const linkedPo = jobDelivery.purchaseOrderId
      ? purchaseOrders.find((po) => po.id === jobDelivery.purchaseOrderId)
      : undefined;
    const poNumber = resolveDeliveryPoNumber(
      jobDelivery.customerPoOrReference,
      linkedPo?.poNumber,
    );
    if (poNumber) poNumbers.add(poNumber);

    const orderNumber = jobDelivery.orderNumber?.trim();
    if (orderNumber) orderNumbers.add(orderNumber);

    for (const locId of getAllStagingLocationIds(jobDelivery)) {
      const code = locById.get(locId)?.code?.trim();
      if (code) stagingCodes.add(code);
    }
  }

  const lines: string[] = ["StageVerify Pickup"];

  const jobName = job?.jobName?.trim();
  if (jobName) lines.push(`Job Name: ${jobName}`);

  const jobNumber = job?.jobNumber?.trim();
  if (jobNumber) lines.push(`Job #: ${jobNumber}`);

  const aggregatedPos = [...poNumbers].sort().join(", ");
  if (aggregatedPos) lines.push(`PO #: ${aggregatedPos}`);

  const aggregatedOrders = [...orderNumbers].sort().join(", ");
  if (aggregatedOrders) lines.push(`Order #: ${aggregatedOrders}`);

  const aggregatedStaging = [...stagingCodes].sort().join(", ");
  lines.push(
    `Staging Location(s): ${aggregatedStaging || "Not assigned"}`,
  );

  lines.push("");
  lines.push("Open pickup checklist:");
  lines.push(pickupLink);

  return lines.join("\n");
}

/** Delivery Overview filter chip — workflow status (no installed) + deliver-to-site bucket. */
export type DeliveryOverviewFilterStatus =
  | Exclude<DeliveryStatus, "installed">
  | "delivered";

export function isDeliveredToSiteListRow(
  row: Pick<{ statusDisplayLabel: string }, "statusDisplayLabel">,
): boolean {
  return row.statusDisplayLabel === "Delivered";
}

/** Picked up (and legacy installed) — terminal readiness; not a separate SV install tracker. */
export function isPickedUpOverviewRow(
  row: Pick<{ status: DeliveryStatus }, "status">,
): boolean {
  return row.status === "picked_up" || row.status === "installed";
}

/** Complete tile/filter — includes delivered-to-site and picked-up terminal rows. */
export function isCompleteOverviewRow(
  row: Pick<
    { status: DeliveryStatus; statusDisplayLabel: string },
    "status" | "statusDisplayLabel"
  >,
): boolean {
  return row.status === "complete" || isPickedUpOverviewRow(row);
}

/** Filter matching for dispatcher Delivery Overview tiles/chips. */
export function rowMatchesOverviewStatusFilter(
  row: Pick<{ status: DeliveryStatus; statusDisplayLabel: string }, "status" | "statusDisplayLabel">,
  filter: DeliveryOverviewFilterStatus,
): boolean {
  if (filter === "delivered") return isDeliveredToSiteListRow(row);
  if (filter === "complete") return isCompleteOverviewRow(row);
  if (filter === "picked_up") return isPickedUpOverviewRow(row);
  return row.status === filter;
}

const {
  installed: _installedOverviewLabel,
  ...deliveryOverviewStatusLabels
} = DELIVERY_STATUS_LABEL;

export const DELIVERY_OVERVIEW_FILTER_LABEL: Record<
  DeliveryOverviewFilterStatus,
  string
> = {
  ...deliveryOverviewStatusLabels,
  delivered: "Delivered",
};

export const DELIVERY_OVERVIEW_STATUS_ORDER: DeliveryOverviewFilterStatus[] = [
  "pending",
  "shipped",
  "arrived",
  "partial",
  "ready_for_pickup",
  "complete",
  "delivered",
  "issue",
  "picked_up",
];

/** Increment summary tile counts for one list row (picked_up ⊆ complete; no installed tile). */
export function incrementOverviewStatusCounts(
  counts: Record<DeliveryOverviewFilterStatus, number>,
  row: Pick<
    { status: DeliveryStatus; statusDisplayLabel: string },
    "status" | "statusDisplayLabel"
  >,
): void {
  const primary =
    row.status === "installed" ? ("picked_up" as const) : row.status;
  if (primary in counts) {
    counts[primary as DeliveryOverviewFilterStatus] =
      (counts[primary as DeliveryOverviewFilterStatus] ?? 0) + 1;
  }
  if (isDeliveredToSiteListRow(row)) {
    counts.delivered = (counts.delivered ?? 0) + 1;
  }
  if (isPickedUpOverviewRow(row)) {
    counts.complete = (counts.complete ?? 0) + 1;
  }
}
