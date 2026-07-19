import type { ParsedInvoiceHeader, ParsedJohnstoneInvoice } from "./types";

function mergeHeader(
  canonical: ParsedInvoiceHeader,
  specialized: ParsedInvoiceHeader,
): ParsedInvoiceHeader {
  const merged: Record<string, unknown> = { ...canonical };
  for (const [key, value] of Object.entries(specialized)) {
    if (typeof value === "string" && value.trim()) {
      merged[key] = value;
    } else if (typeof value === "boolean") {
      merged[key] = value;
    }
  }
  return merged as unknown as ParsedInvoiceHeader;
}

function reconcileParseWarnings(
  merged: ParsedJohnstoneInvoice,
  specialized: ParsedJohnstoneInvoice,
): string[] {
  const warnings: string[] = [];
  const productLines = merged.lines.filter(
    (l) => l.lineType === "product" && !l.excludeFromExpectedItems,
  );

  if (!merged.header.vendorInvoiceNumber) warnings.push("missing vendorInvoiceNumber");
  if (!merged.header.vendorOrderNumber && !merged.header.vendorInvoiceNumber) {
    warnings.push("missing vendorOrderNumber");
  }
  if (!merged.header.customerPoOrReference) warnings.push("missing customerPoOrReference");
  if (!merged.header.customerAccountNumber) warnings.push("uncertain:customerAccountNumber");
  if (!merged.header.vendorBranchName) warnings.push("uncertain:vendorBranchName");
  if (productLines.length === 0) warnings.push("missing product lines");
  if (merged.header.fulfillmentMethod === "unknown") {
    warnings.push("uncertain:fulfillmentMethod");
  }

  for (const w of specialized.parseWarnings) {
    if (!w.startsWith("missing") && !w.startsWith("uncertain:")) {
      warnings.push(w);
    }
  }

  return [...new Set(warnings)];
}

/** Prefer specialized parser output when present; fill gaps from canonical extraction. */
export function mergeParsedInvoices(
  canonical: ParsedJohnstoneInvoice,
  specialized: ParsedJohnstoneInvoice,
): ParsedJohnstoneInvoice {
  const specializedProductLines = specialized.lines.filter(
    (l) => l.lineType === "product" && !l.excludeFromExpectedItems,
  );
  const canonicalProductLines = canonical.lines.filter(
    (l) => l.lineType === "product" && !l.excludeFromExpectedItems,
  );

  const lines =
    specializedProductLines.length >= canonicalProductLines.length
      ? specialized.lines
      : canonicalProductLines.length > 0
        ? canonical.lines
        : specialized.lines;

  const orderNotes =
    specialized.orderNotes.length > 0 ? specialized.orderNotes : canonical.orderNotes;

  const merged: ParsedJohnstoneInvoice = {
    header: mergeHeader(canonical.header, specialized.header),
    lines,
    orderNotes,
    parseWarnings: specialized.parseWarnings,
  };
  merged.parseWarnings = reconcileParseWarnings(merged, specialized);
  return merged;
}

export function specializedParseSucceeded(
  merged: ParsedJohnstoneInvoice,
  formatId: "johnstone" | "first_supply",
): boolean {
  const productLines = merged.lines.filter(
    (l) => l.lineType === "product" && !l.excludeFromExpectedItems,
  );
  if (productLines.length === 0) return false;
  if (formatId === "first_supply") {
    return Boolean(merged.header.vendorInvoiceNumber);
  }
  return true;
}
