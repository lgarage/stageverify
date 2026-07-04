import type {
  InvoiceLineType,
  JohnstoneInvoicePageText,
  ParsedInvoiceHeader,
  ParsedInvoiceLine,
  ParsedJohnstoneInvoice,
} from "./types";
import { inferFulfillmentMethod, inferShipCompletePolicy } from "./inferImportStatus";

function capture(label: RegExp, text: string): string | undefined {
  const m = text.match(label);
  return m?.[1]?.trim();
}

/** Label with optional `#`, optional `:`, or whitespace before value. */
function captureLabeledField(
  label: string,
  valuePattern: string,
  text: string,
): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `${escaped}(?:\\s*#)?(?:\\s*:\\s*|\\s+)(${valuePattern})`,
    "i",
  );
  return capture(re, text);
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

/** Reject label tokens mistaken for invoice numbers (e.g. "Date" from "Invoice Date:"). */
function isPlausibleInvoiceNumber(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || !/\d/.test(trimmed)) return false;
  const lower = trimmed.toLowerCase();
  const rejected = new Set(["date", "number", "no", "invoice", "order"]);
  return !rejected.has(lower);
}

function sanitizeInvoiceNumber(raw: string | undefined): string {
  const trimmed = raw?.trim() ?? "";
  return isPlausibleInvoiceNumber(trimmed) ? trimmed : "";
}

function normalizeDate(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parts = trimmed.split(/[/-]/);
  if (parts.length !== 3) return trimmed;
  let [a, b, c] = parts;
  if (c.length === 2) c = `20${c}`;
  const month = a.padStart(2, "0");
  const day = b.padStart(2, "0");
  return `${c}-${month}-${day}`;
}

function trimBuyerValue(raw: string): string {
  return raw
    .replace(/\s+Ship\s+Via\b.*$/i, "")
    .replace(/\s+Job\s+Number\b.*$/i, "")
    .trim();
}

function trimPoValue(raw: string): string {
  return raw
    .replace(/\s+Order\s+Date\b.*$/i, "")
    .replace(/\s+Buyer\b.*$/i, "")
    .replace(/\s+Ship\s+Via\b.*$/i, "")
    .replace(/\s+Invoice\s+Date\b.*$/i, "")
    .trim();
}

function isPlausiblePoValue(raw: string | undefined): boolean {
  const value = trimPoValue(raw ?? "");
  if (value.length < 2) return false;
  if (/^#+$/i.test(value)) return false;
  if (/^(?:Order Date|Buyer|Ship Via|Job Number|Invoice Date|Sales Order)$/i.test(value)) {
    return false;
  }
  return true;
}

function pickPoValue(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = trimPoValue(value ?? "");
    if (isPlausiblePoValue(trimmed)) return trimmed;
  }
  return "";
}

function parseShipViaToken(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const truck = trimmed.match(/\b(TRUCK\s+DELIVE\w*)\b/i);
  if (truck) return truck[1]!.trim();
  return trimmed;
}

/** Johnstone S/O confirmations often use label row + value row without colons. */
function parseTabularHeaderBlock(text: string): Partial<ParsedInvoiceHeader> {
  const partial: Partial<ParsedInvoiceHeader> = {};
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);

  for (let i = 0; i < lines.length - 1; i += 1) {
    const labelLine = lines[i]!;
    const valueLine = lines[i + 1]!;

    if (/^Customer\s*#\s+Sales\s+Order\s*#\s+Customer\s+P\/O/i.test(labelLine)) {
      const withDate = valueLine.match(
        /^(\d{3,10})\s+(\d{3,10})\s+(.+?)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s*$/,
      );
      if (withDate) {
        partial.customerAccountNumber = withDate[1];
        partial.vendorOrderNumber = withDate[2];
        partial.customerPoOrReference = withDate[3]!.trim();
        partial.orderDate = withDate[4]!;
        continue;
      }
      const noDate = valueLine.match(/^(\d{3,10})\s+(\d{3,10})\s+(.+)$/);
      if (noDate) {
        partial.customerAccountNumber = noDate[1];
        partial.vendorOrderNumber = noDate[2];
        partial.customerPoOrReference = noDate[3]!.trim();
      }
    }

    if (/^Buyer\s+Ship\s+Via/i.test(labelLine)) {
      const shipViaMatch = valueLine.match(
        /^(.+?)\s+(TRUCK\s+DELIVE\w*|WILL\s*[- ]?\s*CALL\b.*)$/i,
      );
      if (shipViaMatch) {
        partial.buyerName = shipViaMatch[1]!.trim();
        partial.shipViaRaw = parseShipViaToken(shipViaMatch[2]!);
      } else {
        partial.buyerName = valueLine.trim();
      }
    }

    if (/^Order\s+Date\s+Buyer/i.test(labelLine)) {
      const orderBuyer = valueLine.match(
        /^(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(.+)$/,
      );
      if (orderBuyer) {
        partial.orderDate = orderBuyer[1]!;
        partial.buyerName = orderBuyer[2]!.trim();
      }
    }
  }

  return partial;
}

/** Label on one line, value on the next — common in PDF extraction. */
function parseStackedLabelValuePairs(text: string): Partial<ParsedInvoiceHeader> {
  const partial: Partial<ParsedInvoiceHeader> = {};
  partial.customerAccountNumber = capture(
    /Customer\s*#\s*\n\s*(\d{3,10})/i,
    text,
  );
  partial.vendorOrderNumber = capture(
    /Sales\s+Order\s*#\s*\n\s*(\d{3,10})/i,
    text,
  );
  partial.vendorInvoiceNumber = capture(
    /Invoice\s*#\s*\n\s*([A-Z0-9-]+)/i,
    text,
  );
  partial.customerPoOrReference = capture(
    /(?:Customer|Cust)\s+P\/O\s*#?\s*\n\s*(.+)/i,
    text,
  );
  partial.buyerName = capture(/Buyer\s*\n\s*(.+)/i, text);
  const orderDateRaw = capture(/Order\s+Date\s*\n\s*([\d/-]+)/i, text);
  if (orderDateRaw) partial.orderDate = orderDateRaw;
  return partial;
}

function parseProductTokens(productCol: string): {
  vendorProductNumber: string;
  manufacturerOrModelNumber?: string;
  descriptionTail: string;
} {
  const tokens = productCol.trim().split(/\s+/);
  if (tokens.length === 0) return { vendorProductNumber: "", descriptionTail: "" };
  const vendorProductNumber = tokens[0] ?? "";
  const manufacturerOrModelNumber = tokens[1];
  const descriptionTail = tokens.slice(2).join(" ");
  return { vendorProductNumber, manufacturerOrModelNumber, descriptionTail };
}

function classifyLine(
  vendorProductNumber: string,
  quantityShipped: number,
  description: string,
): { lineType: InvoiceLineType; excludeFromExpectedItems: boolean } {
  const upper = vendorProductNumber.toUpperCase();
  const descLower = description.toLowerCase();
  if (/^CORE-/i.test(upper)) {
    return { lineType: "core_charge", excludeFromExpectedItems: true };
  }
  if (quantityShipped < 0 || /return from invoice/i.test(descLower)) {
    return { lineType: "return", excludeFromExpectedItems: true };
  }
  if (/^INBOUND FREIGHT$/i.test(vendorProductNumber) || /^INBOUND FREIGHT$/i.test(description.trim())) {
    return { lineType: "freight", excludeFromExpectedItems: true };
  }
  if (/^FLOOR-LOC:/i.test(description)) {
    return { lineType: "ignored", excludeFromExpectedItems: true };
  }
  return { lineType: "product", excludeFromExpectedItems: false };
}

const LINE_ROW =
  /^(\d+)\s+(\d+)\s+(-?\d+)\s+(\d+)\s+(.+?)(?:\s{2,}|$)\s*(.*)$/;

export function pageTextFingerprint(page: JohnstoneInvoicePageText): string {
  const normalized = page.extractedText.replace(/\s+/g, " ").trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0;
  }
  return `inv-fp-${hash.toString(16)}`;
}

export function parseJohnstoneInvoicePage(page: JohnstoneInvoicePageText): ParsedJohnstoneInvoice {
  const text = page.extractedText.replace(/\t/g, " ");
  const parseWarnings: string[] = [];
  const orderNotes: string[] = [];

  const tabular = parseTabularHeaderBlock(text);
  const stacked = parseStackedLabelValuePairs(text);

  const customerAccountNumber = firstNonEmpty(
    capture(/Customer\s*#\s*:\s*(\d+)/i, text),
    tabular.customerAccountNumber,
    stacked.customerAccountNumber,
    captureLabeledField("Customer", "\\d{3,10}", text),
    capture(/Customer\s+(\d{3,10})/i, text),
  );
  const vendorOrderNumber = firstNonEmpty(
    capture(/Sales Order\s*#\s*:\s*(\d+)/i, text),
    tabular.vendorOrderNumber,
    stacked.vendorOrderNumber,
    captureLabeledField("Sales Order", "\\d{3,10}", text),
    capture(/Sales Order\s+(\d{3,10})/i, text),
    capture(/S\/O\s*(?:#|Number)?\s*:?\s*(\d{3,10})/i, text),
  );
  const vendorInvoiceNumber = sanitizeInvoiceNumber(
    firstNonEmpty(
      capture(/Invoice\s*#\s*:\s*(\d+)/i, text),
      capture(/Invoice\s*#\s*:\s*([A-Z0-9-]+)/i, text),
      capture(/Invoice\s*#\s+([A-Z0-9-]+)/i, text),
      stacked.vendorInvoiceNumber,
    ),
  );
  const customerPoOrReference = pickPoValue(
    capture(/Customer P\/O\s*#\s*:\s*(.+)/i, text),
    tabular.customerPoOrReference,
    stacked.customerPoOrReference,
    capture(/(?:Customer|Cust)\s+P\/O\s*#?\s*:\s*(.+)/i, text),
    captureLabeledField("Customer P/O", ".+", text),
    captureLabeledField("Cust P/O", ".+", text),
  );
  const quoteNumber = capture(/Quote\s*(?:Number|#)\s*:\s*(\S+)/i, text)
    ?? capture(/Invoice Message[\s\S]*?(Q\d+)/i, text);
  const orderDateRaw = firstNonEmpty(
    capture(/Order Date\s*:\s*([\d/-]+)/i, text),
    tabular.orderDate,
    stacked.orderDate,
    captureLabeledField("Order Date", "[\\d/-]+", text),
  );
  const invoiceDateRaw = firstNonEmpty(
    capture(/Invoice Date\s*:\s*([\d/-]+)/i, text),
    captureLabeledField("Invoice Date", "[\\d/-]+", text),
  );
  const shipDateRaw = firstNonEmpty(
    capture(/Ship Date\s*:\s*([\d/-]+)/i, text),
    captureLabeledField("Ship Date", "[\\d/-]+", text),
  );
  const buyerRaw = firstNonEmpty(
    capture(/Buyer\s*:\s*(.+)/i, text),
    tabular.buyerName,
    stacked.buyerName,
  );
  const buyerName = buyerRaw ? trimBuyerValue(buyerRaw) : undefined;
  const shipViaRaw = firstNonEmpty(
    capture(/Ship Via\s*:\s*(.*)/i, text)?.trim(),
    tabular.shipViaRaw,
    parseShipViaToken(buyerRaw ?? ""),
  ) || undefined;
  const jobNumberRaw = capture(/Job Number\s*:\s*(.*)/i, text)?.trim();

  const vendorBranchName = capture(/Remit To\s*:\s*(.+)/i, text)
    ?? capture(/^([^\n]+Johnstone Supply)/im, text)
    ?? "Johnstone Supply";
  const vendorBranchAddress = capture(
    /Remit To\s*:\s*[^\n]+\n([^\n]+(?:SD|WI|MN|IA)\s+\d{5})/i,
    text,
  ) ?? capture(/(\d+[^\n]+(?:SD|WI|MN|IA)\s+\d{5})/i, text)
    ?? "";
  const vendorBranchPhone = capture(/please call\s*([\d-]+)/i, text)
    ?? capture(/(\d{3}-\d{3}-\d{4})/i, text)
    ?? "";

  const soldToName = capture(/Sold To\s*:\s*(.+)/i, text) ?? "";
  const shipToName = capture(/Ship To\s*:\s*(.+)/i, text) ?? soldToName;
  const shipToAddress = capture(/Ship To\s*:\s*[^\n]+\n([^\n]+)/i, text)
    ?? capture(/(\d{4}[^\n]+(?:WI|MN|IA|SD)\s+\d{5})/i, text)
    ?? "";

  if (!customerAccountNumber) parseWarnings.push("missing customerAccountNumber");
  if (!vendorOrderNumber) parseWarnings.push("missing vendorOrderNumber");
  if (!vendorInvoiceNumber) parseWarnings.push("missing vendorInvoiceNumber");
  if (!customerPoOrReference) parseWarnings.push("missing customerPoOrReference");

  const fulfillmentMethod = inferFulfillmentMethod(customerPoOrReference, shipViaRaw, text);
  const shipCompletePolicy = inferShipCompletePolicy(text);

  const header: ParsedInvoiceHeader = {
    customerAccountNumber,
    vendorOrderNumber,
    vendorInvoiceNumber,
    customerPoOrReference,
    quoteNumber: quoteNumber || undefined,
    orderDate: orderDateRaw ? normalizeDate(orderDateRaw) : "",
    invoiceDate: invoiceDateRaw ? normalizeDate(invoiceDateRaw) : "",
    shipDate: shipDateRaw ? normalizeDate(shipDateRaw) : "",
    buyerName: buyerName || undefined,
    shipViaRaw: shipViaRaw || undefined,
    jobNumberRaw: jobNumberRaw || undefined,
    vendorBranchName: vendorBranchName.trim(),
    vendorBranchAddress: vendorBranchAddress.trim(),
    vendorBranchPhone: vendorBranchPhone.trim(),
    soldToName: soldToName.trim(),
    shipToName: shipToName.trim(),
    shipToAddress: shipToAddress.trim(),
    fulfillmentMethod,
    shipCompletePolicy,
  };

  const lines: ParsedInvoiceLine[] = [];
  const lineSection = text.split(/LN\s+QNTY ORD/i)[1] ?? text;
  for (const rawLine of lineSection.split("\n")) {
    const trimmed = rawLine.trim();
    if (!trimmed || /^[-=]+$/.test(trimmed)) continue;
    const m = trimmed.match(LINE_ROW);
    if (!m) {
      if (/REPAIR/i.test(trimmed)) orderNotes.push(trimmed);
      else if (/2 DAY LEAD|NON STOCK|RESTOCK FEE/i.test(trimmed)) {
        if (lines.length > 0) {
          lines[lines.length - 1]!.filteredNotes.push(trimmed);
        }
      }
      continue;
    }
    const [, ln, ord, ship, bo, productCol, descCol] = m;
    const { vendorProductNumber, manufacturerOrModelNumber, descriptionTail } =
      parseProductTokens(productCol ?? "");
    const description = [descriptionTail, descCol?.trim()].filter(Boolean).join(" ").trim();
    const quantityShipped = Number(ship);
    const { lineType, excludeFromExpectedItems } = classifyLine(
      vendorProductNumber,
      quantityShipped,
      description,
    );
    lines.push({
      lineNumber: Number(ln),
      quantityOrdered: Number(ord),
      quantityShipped,
      quantityBackordered: Number(bo),
      vendorProductNumber,
      manufacturerOrModelNumber,
      description,
      filteredNotes: [],
      lineType,
      excludeFromExpectedItems,
    });
  }

  return { header, lines, orderNotes, parseWarnings };
}
