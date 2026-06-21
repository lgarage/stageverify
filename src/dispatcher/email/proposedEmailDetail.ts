import type { EmailClassification, EmailProcessingResult, ParsedEmailContent } from "./types";
import type { EmailMatchCandidate } from "./types";
import type { MatchContext } from "./matchEmailToRecords";
import { shouldAutoApplyVendorOrderComplete } from "./matchEmailToRecords";

const CLASSIFICATION_MEANING: Partial<Record<EmailClassification, string>> = {
  ordered: "Vendor confirms a new order was placed.",
  order_acknowledged: "Vendor acknowledges receipt of the purchase order.",
  backordered: "One or more line items are on backorder.",
  partially_backordered: "Some items are backordered; others may ship normally.",
  partially_shipped: "Vendor shipped part of the order; remaining items expected.",
  shipped: "Vendor reports material has shipped.",
  split_shipment: "Order will arrive in multiple shipments.",
  delayed: "Delivery is delayed beyond the original schedule.",
  estimated_delivery_changed: "Estimated delivery date changed.",
  partially_delivered: "Part of the order was physically delivered.",
  delivered: "Vendor reports physical delivery occurred.",
  remaining_items_delivered: "Remaining balance of the order was delivered.",
  vendor_order_complete: "Vendor claims the full order is complete with no remaining items.",
  canceled_item: "A line item was canceled.",
  substituted_item: "A substitute item was provided.",
  quantity_changed: "Ordered quantity was adjusted.",
  correction_to_earlier_email: "Corrects an earlier email — prior evidence kept; current info updated on approval.",
  needs_dispatcher_review: "Content is suspicious or unclear — requires manual review.",
  unable_to_match: "Could not confidently match to a job, PO, or delivery.",
  irrelevant: "Not vendor order evidence — no Condition 1 impact.",
};

export function bodyExcerpt(bodyText: string, maxLen = 220): string {
  const trimmed = bodyText.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1)}…`;
}

export function describeOperationalMeaning(
  classification: EmailClassification,
  parsed: ParsedEmailContent,
): string {
  const base = CLASSIFICATION_MEANING[classification] ?? "Vendor email classified for review.";
  if (parsed.vendorOrderCompleteClaim) {
    return `${base} Parser detected a vendor order-complete claim.`;
  }
  return base;
}

export function describeCondition1Impact(
  result: Pick<EmailProcessingResult, "reviewStatus" | "parsed" | "match">,
): { affectsCondition1: boolean; note: string } {
  const { parsed, match, reviewStatus } = result;

  if (
    parsed.classification === "irrelevant" ||
    parsed.classification === "unable_to_match" ||
    reviewStatus === "rejected"
  ) {
    return {
      affectsCondition1: false,
      note: "Would not update Condition 1 (vendor order completeness) — no actionable match or rejected as duplicate/irrelevant.",
    };
  }

  const wouldAutoApply = shouldAutoApplyVendorOrderComplete(parsed, match);
  const target =
    match.purchaseOrderId || match.deliveryOrderId
      ? "matched PO/delivery"
      : "unmatched records";

  if (wouldAutoApply && reviewStatus === "auto_processed") {
    return {
      affectsCondition1: true,
      note: `High-confidence vendor order complete on ${target} — Condition 1 only via server auto-apply; does not set Ready for Pickup or physical evidence.`,
    };
  }

  return {
    affectsCondition1: true,
    note: `Would record ${parsed.classification.replace(/_/g, " ")} evidence on ${target} — Condition 1 only; no readiness change until dispatcher approves (Phase 5 read-only preview).`,
  };
}

export function resolveMatchLabels(
  match: EmailMatchCandidate,
  parsed: ParsedEmailContent,
  ctx: MatchContext,
): {
  jobNumber: string | null;
  poLabel: string | null;
  orderLabel: string | null;
  deliveryLabel: string | null;
} {
  const job = match.jobId ? ctx.jobs.find((j) => j.id === match.jobId) : undefined;
  const po = match.purchaseOrderId
    ? ctx.purchaseOrders.find((p) => p.id === match.purchaseOrderId)
    : undefined;
  const delivery = match.deliveryOrderId
    ? ctx.deliveries.find((d) => d.id === match.deliveryOrderId)
    : undefined;

  return {
    jobNumber: job?.jobNumber ?? parsed.jobNumbers[0] ?? null,
    poLabel: po?.poNumber ?? parsed.poNumbers[0] ?? null,
    orderLabel: delivery?.orderNumber ?? parsed.orderNumbers[0] ?? null,
    deliveryLabel: delivery
      ? `${delivery.orderNumber}${po ? ` (${po.poNumber})` : ""}`
      : null,
  };
}
