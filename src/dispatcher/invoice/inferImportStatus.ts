import type {
  InvoiceFulfillmentMethod,
  ParsedJohnstoneInvoice,
  VendorInvoiceImportStatus,
} from "./types";

/** Fulfillment method from explicit header/shipping language only — never from backorder lines. */
export function inferFulfillmentMethod(
  customerPoOrReference: string,
  shipViaRaw?: string,
  pageText?: string,
): InvoiceFulfillmentMethod {
  const shipVia = (shipViaRaw ?? "").trim();
  const text = pageText ?? "";

  if (/\bPICKUP\b/i.test(customerPoOrReference)) return "will_call_pickup";
  if (/\bWILL\s*[- ]?\s*CALL\b/i.test(customerPoOrReference)) return "will_call_pickup";
  if (/\bWILL\s*CALL\b/i.test(text)) return "will_call_pickup";
  if (/\bCUSTOMER\s+PICKUP\b/i.test(text)) return "will_call_pickup";

  if (shipVia && /TRUCK\s+DELIVE/i.test(shipVia)) return "delivery";
  if (/DELIVERY\s+ROUTE/i.test(text)) return "delivery";
  if (/DELIVERED\s+BY\s+JOHNSTONE/i.test(text)) return "delivery";
  if (/SHIP\s+COMPLETE/i.test(text)) return "delivery";
  if (/DELIVERY\s+HOLD/i.test(text)) return "delivery";

  return "unknown";
}

export interface InvoiceFulfillmentCompleteness {
  allFulfilled: boolean;
  hasBackorder: boolean;
  hasPartialShip: boolean;
  noFulfilledMaterial: boolean;
}

/** Line-level completeness — backorders affect status/review, not fulfillment method. */
export function assessFulfillmentCompleteness(
  parsed: ParsedJohnstoneInvoice,
): InvoiceFulfillmentCompleteness {
  const expectedLines = parsed.lines.filter((l) => !l.excludeFromExpectedItems);
  if (expectedLines.length === 0) {
    return {
      allFulfilled: false,
      hasBackorder: false,
      hasPartialShip: false,
      noFulfilledMaterial: true,
    };
  }

  const hasBackorder = expectedLines.some((l) => l.quantityBackordered > 0);
  const hasPartialShip = expectedLines.some(
    (l) => l.quantityShipped < l.quantityOrdered && l.quantityBackordered === 0,
  );
  const noFulfilledMaterial = expectedLines.every((l) => l.quantityShipped === 0);
  const allFulfilled = expectedLines.every(
    (l) => l.quantityShipped >= l.quantityOrdered && l.quantityBackordered === 0,
  );

  return { allFulfilled, hasBackorder, hasPartialShip, noFulfilledMaterial };
}

/** Derive import-domain status from parsed invoice — never sets shop readiness (spec §7). */
export function deriveImportStatus(parsed: ParsedJohnstoneInvoice): VendorInvoiceImportStatus {
  const { header, parseWarnings } = parsed;
  if (parseWarnings.some((w) => w.includes("missing vendorInvoiceNumber"))) {
    return "issue";
  }

  const { allFulfilled, hasBackorder, hasPartialShip, noFulfilledMaterial } =
    assessFulfillmentCompleteness(parsed);

  const incomplete = hasBackorder || hasPartialShip || noFulfilledMaterial;
  if (incomplete) {
    // Backorders / unfulfilled qty affect completeness only — do not assume future pickup or delivery.
    return "partial";
  }

  if (allFulfilled && header.fulfillmentMethod === "will_call_pickup") {
    return "pickup_at_vendor";
  }

  if (header.fulfillmentMethod === "delivery") {
    return "pending";
  }

  return "pending";
}

export function scoreInvoiceConfidence(parsed: ParsedJohnstoneInvoice): {
  tier: "high" | "medium" | "low";
  score: number;
  humanReviewRequired: boolean;
} {
  const required = [
    parsed.header.customerAccountNumber,
    parsed.header.vendorOrderNumber,
    parsed.header.vendorInvoiceNumber,
    parsed.header.customerPoOrReference,
    parsed.header.orderDate,
    parsed.header.invoiceDate,
    parsed.header.vendorBranchPhone,
  ];
  const missingRequired = required.filter((v) => !v).length;
  const productLines = parsed.lines.filter((l) => l.lineType === "product");
  const { hasBackorder, noFulfilledMaterial } = assessFulfillmentCompleteness(parsed);

  let score = 100;
  score -= missingRequired * 15;
  if (productLines.length === 0) score -= 30;
  if (parsed.header.fulfillmentMethod === "unknown") score -= 10;
  if (parsed.parseWarnings.length > 0) score -= parsed.parseWarnings.length * 5;
  score = Math.max(0, Math.min(100, score));

  let tier: "high" | "medium" | "low" = "high";
  if (score < 60) tier = "low";
  else if (score < 85) tier = "medium";

  const humanReviewRequired =
    tier !== "high" ||
    parsed.header.fulfillmentMethod === "unknown" ||
    hasBackorder ||
    noFulfilledMaterial;

  return { tier, score, humanReviewRequired };
}
