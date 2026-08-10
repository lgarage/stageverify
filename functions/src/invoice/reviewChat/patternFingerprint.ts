/**
 * Lane C C3-D.1 — derive patternFingerprint from value span + approved anchors.
 * Pure / no I/O. Value span ≠ label; missing/ambiguous → null (skip vote).
 */
import {
  findLiteralOccurrences,
  getApprovedAnchorForC3D1,
  JOHNSTONE_LABEL_ANCHORS,
  lineEqualsApprovedLiteral,
  type LabelAnchorEntry,
} from "./labelAnchorAllowlist";
import type { InvoiceCorrectableFieldKey } from "./correctionAllowlist";

export type CaptureShapeId = "anchor_left_inline" | "anchor_above_line";

export type AnchorMatch = {
  field: InvoiceCorrectableFieldKey;
  literal: string;
  anchorKey: string;
  captureShapeId: CaptureShapeId;
  patternFingerprint: string;
  matchedLiteral: string;
  skipReason?: undefined;
};

export type AnchorMatchSkip = {
  skipReason:
    | "format_not_allowed"
    | "field_not_allowed"
    | "missing_text"
    | "missing_span"
    | "no_anchor"
    | "ambiguous_anchor"
    | "invoice_window_rejected"
    | "conflicting_anchors";
};

export type DeriveAnchorMatchResult = AnchorMatch | AnchorMatchSkip;

const INLINE_MAX_GAP_CHARS = 30;
const INVOICE_RETURN_FROM_LOOKBACK = 24;

type TextLine = { start: number; end: number; text: string };

function splitLinesWithOffsets(text: string): TextLine[] {
  const lines: TextLine[] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i += 1) {
    if (i === text.length || text[i] === "\n") {
      const raw = text.slice(start, i);
      lines.push({ start, end: i, text: raw });
      start = i + 1;
    }
  }
  return lines;
}

function lineIndexForOffset(lines: TextLine[], offset: number): number {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (offset >= line.start && offset <= line.end) return i;
  }
  return -1;
}

/** Invoice # only: reject "Return from Invoice #" style body citations. */
export function isInvoiceAnchorDisqualifiedByReturnFrom(
  haystack: string,
  matchStart: number,
): boolean {
  const from = Math.max(0, matchStart - INVOICE_RETURN_FROM_LOOKBACK);
  const prefix = haystack.slice(from, matchStart);
  return /RETURN\s+FROM\s*$/i.test(prefix);
}

export function buildPatternFingerprint(
  anchorKey: string,
  captureShapeId: CaptureShapeId,
): string {
  return `${anchorKey}__${captureShapeId}`;
}

export function deriveAnchorMatch(input: {
  parserFormatId: unknown;
  field: unknown;
  combinedExtractedText: string;
  evidenceSpanStart?: number;
  evidenceSpanEnd?: number;
}): DeriveAnchorMatchResult {
  const entry = getApprovedAnchorForC3D1({
    parserFormatId: input.parserFormatId,
    field: input.field,
  });
  if (!entry) {
    if (input.parserFormatId !== "johnstone") {
      return { skipReason: "format_not_allowed" };
    }
    return { skipReason: "field_not_allowed" };
  }
  const field = input.field as InvoiceCorrectableFieldKey;
  const text = input.combinedExtractedText ?? "";
  if (!text.trim()) return { skipReason: "missing_text" };

  const spanStart = input.evidenceSpanStart;
  const spanEnd = input.evidenceSpanEnd;
  if (
    typeof spanStart !== "number" ||
    typeof spanEnd !== "number" ||
    !Number.isFinite(spanStart) ||
    !Number.isFinite(spanEnd) ||
    spanStart < 0 ||
    spanEnd <= spanStart ||
    spanEnd > text.length
  ) {
    return { skipReason: "missing_span" };
  }

  const lines = splitLinesWithOffsets(text);
  const valueLineIdx = lineIndexForOffset(lines, spanStart);
  if (valueLineIdx < 0) return { skipReason: "missing_span" };
  const valueLine = lines[valueLineIdx]!;

  const candidates: AnchorMatch[] = [];

  // 1) anchor_left_inline — literal on same line before the value
  const inlineOccs = findLiteralOccurrences(valueLine.text, entry.literal);
  const valueCol = spanStart - valueLine.start;
  for (const occ of inlineOccs) {
    if (occ.end > valueCol) continue;
    const gap = valueCol - occ.end;
    if (gap > INLINE_MAX_GAP_CHARS) continue;
    const absStart = valueLine.start + occ.start;
    if (
      field === "vendorInvoiceNumber" &&
      isInvoiceAnchorDisqualifiedByReturnFrom(text, absStart)
    ) {
      return { skipReason: "invoice_window_rejected" };
    }
    candidates.push({
      field,
      literal: entry.literal,
      anchorKey: entry.anchorKey,
      captureShapeId: "anchor_left_inline",
      patternFingerprint: buildPatternFingerprint(
        entry.anchorKey,
        "anchor_left_inline",
      ),
      matchedLiteral: occ.matched,
    });
  }

  // 2) anchor_above_line — previous line equals literal exactly (trimmed/case-fold)
  if (valueLineIdx > 0) {
    const prev = lines[valueLineIdx - 1]!;
    if (lineEqualsApprovedLiteral(prev.text, entry.literal)) {
      const absStart = prev.start + prev.text.search(/\S/);
      const start =
        absStart >= 0 ? absStart : prev.start;
      if (
        field === "vendorInvoiceNumber" &&
        isInvoiceAnchorDisqualifiedByReturnFrom(text, start)
      ) {
        return { skipReason: "invoice_window_rejected" };
      }
      candidates.push({
        field,
        literal: entry.literal,
        anchorKey: entry.anchorKey,
        captureShapeId: "anchor_above_line",
        patternFingerprint: buildPatternFingerprint(
          entry.anchorKey,
          "anchor_above_line",
        ),
        matchedLiteral: prev.text.trim(),
      });
    }
  }

  if (candidates.length === 0) return { skipReason: "no_anchor" };

  const fingerprints = new Set(candidates.map((c) => c.patternFingerprint));
  if (fingerprints.size > 1) {
    return { skipReason: "conflicting_anchors" };
  }
  if (candidates.length > 1) {
    // Same fingerprint twice (duplicate inline hits) — still one vote shape
    return candidates[0]!;
  }
  return candidates[0]!;
}

export function describeApprovedAnchors(): Array<
  LabelAnchorEntry & { field: InvoiceCorrectableFieldKey }
> {
  return (
    Object.entries(JOHNSTONE_LABEL_ANCHORS) as Array<
      [InvoiceCorrectableFieldKey, LabelAnchorEntry]
    >
  ).map(([field, e]) => ({ field, ...e }));
}
