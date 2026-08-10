/**
 * Lane C C3-D.1 — Dan-approved literal label-anchor allowlist (Johnstone-only).
 *
 * Explicit table — NOT FIELD_ALIASES / CANONICAL_HEADER_LABELS.
 * Case-fold of approved structure only; "#" is significant (never stripped).
 *
 * Future candidate (UNAPPROVED for C3-D.1 — do not enable):
 *   first_supply: customerPoOrReference "Customer P/O" (no #), vendorInvoiceNumber "Invoice #"
 */
import type { InvoiceCorrectableFieldKey } from "./correctionAllowlist";

export type LabelAnchorEntry = {
  /** Canonical display / stored literal (exact Dan-approved spelling). */
  literal: string;
  /** Stable non-slugified identity constant. */
  anchorKey: string;
};

/** Gate: only parserFormatId johnstone. vendorKey may be johnstone-supply etc. */
export const C3D1_ALLOWED_PARSER_FORMAT_ID = "johnstone" as const;

/**
 * Approved literals for C3-D.1 v1 (Dan 2026-08-10 — P2 A-only).
 * Keyed by field; enabled only when parserFormatId === johnstone.
 */
export const JOHNSTONE_LABEL_ANCHORS: Record<
  InvoiceCorrectableFieldKey,
  LabelAnchorEntry
> = {
  customerPoOrReference: {
    literal: "Customer P/O #",
    anchorKey: "johnstone_customer_po_v1",
  },
  vendorOrderNumber: {
    literal: "Sales Order #",
    anchorKey: "johnstone_sales_order_v1",
  },
  vendorInvoiceNumber: {
    literal: "Invoice #",
    anchorKey: "johnstone_invoice_num_v1",
  },
};

/** Collapse whitespace + case-fold for structure compare — never strips "#" or "/". */
export function normalizeAnchorMatchText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().toUpperCase();
}

export function getApprovedAnchorForC3D1(input: {
  parserFormatId: unknown;
  field: unknown;
}): LabelAnchorEntry | null {
  if (input.parserFormatId !== C3D1_ALLOWED_PARSER_FORMAT_ID) return null;
  if (
    input.field !== "customerPoOrReference" &&
    input.field !== "vendorOrderNumber" &&
    input.field !== "vendorInvoiceNumber"
  ) {
    return null;
  }
  return JOHNSTONE_LABEL_ANCHORS[input.field];
}

/**
 * Find case-folded exact-structure matches of an approved literal in haystack.
 * Allows flexible internal whitespace; requires every non-space char of the literal
 * (including "/" and "#") in order.
 */
export function findLiteralOccurrences(
  haystack: string,
  literal: string,
): Array<{ start: number; end: number; matched: string }> {
  const litNorm = normalizeAnchorMatchText(literal);
  if (!litNorm) return [];
  const litChars = [...litNorm];
  const out: Array<{ start: number; end: number; matched: string }> = [];
  const n = haystack.length;

  for (let i = 0; i < n; i += 1) {
    let hi = i;
    let li = 0;
    const start = i;
    while (li < litChars.length && hi < n) {
      const hCh = haystack[hi]!;
      const lCh = litChars[li]!;
      if (lCh === " ") {
        if (/\s/.test(hCh)) {
          while (hi < n && /\s/.test(haystack[hi]!)) hi += 1;
          li += 1;
          continue;
        }
        break;
      }
      if (hCh.toUpperCase() === lCh) {
        hi += 1;
        li += 1;
        continue;
      }
      if (/\s/.test(hCh) && li > 0) {
        // skip extra whitespace between literal tokens
        hi += 1;
        continue;
      }
      break;
    }
    if (li === litChars.length) {
      out.push({ start, end: hi, matched: haystack.slice(start, hi) });
      i = hi - 1;
    }
  }
  return out;
}

/** True iff line (trimmed) equals the approved literal under case-fold + space collapse. */
export function lineEqualsApprovedLiteral(
  line: string,
  literal: string,
): boolean {
  return normalizeAnchorMatchText(line) === normalizeAnchorMatchText(literal);
}
