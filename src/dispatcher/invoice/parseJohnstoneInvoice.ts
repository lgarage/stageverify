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

/** Try labeled / tabular captures; skip values rejected by sanitize (e.g. "Invoice" from "Invoice Date"). */
function extractVendorInvoiceNumber(
  text: string,
  tabular: Partial<ParsedInvoiceHeader>,
  stacked: Partial<ParsedInvoiceHeader>,
): string {
  const candidates = [
    capture(/Invoice\s*#\s*:\s*(\d+)/i, text),
    capture(/Invoice\s*#\s*:\s*([A-Z0-9-]+)/i, text),
    tabular.vendorInvoiceNumber,
    stacked.vendorInvoiceNumber,
    capture(
      /Invoice\s*#\s+(?!Invoice(?:\s+Date|\s*#))([A-Z0-9]*\d[A-Z0-9-]*)/i,
      text,
    ),
    capture(/^([A-Z]?\d{5,})\s+\d{1,2}\/\d{1,2}\/\d{2,4}/m, text),
  ];
  for (const raw of candidates) {
    const sanitized = sanitizeInvoiceNumber(raw);
    if (sanitized) return sanitized;
  }
  return "";
}

function normalizeDate(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parts = trimmed.split(/[/-]/);
  if (parts.length !== 3) return trimmed;
  const [a, b] = parts;
  let c = parts[2];
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

/** Johnstone header-grid salesman codes — never part of Customer P/O (spec §5 ignore list). */
const JOHNSTONE_SALESMAN_CODE = /\s+(?:SAD|BBTO|RML|DDJ|CM|BB)\s*$/i;

function trimPoValue(raw: string): string {
  return raw
    .replace(/\s+Order\s+Date\b.*$/i, "")
    .replace(/\s+Buyer\b.*$/i, "")
    .replace(/\s+Ship\s+Via\b.*$/i, "")
    .replace(/\s+Invoice\s+Date\b.*$/i, "")
    .replace(JOHNSTONE_SALESMAN_CODE, "")
    .trim();
}

/** When wide header grid bleeds Ship Via / Salesman into P/O, strip only with bleed evidence. */
function sanitizePoFromGridBleed(po: string, shipVia?: string): string {
  const hadSalesmanBleed = JOHNSTONE_SALESMAN_CODE.test(po);
  let value = trimPoValue(po);
  if (
    hadSalesmanBleed &&
    shipVia &&
    /^(?:PICKUP|WILL\s*[- ]?\s*CALL)$/i.test(shipVia.trim())
  ) {
    value = value.replace(/\s+PICKUP\s*$/i, "").trim();
  }
  return value;
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

/** Ship-via column from pdf.js wide header value row (before trailing salesman #). */
function parseWideRowShipVia(middle: string): string | undefined {
  const truck = middle.match(/\s+(TRUCK\s+DELIVE\w*)\s*$/i);
  if (truck) return parseShipViaToken(truck[1]!);
  const pickup = middle.match(/\s+(PICKUP)\s*$/i);
  if (pickup) return parseShipViaToken(pickup[1]!);
  const willCall = middle.match(/\s+(WILL\s*[- ]?\s*CALL\b.*)\s*$/i);
  if (willCall) return parseShipViaToken(willCall[1]!);
  const tokens = middle.trim().split(/\s+/);
  for (const wordCount of [3, 2]) {
    if (tokens.length < wordCount) continue;
    const tail = tokens.slice(-wordCount).join(" ");
    if (/^[A-Z]/.test(tail) && !/^\d+$/.test(tail)) {
      return parseShipViaToken(tail);
    }
  }
  return undefined;
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

    if (/^Invoice\s*#\s+Invoice\s+Date/i.test(labelLine)) {
      const invRow = valueLine.match(
        /^([A-Z]?\d{5,})\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/,
      );
      if (invRow) {
        partial.vendorInvoiceNumber = invRow[1];
        partial.invoiceDate = invRow[2];
      }
    }

    if (
      /^Customer\s*#\s+Order\s+Date\s+Sales\s+Order\s*#\s+Buyer\s+Customer\s+P\/O\s*#\s+Ship\s+Via/i.test(
        labelLine,
      )
    ) {
      const wide = valueLine.match(
        /^(\d{3,10})\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{3,10})\s+(.+)\s+(\d+|[A-Z]{2,5})\s*$/,
      );
      if (wide) {
        partial.customerAccountNumber = wide[1];
        partial.orderDate = wide[2];
        partial.vendorOrderNumber = wide[3];
        const middle = wide[4]!.trim();
        const shipVia = parseWideRowShipVia(middle);
        if (shipVia) {
          partial.shipViaRaw = shipVia;
          const shipViaTail = middle.match(
            new RegExp(`\\s+${shipVia.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`),
          );
          const beforeShipVia = shipViaTail
            ? middle.slice(0, shipViaTail.index).trim()
            : middle;
          const buyerPo = beforeShipVia.match(/^(\S+\s+\S+)\s+(.+)$/);
          if (buyerPo) {
            partial.buyerName = buyerPo[1]!.trim();
            partial.customerPoOrReference = buyerPo[2]!.trim();
          }
        }
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

/** Johnstone invoice PDFs with price columns: LN ord ship bo PRODUCT MFG DESC UOM list net $ext */
const LINE_ROW_EXTENDED =
  /^(\d+)\s+(\d+)\s+(-?\d+)\s+(\d+)\s+([A-Z][A-Z0-9-]+)\s+(\S+)\s+(.+)\s+(EA|PK|CS|BX|FT|LB|GAL|PR|RL|BG)\s+[\d.]+\s+[\d.]+\s+(\$[\d,.]+)\s*$/i;

const LINE_TABLE_HEADER =
  /^(LN|QNTY|ORD|SHI|B\/O|PRODUCT|NUMBER|DESCRIPTION|PRICE|UOM|LIST|NET|EXTENSION)/i;

function isLineTableNoise(trimmed: string): boolean {
  if (!trimmed || /^[-=*]+$/.test(trimmed)) return true;
  if (LINE_TABLE_HEADER.test(trimmed)) return true;
  if (/^please call/i.test(trimmed)) return true;
  if (/^\*{2,}\s*Invoice Message/i.test(trimmed)) return true;
  if (/^\.{3,}/.test(trimmed)) return true;
  if (/^\[ C O N T I N U E D \]/i.test(trimmed)) return true;
  if (/^Page \d+\/\d+/i.test(trimmed)) return true;
  if (/^(Sold To|Ship To|Customer #|Invoice #|Telephone#|Merchandise|Freight|Sub Total|TOTAL|Terms)/i.test(trimmed)) {
    return true;
  }
  return false;
}

const INVOICE_FOOTER_INLINE = /Signature\s+Proof\s+of\s+Delivery/i;

function isInvoiceFooterLine(trimmed: string): boolean {
  return (
    INVOICE_FOOTER_INLINE.test(trimmed) ||
    /^(?:Remit\s+To|Taxable\b|POS\s+Copy|Merchandise\b|Freight\b|Sub\s+Total|TOTAL\b|Suspended|Equipment|of damage|Misc Charges)/i.test(
      trimmed,
    )
  );
}

function truncateAtInvoiceFooter(text: string): string {
  const idx = text.search(INVOICE_FOOTER_INLINE);
  if (idx >= 0) return text.slice(0, idx).trim();
  return text;
}

function isDescriptionContinuation(trimmed: string): boolean {
  if (isLineTableNoise(trimmed)) return false;
  if (isInvoiceFooterLine(trimmed)) return false;
  if (LINE_ROW.test(trimmed) || LINE_ROW_EXTENDED.test(trimmed)) return false;
  if (/REPAIR/i.test(trimmed)) return false;
  if (/2 DAY LEAD|NON STOCK|RESTOCK FEE/i.test(trimmed)) return false;
  return true;
}

/** Pull invoice message / delivery instructions out of the line table — not product rows. */
function extractInvoiceMessageBlock(lineSection: string): {
  notes: string[];
  remainder: string;
} {
  const notes: string[] = [];
  const match = lineSection.match(
    /\*{2,}\s*Invoice Message[\s\S]*?(?=\n\d+\s+\d+\s+-?\d+\s+\d+\s+[A-Z])/i,
  );
  if (!match) return { notes, remainder: lineSection };

  for (const rawLine of match[0].split("\n")) {
    const trimmed = rawLine.trim();
    if (!trimmed || /^[*=-]+$/.test(trimmed)) continue;
    if (/^\*{2,}\s*Invoice Message/i.test(trimmed)) continue;
    notes.push(trimmed);
  }

  const remainder =
    lineSection.slice(0, match.index ?? 0) +
    lineSection.slice((match.index ?? 0) + match[0].length);
  return { notes, remainder };
}

function pushParsedLine(
  lines: ParsedInvoiceLine[],
  parsed: {
    lineNumber: number;
    quantityOrdered: number;
    quantityShipped: number;
    quantityBackordered: number;
    vendorProductNumber: string;
    manufacturerOrModelNumber?: string;
    description: string;
    unitOfMeasure?: string;
    lineExtension?: string;
  },
): void {
  const description = truncateAtInvoiceFooter(parsed.description);
  const { lineType, excludeFromExpectedItems } = classifyLine(
    parsed.vendorProductNumber,
    parsed.quantityShipped,
    description,
  );
  lines.push({
    ...parsed,
    description,
    filteredNotes: [],
    lineType,
    excludeFromExpectedItems,
  });
}

function parseLineTableRows(lineSection: string, orderNotes: string[]): ParsedInvoiceLine[] {
  const { notes: messageNotes, remainder } = extractInvoiceMessageBlock(lineSection);
  orderNotes.push(...messageNotes);

  const lines: ParsedInvoiceLine[] = [];
  for (const rawLine of remainder.split("\n")) {
    const trimmed = rawLine.trim();
    if (isLineTableNoise(trimmed)) continue;

    const extended = trimmed.match(LINE_ROW_EXTENDED);
    if (extended) {
      const [, ln, ord, ship, bo, product, mfg, descBody, uom, extension] = extended;
      pushParsedLine(lines, {
        lineNumber: Number(ln),
        quantityOrdered: Number(ord),
        quantityShipped: Number(ship),
        quantityBackordered: Number(bo),
        vendorProductNumber: product ?? "",
        manufacturerOrModelNumber: mfg,
        description: descBody?.trim() ?? "",
        unitOfMeasure: uom?.toUpperCase(),
        lineExtension: extension,
      });
      continue;
    }

    const simple = trimmed.match(LINE_ROW);
    if (simple) {
      const [, ln, ord, ship, bo, productCol, descCol] = simple;
      const { vendorProductNumber, manufacturerOrModelNumber, descriptionTail } =
        parseProductTokens(productCol ?? "");
      const description = [descriptionTail, descCol?.trim()].filter(Boolean).join(" ").trim();
      pushParsedLine(lines, {
        lineNumber: Number(ln),
        quantityOrdered: Number(ord),
        quantityShipped: Number(ship),
        quantityBackordered: Number(bo),
        vendorProductNumber,
        manufacturerOrModelNumber,
        description,
      });
      continue;
    }

    if (/REPAIR/i.test(trimmed)) {
      orderNotes.push(trimmed);
    } else if (/2 DAY LEAD|NON STOCK|RESTOCK FEE/i.test(trimmed)) {
      if (lines.length > 0) {
        lines[lines.length - 1]!.filteredNotes.push(trimmed);
      }
    } else if (lines.length > 0 && isDescriptionContinuation(trimmed)) {
      const prev = lines[lines.length - 1]!;
      prev.description = truncateAtInvoiceFooter(
        [prev.description, trimmed].filter(Boolean).join(" ").trim(),
      );
    }
  }

  return lines;
}

/** Extract payment/freight terms — informational for dispatcher review only. */
function extractPaymentTerms(text: string): {
  paymentTermsRaw?: string;
  codOnly?: boolean;
} {
  const starredCod = capture(/\*+\s*(COD\s+ONLY[^*\n]*)\s*\*+/i, text);
  if (starredCod) {
    const paymentTermsRaw = starredCod.replace(/\*+/g, "").trim();
    return { paymentTermsRaw, codOnly: true };
  }

  const labeledTerms = capture(/Terms\s*:\s*(.+)/i, text);
  if (labeledTerms) {
    const paymentTermsRaw = labeledTerms.trim();
    return {
      paymentTermsRaw,
      codOnly: /\bCOD\b/i.test(paymentTermsRaw) || undefined,
    };
  }

  const invoiceRowTail = capture(
    /^[A-Z]?\d[\w-]*\s+\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+[\w/&.-]+)*\s+(\S.*COD\S*)/im,
    text,
  );
  if (invoiceRowTail && /\bCOD\b/i.test(invoiceRowTail)) {
    const paymentTermsRaw = invoiceRowTail.replace(/\*+/g, "").trim();
    return {
      paymentTermsRaw,
      codOnly: /\bCOD\s+ONLY\b/i.test(paymentTermsRaw) || undefined,
    };
  }

  return {};
}

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
  const vendorInvoiceNumber = extractVendorInvoiceNumber(text, tabular, stacked);
  const customerPoRaw = pickPoValue(
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
    tabular.invoiceDate,
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
  const customerPoOrReference = sanitizePoFromGridBleed(customerPoRaw, shipViaRaw);
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
  const paymentTerms = extractPaymentTerms(text);
  if (paymentTerms.paymentTermsRaw) {
    orderNotes.push(`Payment terms: ${paymentTerms.paymentTermsRaw}`);
  }

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
    paymentTermsRaw: paymentTerms.paymentTermsRaw,
    codOnly: paymentTerms.codOnly,
  };

  const lineSection = text.split(/LN\s+QNTY ORD/i)[1] ?? text;
  const lines = parseLineTableRows(lineSection, orderNotes);

  return { header, lines, orderNotes, parseWarnings };
}
