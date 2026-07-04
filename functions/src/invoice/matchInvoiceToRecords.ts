import type { ParsedInvoiceHeader } from "./types";
import type { MatchContext } from "../email/matchEmailToRecords";

export interface InvoiceDeliveryCandidate {
  deliveryId: string;
  orderNumber: string;
  jobId: string;
  vendorId: string;
  purchaseOrderId?: string;
  confidenceScore: number;
  matchReasons: string[];
}

export interface InvoiceMatchResult {
  vendorInvoiceImportId: string;
  purchaseOrderId?: string;
  jobId?: string;
  vendorId?: string;
  deliveryOrderId?: string;
  candidates: InvoiceDeliveryCandidate[];
  confidenceScore: number;
  confidenceReason: string;
  humanReviewRequired: boolean;
}

const INVOICE_AUTO_APPLY_CONFIDENCE = 85;
const INVOICE_REVIEW_CONFIDENCE = 60;

/** Extract PO-##### token from customer reference when present. */
export function extractPoHint(customerPoOrReference: string): string | undefined {
  const match = customerPoOrReference.match(/\b(PO-\d+)\b/i);
  return match ? match[1].toUpperCase() : undefined;
}


function addCandidate(
  map: Map<string, InvoiceDeliveryCandidate>,
  delivery: MatchContext["deliveries"][number],
  scoreDelta: number,
  reason: string,
) {
  const existing = map.get(delivery.id);
  if (existing) {
    existing.confidenceScore += scoreDelta;
    if (!existing.matchReasons.includes(reason)) existing.matchReasons.push(reason);
    return;
  }
  map.set(delivery.id, {
    deliveryId: delivery.id,
    orderNumber: delivery.orderNumber,
    jobId: delivery.jobId,
    vendorId: delivery.vendorId,
    purchaseOrderId: delivery.purchaseOrderId,
    confidenceScore: scoreDelta,
    matchReasons: [reason],
  });
}

/**
 * Match invoice header keys to candidate deliveries — read-only; no writes.
 * Keys: Customer P/O #, Sales Order # / Invoice #, Job Number hint.
 */
export function matchInvoiceToRecords(
  vendorInvoiceImportId: string,
  header: ParsedInvoiceHeader,
  ctx: MatchContext,
  deliveryNotesById?: Map<string, string>,
): InvoiceMatchResult {
  const reasons: string[] = [];
  let purchaseOrderId: string | undefined;
  let jobId: string | undefined;
  let vendorId: string | undefined;
  let deliveryOrderId: string | undefined;
  let score = 0;

  const customerPo = header.customerPoOrReference.trim();
  const salesOrder = header.vendorOrderNumber.trim();
  const invoiceNumber = header.vendorInvoiceNumber.trim();
  const jobHint = header.jobNumberRaw?.trim() ?? "";

  const candidateMap = new Map<string, InvoiceDeliveryCandidate>();

  const poHint = extractPoHint(customerPo);
  if (poHint) {
    const exactPo = ctx.purchaseOrders.filter(
      (po) => po.poNumber.toUpperCase() === poHint.toUpperCase(),
    );
    if (exactPo.length === 1) {
      purchaseOrderId = exactPo[0].id;
      jobId = exactPo[0].jobId;
      vendorId = exactPo[0].vendorId;
      score += 40;
      reasons.push("exact_po_number");
      for (const d of ctx.deliveries.filter((del) => del.purchaseOrderId === exactPo[0].id)) {
        addCandidate(candidateMap, d, 40, "exact_po_number");
      }
    } else if (exactPo.length > 1) {
      score += 10;
      reasons.push("ambiguous_po_multiple_records");
    } else {
      reasons.push("po_hint_not_found");
    }
  } else if (customerPo) {
    const poByReference = ctx.purchaseOrders.filter(
      (po) => po.poNumber.toUpperCase() === customerPo.toUpperCase(),
    );
    if (poByReference.length === 1) {
      purchaseOrderId = poByReference[0].id;
      jobId = poByReference[0].jobId;
      vendorId = poByReference[0].vendorId;
      score += 35;
      reasons.push("exact_customer_po_reference");
      for (const d of ctx.deliveries.filter((del) => del.purchaseOrderId === poByReference[0].id)) {
        addCandidate(candidateMap, d, 35, "exact_customer_po_reference");
      }
    }
  }

  const orderKeys = [salesOrder, invoiceNumber].filter(Boolean);
  for (const key of orderKeys) {
    const orderMatches = ctx.deliveries.filter(
      (d) => d.orderNumber.toUpperCase() === key.toUpperCase(),
    );
    if (orderMatches.length === 1) {
      deliveryOrderId = orderMatches[0].id;
      jobId = jobId ?? orderMatches[0].jobId;
      vendorId = vendorId ?? orderMatches[0].vendorId;
      purchaseOrderId = purchaseOrderId ?? orderMatches[0].purchaseOrderId;
      score += 35;
      reasons.push("exact_order_number");
      addCandidate(candidateMap, orderMatches[0], 35, "exact_order_number");
    } else if (orderMatches.length > 1) {
      score += 5;
      reasons.push("ambiguous_order_number");
    }

    for (const d of ctx.deliveries) {
      const notes = deliveryNotesById?.get(d.id) ?? "";
      const haystack = `${notes} ${d.orderNumber}`.toUpperCase();
      if (key && haystack.includes(key.toUpperCase())) {
        addCandidate(candidateMap, d, 25, "sales_order_in_delivery_context");
        if (!deliveryOrderId && candidateMap.size === 1) {
          deliveryOrderId = d.id;
        }
        score = Math.max(score, 25);
        if (!reasons.includes("sales_order_in_delivery_context")) {
          reasons.push("sales_order_in_delivery_context");
        }
      }
    }
  }

  if (jobHint) {
    const jobMatches = ctx.jobs.filter(
      (j) => j.jobNumber.toUpperCase() === jobHint.toUpperCase(),
    );
    if (jobMatches.length === 1) {
      jobId = jobId ?? jobMatches[0].id;
      score += 15;
      reasons.push("exact_job_number");
      for (const d of ctx.deliveries.filter((del) => del.jobId === jobMatches[0].id)) {
        addCandidate(candidateMap, d, 10, "job_number_delivery");
      }
    } else if (jobMatches.length > 1) {
      reasons.push("ambiguous_job_number");
    }
  }

  if (customerPo && deliveryNotesById) {
    for (const d of ctx.deliveries) {
      const notes = deliveryNotesById.get(d.id) ?? "";
      if (notes.toUpperCase().includes(customerPo.toUpperCase())) {
        addCandidate(candidateMap, d, 20, "customer_po_in_delivery_notes");
        if (!reasons.includes("customer_po_in_delivery_notes")) {
          reasons.push("customer_po_in_delivery_notes");
        }
      }
    }
  }

  const candidates = [...candidateMap.values()]
    .map((c) => ({
      ...c,
      confidenceScore: Math.max(0, Math.min(100, c.confidenceScore)),
    }))
    .sort((a, b) => b.confidenceScore - a.confidenceScore);

  if (candidates.length === 1 && !deliveryOrderId) {
    deliveryOrderId = candidates[0].deliveryId;
  }

  if (candidates.length > 1) {
    score = Math.min(score, INVOICE_REVIEW_CONFIDENCE + 10);
    reasons.push("multiple_delivery_candidates");
  }

  score = Math.max(0, Math.min(100, score || (candidates[0]?.confidenceScore ?? 0)));
  const humanReviewRequired =
    score < INVOICE_AUTO_APPLY_CONFIDENCE || candidates.length !== 1;

  return {
    vendorInvoiceImportId,
    purchaseOrderId,
    jobId,
    vendorId,
    deliveryOrderId,
    candidates,
    confidenceScore: score,
    confidenceReason: reasons.join("; ") || "insufficient_signals",
    humanReviewRequired,
  };
}
