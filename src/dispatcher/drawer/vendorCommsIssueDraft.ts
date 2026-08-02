import type { DeliveryDetails } from "../models";
import {
  buildDrawerActionBannerContent,
  computeDeliveryDisplayState,
} from "../deliveryDisplayHelpers";

/** Unicode em dash (U+2014) — Dan locked subject separator. */
const EM_DASH = "\u2014";

const SHORT_EXCEPTION_HEADLINE = /backordered|missing|partially outstanding/i;

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

/** Headline SSOT: drawer banner attention path, then computed issue summary, else generic follow-up. */
export function resolveVendorCommsIssueHeadline(details: DeliveryDetails): string {
  const { delivery, items, materialIssues, vendor } = details;
  const banner = buildDrawerActionBannerContent(delivery, items, materialIssues, {
    vendorPhone: vendor.contactPhone?.trim() ?? "",
    vendorEmail: vendor.email?.trim() ?? "",
  });

  if (
    banner.bannerMode === "attention_required" &&
    SHORT_EXCEPTION_HEADLINE.test(banner.attentionHeadline)
  ) {
    return banner.attentionHeadline;
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

export function buildVendorCommsIssueBody(details: DeliveryDetails): string {
  const { delivery, vendor, items, job } = details;
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

  const backordered = items.filter((item) => item.qtyBackordered > 0);
  const missing = items.filter((item) => item.qtyMissing > 0);

  if (backordered.length > 0 || missing.length > 0) {
    lines.push("");
    for (const item of backordered) {
      lines.push(
        `• ${item.description} (${item.qtyBackordered} backordered)`,
      );
    }
    for (const item of missing) {
      lines.push(`• ${item.description} (${item.qtyMissing} missing)`);
    }
  }

  lines.push("", "Could you share an ETA or updated status?", "", "Thank you,");
  return lines.join("\n");
}

function sentenceCase(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}
