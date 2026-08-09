/**
 * Vendor unplanned-delivery match classification — pure logic + thin adapter
 * over matchInvoiceToRecords (vendor-scoped context only).
 */
import { createHash } from "crypto";
import {
  INVOICE_AUTO_APPLY_CONFIDENCE,
  matchInvoiceToRecords,
  type InvoiceDeliveryCandidate,
} from "./invoice/matchInvoiceToRecords";
import type { ParsedInvoiceHeader } from "./invoice/types";
import type { MatchContext } from "./email/matchEmailToRecords";

export type UnplannedMatchOutcome = "strong_match" | "ambiguous" | "no_match";

export interface UnplannedMatchCandidate {
  deliveryId: string;
  orderNumber: string;
  jobId: string;
  jobName?: string;
  poNumber?: string;
  vendorInvoiceNumber?: string;
  confidenceScore: number;
}

export interface UnplannedMatchClassification {
  outcome: UnplannedMatchOutcome;
  candidate?: UnplannedMatchCandidate;
  candidateSummaries: UnplannedMatchCandidate[];
}

export function normalizeUnplannedReference(reference: string): string {
  return reference.trim().toUpperCase();
}

export function asUnplannedReference(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) return null;
  return trimmed;
}

/** Filter match context to a single vendor — hard invariant. */
export function filterMatchContextToVendor(
  ctx: MatchContext,
  vendorId: string,
): MatchContext {
  return {
    vendors: ctx.vendors.filter((v) => v.id === vendorId),
    jobs: ctx.jobs,
    purchaseOrders: ctx.purchaseOrders.filter((po) => po.vendorId === vendorId),
    deliveries: ctx.deliveries.filter((d) => d.vendorId === vendorId),
  };
}

/**
 * Exact-field boosts for vendorInvoiceNumber / orderNumber on vendor deliveries.
 * Used alongside matchInvoiceToRecords — never cross-vendor.
 */
export function scoreExactVendorFieldMatches(
  reference: string,
  vendorDeliveries: Array<{
    id: string;
    orderNumber?: string;
    vendorInvoiceNumber?: string;
    jobId?: string;
    purchaseOrderId?: string;
  }>,
  jobNameById: Map<string, string>,
  poNumberById: Map<string, string>,
): UnplannedMatchCandidate[] {
  const key = normalizeUnplannedReference(reference);
  if (!key) return [];

  const out: UnplannedMatchCandidate[] = [];
  for (const d of vendorDeliveries) {
    const order = String(d.orderNumber ?? "").trim().toUpperCase();
    const invoice = String(d.vendorInvoiceNumber ?? "").trim().toUpperCase();
    let score = 0;
    if (invoice && invoice === key) score = Math.max(score, 90);
    if (order && order === key) score = Math.max(score, 90);
    if (score === 0) continue;
    const jobId = String(d.jobId ?? "");
    out.push({
      deliveryId: d.id,
      orderNumber: String(d.orderNumber ?? d.id),
      jobId,
      jobName: jobNameById.get(jobId),
      poNumber: d.purchaseOrderId
        ? poNumberById.get(d.purchaseOrderId)
        : undefined,
      vendorInvoiceNumber: d.vendorInvoiceNumber,
      confidenceScore: score,
    });
  }
  return out.sort((a, b) => b.confidenceScore - a.confidenceScore);
}

function toCandidateSummary(
  c: InvoiceDeliveryCandidate,
  jobNameById: Map<string, string>,
  poNumberById: Map<string, string>,
  invoiceByDeliveryId: Map<string, string>,
): UnplannedMatchCandidate {
  return {
    deliveryId: c.deliveryId,
    orderNumber: c.orderNumber,
    jobId: c.jobId,
    jobName: jobNameById.get(c.jobId),
    poNumber: c.purchaseOrderId
      ? poNumberById.get(c.purchaseOrderId)
      : undefined,
    vendorInvoiceNumber: invoiceByDeliveryId.get(c.deliveryId),
    confidenceScore: c.confidenceScore,
  };
}

/**
 * Classify unplanned reference against vendor-scoped records.
 * Strong match requires a single candidate at ≥ INVOICE_AUTO_APPLY_CONFIDENCE (85).
 * Never auto-links — caller must confirm.
 */
export function classifyUnplannedVendorMatch(input: {
  reference: string;
  vendorScopedCtx: MatchContext;
  vendorDeliveries: Array<{
    id: string;
    orderNumber?: string;
    vendorInvoiceNumber?: string;
    jobId?: string;
    purchaseOrderId?: string;
  }>;
  jobNameById: Map<string, string>;
  poNumberById: Map<string, string>;
}): UnplannedMatchClassification {
  const exact = scoreExactVendorFieldMatches(
    input.reference,
    input.vendorDeliveries,
    input.jobNameById,
    input.poNumberById,
  );

  // Do not set both vendorOrderNumber and vendorInvoiceNumber to the same
  // string — matchInvoiceToRecords would double-count the same key.
  const header: ParsedInvoiceHeader = {
    customerAccountNumber: "",
    vendorOrderNumber: input.reference.trim(),
    vendorInvoiceNumber: "",
    customerPoOrReference: input.reference.trim(),
    orderDate: "",
    invoiceDate: "",
    shipDate: "",
    jobNumberRaw: "",
    vendorBranchName: "",
    vendorBranchAddress: "",
    vendorBranchPhone: "",
    soldToName: "",
    shipToName: "",
    shipToAddress: "",
    fulfillmentMethod: "unknown",
    shipCompletePolicy: "unknown",
  };

  const match = matchInvoiceToRecords(
    `unplanned-${normalizeUnplannedReference(input.reference)}`,
    header,
    input.vendorScopedCtx,
  );

  const invoiceByDeliveryId = new Map(
    input.vendorDeliveries.map((d) => [
      d.id,
      typeof d.vendorInvoiceNumber === "string" ? d.vendorInvoiceNumber : "",
    ]),
  );

  const fromMatcher = match.candidates.map((c) =>
    toCandidateSummary(
      c,
      input.jobNameById,
      input.poNumberById,
      invoiceByDeliveryId,
    ),
  );

  // Merge exact + matcher by deliveryId, keep max score.
  const merged = new Map<string, UnplannedMatchCandidate>();
  for (const c of [...exact, ...fromMatcher]) {
    const prev = merged.get(c.deliveryId);
    if (!prev || c.confidenceScore > prev.confidenceScore) {
      merged.set(c.deliveryId, c);
    }
  }

  const candidates = [...merged.values()].sort(
    (a, b) => b.confidenceScore - a.confidenceScore,
  );

  if (
    candidates.length === 1 &&
    candidates[0].confidenceScore >= INVOICE_AUTO_APPLY_CONFIDENCE
  ) {
    return {
      outcome: "strong_match",
      candidate: candidates[0],
      candidateSummaries: [candidates[0]],
    };
  }

  if (candidates.length === 0) {
    return { outcome: "no_match", candidateSummaries: [] };
  }

  return {
    outcome: "ambiguous",
    candidateSummaries: candidates.slice(0, 3),
  };
}

export function unplannedDeliveryDocId(
  vendorId: string,
  reference: string,
): string {
  const norm = normalizeUnplannedReference(reference);
  const hash = createHash("sha256")
    .update(`${vendorId}:${norm}`)
    .digest("hex")
    .slice(0, 20);
  return `unplanned-${hash}`;
}
