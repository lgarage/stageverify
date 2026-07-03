import type {
  InvoiceFulfillmentMethod,
  ParsedJohnstoneInvoice,
  VendorInvoiceImportStatus,
} from "./types";

export function inferFulfillmentMethod(
  customerPoOrReference: string,
  shipViaRaw?: string,
): InvoiceFulfillmentMethod {
  if (/\bPICKUP\b/i.test(customerPoOrReference)) return "will_call_pickup";
  if (shipViaRaw && /TRUCK DELIVE/i.test(shipViaRaw)) return "delivery";
  return "unknown";
}

/** Derive import-domain status from parsed invoice — never sets shop readiness (spec §7). */
export function deriveImportStatus(parsed: ParsedJohnstoneInvoice): VendorInvoiceImportStatus {
  const { header, lines, parseWarnings } = parsed;
  if (parseWarnings.some((w) => w.includes("missing vendorInvoiceNumber"))) {
    return "issue";
  }

  const expectedLines = lines.filter((l) => !l.excludeFromExpectedItems);
  const hasBackorder = expectedLines.some((l) => l.quantityBackordered > 0);
  const hasPartialShip = expectedLines.some(
    (l) => l.quantityShipped < l.quantityOrdered && l.quantityBackordered === 0,
  );

  if (header.fulfillmentMethod === "will_call_pickup") {
    return "pickup_at_vendor";
  }

  if (hasBackorder || hasPartialShip) {
    return "partial";
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
  const hasBackorder = parsed.lines.some(
    (l) => !l.excludeFromExpectedItems && l.quantityBackordered > 0,
  );

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
    hasBackorder;
  return { tier, score, humanReviewRequired };
}
