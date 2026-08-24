import type { DeliveryDetails, DeliveryOrder, Item } from "../models";
import {
  buildIssueSummaryPanelData,
  computeDeliveryDisplayState,
  filterExceptionItemIssueRows,
  openBlockingMaterialIssues,
  sumEffectiveItemQtyReceived,
  type ItemIssueRow,
} from "../deliveryDisplayHelpers";
import { skipsShopStaging } from "../invoice/invoiceShellDisplayHelpers";
import { deliveryHasCurrentShopStagingAssignment } from "../readiness";

/** Unicode em dash (U+2014) — Dan locked subject separator. */
const EM_DASH = "\u2014";

const CALM_ISSUE_SUMMARY_PATTERNS = [
  /^Will-Call Pickup$/i,
  /^Pickup Scheduled$/i,
  /^Delivered to/i,
  /^Confirm delivery/i,
  /^Confirm site delivery$/i,
];

function isCalmIssueSummary(summary: string): boolean {
  const trimmed = summary.trim();
  if (!trimmed) return true;
  return CALM_ISSUE_SUMMARY_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function getExceptionRows(
  delivery: DeliveryOrder,
  items: Item[],
  materialIssues: DeliveryDetails["materialIssues"],
): ItemIssueRow[] {
  const panel = buildIssueSummaryPanelData(delivery, items, materialIssues);
  return filterExceptionItemIssueRows(
    panel.issueRows,
    panel.itemsReceivedCount,
    delivery,
  );
}

function buildFulfillmentExceptionHeadline(
  exceptionRows: ItemIssueRow[],
): string | null {
  if (exceptionRows.length === 0) return null;

  const hasBackordered = exceptionRows.some((row) => row.status === "Backordered");
  const hasPartial = exceptionRows.some(
    (row) => row.status === "Partial Delivery",
  );
  const hasNotDelivered = exceptionRows.some(
    (row) => row.status === "Not Delivered",
  );
  const categoryCount = [hasBackordered, hasPartial, hasNotDelivered].filter(
    Boolean,
  ).length;

  if (categoryCount >= 2) {
    return "Items still need attention";
  }
  if (hasPartial) {
    return "Partial delivery";
  }
  if (hasNotDelivered) {
    return "Items not delivered";
  }
  if (hasBackordered) {
    const backorderCount = exceptionRows.filter(
      (row) => row.status === "Backordered",
    ).length;
    return backorderCount === 1
      ? "1 item backordered"
      : `${backorderCount} items backordered`;
  }
  return null;
}

function isTrueStagingMissing(
  delivery: DeliveryOrder,
  items: Item[],
  materialIssues: DeliveryDetails["materialIssues"],
  exceptionRows: ItemIssueRow[],
): boolean {
  if (deliveryHasCurrentShopStagingAssignment(delivery)) return false;
  if (skipsShopStaging(delivery)) return false;
  if (openBlockingMaterialIssues(materialIssues).length > 0) return false;
  if (exceptionRows.length > 0) return false;
  if (sumEffectiveItemQtyReceived(delivery, items) <= 0) return false;
  return true;
}

/**
 * Vendor-email reason priority (structured state — not WNA banner headline matching).
 */
export function resolveVendorCommsIssueHeadline(details: DeliveryDetails): string {
  const { delivery, items, materialIssues } = details;
  const exceptionRows = getExceptionRows(delivery, items, materialIssues);

  if (openBlockingMaterialIssues(materialIssues).length > 0) {
    const display = computeDeliveryDisplayState(delivery, items, materialIssues);
    const issueSummary = display.issueSummary?.trim() ?? "";
    if (issueSummary && !isCalmIssueSummary(issueSummary)) {
      return issueSummary;
    }
  }

  const fulfillmentHeadline = buildFulfillmentExceptionHeadline(exceptionRows);
  if (fulfillmentHeadline) {
    return fulfillmentHeadline;
  }

  if (isTrueStagingMissing(delivery, items, materialIssues, exceptionRows)) {
    return "Staging location missing";
  }

  const display = computeDeliveryDisplayState(delivery, items, materialIssues);
  const issueSummary = display.issueSummary?.trim() ?? "";
  if (issueSummary && !isCalmIssueSummary(issueSummary)) {
    return issueSummary;
  }

  return "delivery follow up";
}

export function buildVendorCommsIssueSubject(details: DeliveryDetails): string {
  const headline = resolveVendorCommsIssueHeadline(details);
  const orderNumber = details.delivery.orderNumber?.trim();
  const orderLabel =
    orderNumber ||
    (details.delivery.id?.trim()
      ? details.delivery.id.slice(0, 12)
      : "Delivery");
  return `${orderLabel} ${EM_DASH} ${headline}`;
}

function buildOutstandingMaterialBullets(
  delivery: DeliveryOrder,
  items: Item[],
  materialIssues: DeliveryDetails["materialIssues"],
): string[] {
  const exceptionRows = getExceptionRows(delivery, items, materialIssues);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const bullets: string[] = [];

  for (const row of exceptionRows) {
    const item = itemById.get(row.itemId);
    if (!item) continue;
    if (
      item.qtyOrdered <= 0 &&
      item.qtyBackordered <= 0 &&
      item.qtyMissing <= 0
    ) {
      continue;
    }

    if (row.status === "Backordered") {
      bullets.push(`• ${row.description} (${row.qty} backordered)`);
    } else if (row.status === "Partial Delivery") {
      bullets.push(`• ${row.description} (${row.qty} still outstanding)`);
    } else if (row.status === "Not Delivered") {
      bullets.push(
        `• ${row.description} (${row.qty} not delivered)`,
      );
    }
  }

  return bullets;
}

export function buildVendorCommsIssueBody(details: DeliveryDetails): string {
  const { delivery, vendor, items, job, materialIssues } = details;
  const contactName =
    vendor.contactName?.trim() || vendor.name?.trim() || "there";
  const orderNumber = delivery.orderNumber?.trim() || "this order";
  const headline = resolveVendorCommsIssueHeadline(details);

  const jobSuffix = job?.jobName?.trim()
    ? ` for ${job.jobName.trim()}`
    : job?.jobNumber?.trim()
      ? ` (job ${job.jobNumber.trim()})`
      : "";

  const lines: string[] = [
    `Hi ${contactName},`,
    "",
    `I'm following up on order ${orderNumber}${jobSuffix}. ${sentenceCase(headline)}.`,
  ];

  const materialBullets = buildOutstandingMaterialBullets(
    delivery,
    items,
    materialIssues,
  );
  if (materialBullets.length > 0) {
    lines.push("");
    lines.push(...materialBullets);
  }

  lines.push("", "Could you share an ETA or updated status?", "", "Thank you,");
  return lines.join("\n");
}

function sentenceCase(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}
