/** Deterministic gates for AI shadow parse — qty-only (no AP dollars). */

export type AiShadowGateId =
  | "json_schema_failure"
  | "missing_required_fields"
  | "qty_reconcile_failure"
  | "conflicting_identity"
  | "unknown_vendor_layout"
  | "weak_source_evidence"
  | "unclear_fulfillment"
  | "corrupt_extracted_text";

export interface AiShadowLine {
  quantityOrdered: number;
  quantityShipped: number;
  quantityBackordered: number;
  vendorProductNumber?: string;
  description?: string;
  lineType?: string;
}

export interface AiShadowHeader {
  vendorInvoiceNumber?: string;
  vendorOrderNumber?: string;
  customerPoOrReference?: string;
  fulfillmentMethod?: "delivery" | "will_call_pickup" | "unknown";
}

export interface AiShadowModelOutput {
  header: AiShadowHeader;
  lines: AiShadowLine[];
  /** Short spans copied from source that justify key fields — empty = weak evidence. */
  evidenceNotes?: string[];
}

export interface AiShadowValidation {
  ok: boolean;
  failures: AiShadowGateId[];
}

const CUSTOM_FONT_MARKERS = /\/(FontFile|ToUnicode)|cid:|\\u00[0-9a-f]{2}/i;

export function isCorruptExtractedText(text: string): boolean {
  const t = text.trim();
  if (t.length < 40) return true;
  const printable = t.replace(/[\s\w.,#/$-]/g, "");
  if (printable.length > t.length * 0.35) return true;
  if (CUSTOM_FONT_MARKERS.test(t) && !/\bINVOICE\b/i.test(t)) return true;
  return false;
}

function isFiniteNonNeg(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

export function validateAiShadowOutput(
  raw: unknown,
  options: { hasVendorPlaybook: boolean; parserFormatId?: string },
): AiShadowValidation {
  const failures: AiShadowGateId[] = [];

  if (!raw || typeof raw !== "object") {
    return { ok: false, failures: ["json_schema_failure"] };
  }
  const obj = raw as Record<string, unknown>;
  const header = obj.header;
  const lines = obj.lines;
  if (!header || typeof header !== "object" || !Array.isArray(lines)) {
    return { ok: false, failures: ["json_schema_failure"] };
  }

  const h = header as AiShadowHeader;
  if (!h.vendorInvoiceNumber?.trim() || !h.vendorOrderNumber?.trim()) {
    failures.push("missing_required_fields");
  }

  const productLines = lines.filter((ln) => {
    if (!ln || typeof ln !== "object") return false;
    const t = (ln as AiShadowLine).lineType;
    return !t || t === "product";
  }) as AiShadowLine[];

  if (productLines.length === 0) {
    failures.push("missing_required_fields");
  }

  let qtyOk = true;
  for (const ln of productLines) {
    if (
      !isFiniteNonNeg(ln.quantityOrdered) ||
      !isFiniteNonNeg(ln.quantityShipped) ||
      !isFiniteNonNeg(ln.quantityBackordered)
    ) {
      qtyOk = false;
      break;
    }
    const sum = ln.quantityShipped + ln.quantityBackordered;
    // Allow small float noise; integers expected
    if (Math.abs(sum - ln.quantityOrdered) > 0.001) {
      qtyOk = false;
      break;
    }
  }
  if (!qtyOk) failures.push("qty_reconcile_failure");

  const inv = (h.vendorInvoiceNumber ?? "").trim();
  const ord = (h.vendorOrderNumber ?? "").trim();
  if (inv && ord && inv === ord) {
    failures.push("conflicting_identity");
  }

  if (
    !options.hasVendorPlaybook &&
    options.parserFormatId !== "johnstone" &&
    options.parserFormatId !== "first_supply"
  ) {
    failures.push("unknown_vendor_layout");
  }

  const evidence = obj.evidenceNotes;
  if (
    !Array.isArray(evidence) ||
    evidence.filter((e) => typeof e === "string" && e.trim().length >= 4).length < 1
  ) {
    failures.push("weak_source_evidence");
  }

  const fm = h.fulfillmentMethod;
  if (fm !== "delivery" && fm !== "will_call_pickup" && fm !== "unknown") {
    failures.push("unclear_fulfillment");
  } else if (fm === "unknown") {
    failures.push("unclear_fulfillment");
  }

  return { ok: failures.length === 0, failures: [...new Set(failures)] };
}

/** Qty-only compare of AI product lines vs regex parse (shadow metric). */
export function qtyLinesMatchRegex(
  ai: AiShadowModelOutput,
  regexLines: Array<{
    quantityOrdered: number;
    quantityShipped: number;
    quantityBackordered: number;
    lineType?: string;
    excludeFromExpectedItems?: boolean;
  }>,
): boolean {
  const a = ai.lines.filter((l) => !l.lineType || l.lineType === "product");
  const r = regexLines.filter(
    (l) =>
      (!l.lineType || l.lineType === "product") && !l.excludeFromExpectedItems,
  );
  if (a.length !== r.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].quantityOrdered !== r[i].quantityOrdered ||
      a[i].quantityShipped !== r[i].quantityShipped ||
      a[i].quantityBackordered !== r[i].quantityBackordered
    ) {
      return false;
    }
  }
  return true;
}
