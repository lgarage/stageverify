import {
  inferFulfillmentMethod,
  inferShipCompletePolicy,
} from "./inferImportStatus";
import type {
  JohnstoneInvoicePageText,
  ParsedInvoiceLine,
  ParsedJohnstoneInvoice,
} from "./types";

function capture(pattern: RegExp, text: string): string | undefined {
  const match = text.match(pattern);
  return match?.[1]?.trim();
}

function normalizeShortDate(value: string): string {
  const trimmed = value.trim();
  const slash = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (slash) {
    return `20${slash[3]}-${slash[1]}-${slash[2]}`;
  }
  return trimmed;
}

function dedupeRepeatedName(line: string): string {
  const trimmed = line.trim();
  const words = trimmed.split(/\s+/);
  if (words.length < 2) return trimmed;
  const half = Math.floor(words.length / 2);
  const first = words.slice(0, half).join(" ");
  const second = words.slice(half).join(" ");
  if (first && first === second) return first;
  return trimmed;
}

function inferFirstSupplyFulfillment(shipViaRaw: string | undefined, text: string) {
  const shipVia = shipViaRaw?.trim() ?? "";
  if (/\b(?:COUNTER|EXPRESS)\s+PU\b/i.test(shipVia)) return "will_call_pickup" as const;
  if (/\bPU\b/i.test(shipVia)) return "will_call_pickup" as const;
  return inferFulfillmentMethod("", shipViaRaw, text);
}

function parseFirstSupplyLines(text: string): ParsedInvoiceLine[] {
  const tableStart = text.search(/Ln\s*#\s*\nDescription Ordered/i);
  const tableEnd = text.search(/\d+\s+Lines Total/i);
  const tableText =
    tableStart >= 0 ? text.slice(tableStart, tableEnd >= 0 ? tableEnd : undefined) : text;
  const rows = tableText.split("\n");
  const lines: ParsedInvoiceLine[] = [];
  let i = 0;

  while (i < rows.length) {
    const row = rows[i]?.trim() ?? "";
    const match = row.match(
      /^(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)$/,
    );
    if (match) {
      const descriptionParts: string[] = [];
      i += 1;
      while (i < rows.length) {
        const next = rows[i]?.trim() ?? "";
        if (!next) {
          i += 1;
          continue;
        }
        if (/^\d+\s+\S+\s+[\d.]/.test(next)) break;
        if (/Lines Total|Invoice Total|Taxes|TO VIEW ONLINE|USE THIS ENROLLMENT/i.test(next)) {
          break;
        }
        descriptionParts.push(next);
        i += 1;
      }
      lines.push({
        lineNumber: Number.parseInt(match[1], 10),
        quantityOrdered: Number.parseFloat(match[3]),
        quantityShipped: Number.parseFloat(match[5]),
        quantityBackordered: Number.parseFloat(match[4]),
        vendorProductNumber: match[2],
        description: descriptionParts.join(" ").trim() || match[2],
        unitOfMeasure: match[6],
        filteredNotes: [],
        lineType: "product",
        excludeFromExpectedItems: false,
      });
      continue;
    }
    i += 1;
  }

  return lines;
}

export function pageTextFingerprint(page: JohnstoneInvoicePageText): string {
  const invoice = capture(/Invoice\s*#\s*([\d-]+)/i, page.extractedText);
  if (invoice) return `first-supply:${invoice}`;
  return `first-supply:${page.pageId}`;
}

export function parseFirstSupplyInvoicePage(
  page: JohnstoneInvoicePageText,
): ParsedJohnstoneInvoice {
  const text = page.extractedText;
  const parseWarnings: string[] = [];

  const customerAccountNumber = capture(/Customer\s*#\s*(\d+)/i, text) ?? "";
  const vendorInvoiceNumber = capture(/Invoice\s*#\s*([\d-]+)/i, text) ?? "";
  const branchRaw = capture(/First Supply LLC[-\s]+([^\n]+)/i, text);
  const vendorBranchName = branchRaw
    ? `First Supply LLC - ${branchRaw.trim()}`
    : capture(/First Supply LLC[^\n]*/i, text) ?? "First Supply";
  const shipPoint = capture(/Ship Point\s+([^\n]+)/i, text);
  const vendorBranchAddress = shipPoint?.trim() ?? "";
  const vendorBranchPhone = capture(/\((\d{3}\)\d{3}-\d{4})\)/, text) ?? "";
  const shipViaRaw = capture(/Via\s+([^\n]+)/i, text);
  const customerPoOrReference = capture(/Customer P\/O\s+(\S+)/i, text) ?? "";
  const orderDate = normalizeShortDate(capture(/Ordered\s+(\d{2}\/\d{2}\/\d{2})/i, text) ?? "");
  const shipDate = normalizeShortDate(capture(/Shipped\s+(\d{2}\/\d{2}\/\d{2})/i, text) ?? "");
  const invoiceDate = normalizeShortDate(
    capture(/Invoiced\s+(\d{2}\/\d{2}\/\d{2})/i, text) ?? orderDate,
  );
  const shipToLine = capture(/SHIP TO:\s*\n([^\n]+)/i, text) ?? "";
  const shipToName = dedupeRepeatedName(shipToLine);
  const addressLine = capture(/SHIP TO:[\s\S]*?\n[^\n]+\n([^\n]+)/i, text) ?? "";
  const fulfillmentMethod = inferFirstSupplyFulfillment(shipViaRaw, text);
  const lines = parseFirstSupplyLines(text);

  if (!vendorInvoiceNumber) parseWarnings.push("missing vendorInvoiceNumber");
  if (!customerPoOrReference) parseWarnings.push("missing customerPoOrReference");
  if (!customerAccountNumber) parseWarnings.push("missing customerAccountNumber");
  if (lines.length === 0) parseWarnings.push("missing product lines");

  return {
    header: {
      customerAccountNumber,
      vendorOrderNumber: "",
      vendorInvoiceNumber,
      customerPoOrReference,
      orderDate,
      invoiceDate,
      shipDate,
      vendorBranchName,
      vendorBranchAddress,
      vendorBranchPhone,
      soldToName: shipToName,
      shipToName,
      shipToAddress: addressLine.trim(),
      fulfillmentMethod,
      shipCompletePolicy: inferShipCompletePolicy(text),
      shipViaRaw,
    },
    lines,
    orderNotes: [],
    parseWarnings,
  };
}
