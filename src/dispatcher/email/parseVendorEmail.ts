import type { EmailClassification, InboundEmailMessage, ParsedEmailContent } from "./types";

const PO_PATTERN = /\bPO[-\s]?(\d{4,8})\b/gi;
const ORD_PATTERN = /\bORD[-\s]?(\d{3,8})\b/gi;
const JOB_PATTERN = /\b(?:job|project)\s*#?\s*(\d{2,4}[-\d]*)\b/gi;

function uniqueMatches(pattern: RegExp, text: string, prefix: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(pattern)) {
    const num = match[1];
    if (num) found.add(`${prefix}${num.replace(/\s/g, "")}`);
  }
  return [...found];
}

function normalizePo(raw: string): string {
  const digits = raw.replace(/^PO[-\s]?/i, "");
  return `PO-${digits}`;
}

function classifyEmail(text: string): EmailClassification {
  const lower = text.toLowerCase();
  if (/ignore (all )?previous|system prompt|override security|mark.*complete for job/i.test(text)) {
    return "needs_dispatcher_review";
  }
  if (/unable to match|cannot identify|unknown po/i.test(lower)) {
    return "unable_to_match";
  }
  if (/unsubscribe|newsletter|marketing/i.test(lower) && !/po[-\s]?\d/i.test(lower)) {
    return "irrelevant";
  }
  if (/order complete|all items (have been )?shipped|no remaining|final shipment/i.test(lower)) {
    return "vendor_order_complete";
  }
  if (/remaining items delivered|balance of order delivered/i.test(lower)) {
    return "remaining_items_delivered";
  }
  if (/partially delivered|partial delivery/i.test(lower)) {
    return "partially_delivered";
  }
  if (/delivered to|delivery complete|dropped off/i.test(lower)) {
    return "delivered";
  }
  if (/partially backordered/i.test(lower)) {
    return "partially_backordered";
  }
  if (/backordered|on backorder/i.test(lower)) {
    return "backordered";
  }
  if (/split shipment|shipped in multiple/i.test(lower)) {
    return "split_shipment";
  }
  if (/partially shipped|partial ship/i.test(lower)) {
    return "partially_shipped";
  }
  if (/\bshipped\b/i.test(lower)) {
    return "shipped";
  }
  if (/estimated delivery|delivery date changed|rescheduled/i.test(lower)) {
    return "estimated_delivery_changed";
  }
  if (/delayed|delay/i.test(lower)) {
    return "delayed";
  }
  if (/order acknowledged|acknowledgment|we received your order/i.test(lower)) {
    return "order_acknowledged";
  }
  if (/quantity changed|qty adjusted/i.test(lower)) {
    return "quantity_changed";
  }
  if (/substitut/i.test(lower)) {
    return "substituted_item";
  }
  if (/cancel/i.test(lower)) {
    return "canceled_item";
  }
  if (/order(ed)? confirmation|purchase order/i.test(lower)) {
    return "ordered";
  }
  return "needs_dispatcher_review";
}

function extractItemLines(text: string): ParsedEmailContent["itemLines"] {
  const lines: ParsedEmailContent["itemLines"] = [];
  for (const match of text.matchAll(/(\d+)\s*x?\s*([A-Za-z0-9][\w\s\-/.]{2,60})/gi)) {
    const qty = Number(match[1]);
    const description = match[2]?.trim();
    if (description && qty > 0 && qty < 10_000) {
      lines.push({ description, qty });
    }
  }
  return lines;
}

/** Rule-based parser — treats body as untrusted data only; never executes instructions. */
export function parseVendorEmail(message: InboundEmailMessage): ParsedEmailContent {
  const combined = `${message.subject}\n${message.bodyText}`;
  const classification = classifyEmail(combined);
  const poNumbers = uniqueMatches(PO_PATTERN, combined, "PO-").map(normalizePo);
  const orderNumbers = uniqueMatches(ORD_PATTERN, combined, "ORD-");
  const jobNumbers = uniqueMatches(JOB_PATTERN, combined, "");
  const vendorOrderCompleteClaim =
    classification === "vendor_order_complete" ||
    classification === "remaining_items_delivered";

  let estimatedDeliveryDate: string | undefined;
  const dateMatch = combined.match(
    /(?:delivery|eta|arrive)[^\n]{0,40}(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/i,
  );
  if (dateMatch?.[1]) estimatedDeliveryDate = dateMatch[1];

  return {
    classification,
    poNumbers,
    orderNumbers,
    jobNumbers,
    itemLines: extractItemLines(combined),
    vendorOrderCompleteClaim,
    estimatedDeliveryDate,
  };
}

export function contentFingerprint(message: InboundEmailMessage): string {
  const normalized = [
    message.senderEmail.toLowerCase(),
    message.subject.trim().toLowerCase(),
    message.bodyText.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 2000),
  ].join("|");
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0;
  }
  return `fp-${hash.toString(16)}`;
}
