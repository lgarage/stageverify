import { CANONICAL_HEADER_LABELS, VENDOR_COMPANY_SUFFIX } from "./canonicalInvoiceSchema";
import {
  inferFulfillmentMethod,
  inferShipCompletePolicy,
} from "./inferImportStatus";
import type {
  JohnstoneInvoicePageText,
  ParsedInvoiceHeader,
  ParsedInvoiceLine,
  ParsedJohnstoneInvoice,
} from "./types";

function capture(pattern: RegExp, text: string): string | undefined {
  const match = text.match(pattern);
  return match?.[1]?.trim();
}

function captureLabeledField(
  labels: readonly string[],
  valuePattern: string,
  text: string,
): string | undefined {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `${escaped}(?:\\s*#)?(?:\\s*:\\s*|\\s+)(${valuePattern})`,
      "im",
    );
    const value = capture(re, text);
    if (value) return value;
  }
  return undefined;
}

function isPlausibleInvoiceNumber(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || !/\d/.test(trimmed)) return false;
  const lower = trimmed.toLowerCase();
  return !["date", "number", "no", "invoice", "order"].includes(lower);
}

function sanitizeInvoiceNumber(raw: string | undefined): string {
  const trimmed = raw?.trim() ?? "";
  return isPlausibleInvoiceNumber(trimmed) ? trimmed : "";
}

function normalizeDate(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const slash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return `${year}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
  }
  return trimmed;
}

function extractVendorCompanyName(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);
  for (const line of lines) {
    if (VENDOR_COMPANY_SUFFIX.test(line) && line.length <= 80) {
      return line;
    }
  }
  return lines[0] ?? "";
}

function extractCanonicalHeader(text: string): {
  header: ParsedInvoiceHeader;
  warnings: string[];
} {
  const warnings: string[] = [];
  const valueToken = String.raw`([^\n\r]+)`;
  const dateToken = String.raw`(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})`;

  const vendorInvoiceNumber = sanitizeInvoiceNumber(
    captureLabeledField(
      CANONICAL_HEADER_LABELS.vendorInvoiceNumber,
      String.raw`([A-Z0-9][A-Z0-9-]{1,40})`,
      text,
    ) ?? capture(/Ticket\s*:\s*([A-Z0-9][A-Z0-9-]{1,40})/i, text),
  );
  const vendorOrderNumber =
    captureLabeledField(
      CANONICAL_HEADER_LABELS.vendorOrderNumber,
      String.raw`([A-Z0-9][A-Z0-9-]{1,40})`,
      text,
    ) ?? "";
  const customerPoOrReference =
    captureLabeledField(CANONICAL_HEADER_LABELS.customerPoOrReference, valueToken, text)
      ?.trim()
      .replace(/\s{2,}Account\b.*$/i, "")
      .replace(/\s{2,}Ship\b.*$/i, "")
      .trim() ?? "";
  const customerAccountNumber =
    captureLabeledField(
      CANONICAL_HEADER_LABELS.customerAccountNumber,
      String.raw`([A-Z0-9-]{2,40})`,
      text,
    ) ?? "";
  const orderDateRaw =
    captureLabeledField(CANONICAL_HEADER_LABELS.orderDate, dateToken, text) ?? "";
  const invoiceDateRaw =
    captureLabeledField(CANONICAL_HEADER_LABELS.invoiceDate, dateToken, text) ?? "";
  const shipDateRaw =
    captureLabeledField(CANONICAL_HEADER_LABELS.shipDate, dateToken, text) ?? "";
  const shipViaRaw =
    captureLabeledField(CANONICAL_HEADER_LABELS.shipViaRaw, valueToken, text) ?? "";
  const soldToName =
    captureLabeledField(CANONICAL_HEADER_LABELS.soldToName, valueToken, text)?.trim() ?? "";
  const shipToName =
    captureLabeledField(CANONICAL_HEADER_LABELS.shipToName, valueToken, text)?.trim() ?? "";
  const buyerName =
    captureLabeledField(CANONICAL_HEADER_LABELS.buyerName, valueToken, text)?.trim() ?? "";
  const vendorBranchName = extractVendorCompanyName(text);

  if (!vendorInvoiceNumber) warnings.push("missing vendorInvoiceNumber");
  if (!customerPoOrReference) warnings.push("missing customerPoOrReference");
  if (!vendorOrderNumber && !vendorInvoiceNumber) warnings.push("missing vendorOrderNumber");
  if (!customerAccountNumber) warnings.push("uncertain:customerAccountNumber");
  if (!vendorBranchName) warnings.push("uncertain:vendorBranchName");

  const fulfillmentMethod = inferFulfillmentMethod(
    customerPoOrReference,
    shipViaRaw,
    text,
  );
  const shipCompletePolicy = inferShipCompletePolicy(text);

  return {
    header: {
      customerAccountNumber,
      vendorOrderNumber,
      vendorInvoiceNumber,
      customerPoOrReference,
      orderDate: orderDateRaw ? normalizeDate(orderDateRaw) : "",
      invoiceDate: invoiceDateRaw ? normalizeDate(invoiceDateRaw) : orderDateRaw ? normalizeDate(orderDateRaw) : "",
      shipDate: shipDateRaw ? normalizeDate(shipDateRaw) : "",
      buyerName: buyerName || undefined,
      shipViaRaw: shipViaRaw || undefined,
      vendorBranchName,
      vendorBranchAddress: "",
      vendorBranchPhone: capture(/(?:Phone|Tel)\s*:\s*([+\d().\s-]{7,20})/i, text) ?? "",
      soldToName,
      shipToName,
      shipToAddress: "",
      fulfillmentMethod,
      shipCompletePolicy,
    },
    warnings,
  };
}

const MAX_GENERIC_PRODUCT_LINES = 200;

function parseGenericLineTable(text: string): ParsedInvoiceLine[] {
  const lines: ParsedInvoiceLine[] = [];
  const rows = text.split("\n");
  let inTable = false;
  let lineNumber = 0;

  for (const rawRow of rows) {
    if (lines.length >= MAX_GENERIC_PRODUCT_LINES) break;
    const row = rawRow.trim();
    if (!row) continue;

    if (/^(?:Line|Ln|Item)\b.*\b(?:Description|Item|Qty|QTY|Ord|Ship)\b/i.test(row)) {
      inTable = true;
      continue;
    }
    if (!inTable && /^(?:SKU|Item)\b.*\b(?:Description|Ord|Ship)\b/i.test(row)) {
      inTable = true;
      continue;
    }

    const skuQty = row.match(/^SKU\s+(\S+)\s+(.+?)\s+Qty\s+(\d+(?:\.\d+)?)/i);
    if (skuQty) {
      lineNumber += 1;
      const qty = Number.parseFloat(skuQty[3]);
      lines.push({
        lineNumber,
        quantityOrdered: qty,
        quantityShipped: qty,
        quantityBackordered: 0,
        vendorProductNumber: skuQty[1],
        description: skuQty[2].trim(),
        filteredNotes: [],
        lineType: "product",
        excludeFromExpectedItems: false,
      });
      continue;
    }

    const compactSku = row.match(/^(\S+)\s+(.+?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/);
    if (compactSku && inTable) {
      lineNumber += 1;
      lines.push({
        lineNumber,
        quantityOrdered: Number.parseFloat(compactSku[3]),
        quantityShipped: Number.parseFloat(compactSku[4]),
        quantityBackordered: 0,
        vendorProductNumber: compactSku[1],
        description: compactSku[2].trim(),
        filteredNotes: [],
        lineType: "product",
        excludeFromExpectedItems: false,
      });
      continue;
    }

    const fergusonStyle = row.match(/^(\d+)\s+(.+?)\s+(\d+(?:\.\d+)?)\s*$/);
    if (fergusonStyle && inTable) {
      lineNumber += 1;
      const qty = Number.parseFloat(fergusonStyle[3]);
      lines.push({
        lineNumber,
        quantityOrdered: qty,
        quantityShipped: qty,
        quantityBackordered: 0,
        vendorProductNumber: `LINE-${fergusonStyle[1]}`,
        description: fergusonStyle[2].trim(),
        filteredNotes: [],
        lineType: "product",
        excludeFromExpectedItems: false,
      });
      continue;
    }

    if (/^(?:Thank you|Subtotal|Total|Tax)/i.test(row)) {
      inTable = false;
    }
  }

  return lines;
}

export function pageTextFingerprint(page: JohnstoneInvoicePageText): string {
  const invoice = captureLabeledField(
    CANONICAL_HEADER_LABELS.vendorInvoiceNumber,
    String.raw`([A-Z0-9][A-Z0-9-]{1,40})`,
    page.extractedText,
  );
  const po = captureLabeledField(
    CANONICAL_HEADER_LABELS.customerPoOrReference,
    String.raw`([^\n\r]{1,80})`,
    page.extractedText,
  );
  if (invoice) return `canonical:${invoice}`;
  if (po) return `canonical:po:${po.trim().slice(0, 40)}`;
  return `canonical:${page.pageId}`;
}

/** Vendor-agnostic invoice extraction — searches canonical fields anywhere in text. */
export function parseCanonicalInvoicePage(
  page: JohnstoneInvoicePageText,
): ParsedJohnstoneInvoice {
  const text = page.extractedText;
  const { header, warnings } = extractCanonicalHeader(text);
  const lines = parseGenericLineTable(text);
  const parseWarnings = [...warnings];

  if (lines.length === 0) parseWarnings.push("missing product lines");
  if (lines.length >= MAX_GENERIC_PRODUCT_LINES) {
    parseWarnings.push(`truncated product lines at ${MAX_GENERIC_PRODUCT_LINES}`);
  }
  if (header.fulfillmentMethod === "unknown") {
    parseWarnings.push("uncertain:fulfillmentMethod");
  }

  return {
    header,
    lines,
    orderNotes: [],
    parseWarnings,
  };
}

export function detectVendorNameFromText(text: string): string | undefined {
  const name = extractVendorCompanyName(text);
  return name || undefined;
}
