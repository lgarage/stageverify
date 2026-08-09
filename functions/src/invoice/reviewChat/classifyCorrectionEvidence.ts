/**
 * Lane C C2 — independent evidence classification for propose + apply.
 * Tightened vs raw substring: exact token / bounded match (D-38 MEDIUM fix).
 */
import { findEvidenceSpan } from "./reviewAgentContext";
import type { ReviewCorrectionSourceType } from "./correctionAllowlist";

const MIN_PROPOSED_VALUE_CHARS = 3;

function normalizeLoose(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

/** Exact token presence with non-alnum boundaries (not bare substring). */
function hasBoundedToken(haystack: string, needle: string): boolean {
  const hay = normalizeLoose(haystack);
  const n = normalizeLoose(needle);
  if (!hay || !n) return false;
  if (hay === n) return true;
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^A-Z0-9])${escaped}([^A-Z0-9]|$)`);
  return re.test(hay);
}

const POSITIVE_ASSERTION_RE =
  /\b((use|set|update|change|correct|fix|capture|apply)\b[\s\S]{0,80}?\b(to|as|=|:)|(use|set|update|capture)\b)\s*[“"']?/i;

const NEGATION_RE =
  /\b(isn'?t|is not|not|don'?t|do not|never|wrong|incorrect|missing)\b/i;

function findExactDispatcherAssertion(
  recentDispatcherTexts: string[],
  proposedValue: string,
): boolean {
  const target = normalizeLoose(proposedValue);
  for (const text of recentDispatcherTexts) {
    const raw = (text ?? "").trim();
    const t = normalizeLoose(raw);
    if (!t) continue;
    // Exact message equals the value (dispatcher typed only the value).
    if (t === target) return true;
    // Otherwise require a positive directive pattern and no negation.
    if (NEGATION_RE.test(raw)) continue;
    if (!POSITIVE_ASSERTION_RE.test(raw)) continue;
    if (!hasBoundedToken(t, proposedValue)) continue;
    const longerToken = t
      .split(/[^A-Z0-9]+/)
      .find((tok) => tok.includes(target) && tok !== target);
    if (longerToken) continue;
    return true;
  }
  return false;
}

export function classifyCorrectionEvidence(input: {
  proposedValue: string;
  combinedExtractedText: string;
  recentDispatcherTexts: string[];
}): {
  sourceType: ReviewCorrectionSourceType | null;
  evidenceCitationText?: string;
  evidenceSpanStart?: number;
  evidenceSpanEnd?: number;
} {
  const proposedValue = input.proposedValue.trim();
  if (!proposedValue || proposedValue.length < MIN_PROPOSED_VALUE_CHARS) {
    return { sourceType: null };
  }

  const span = findEvidenceSpan(input.combinedExtractedText, proposedValue);
  if (span) {
    // Require the matched span text equals proposed (case/whitespace-insensitive)
    // and is not a strict substring of a longer alnum token in the document.
    const matchedNorm = normalizeLoose(span.matched);
    const proposedNorm = normalizeLoose(proposedValue);
    if (matchedNorm === proposedNorm) {
      const leftChar =
        span.start > 0 ? input.combinedExtractedText[span.start - 1]! : "";
      const rightChar =
        span.end < input.combinedExtractedText.length
          ? input.combinedExtractedText[span.end]!
          : "";
      const leftBoundary = span.start === 0 || /[^A-Za-z0-9]/.test(leftChar);
      const rightBoundary =
        span.end >= input.combinedExtractedText.length ||
        /[^A-Za-z0-9]/.test(rightChar);
      if (leftBoundary && rightBoundary) {
        return {
          sourceType: "document_evidence",
          evidenceCitationText: span.matched,
          evidenceSpanStart: span.start,
          evidenceSpanEnd: span.end,
        };
      }
    }
  }

  // Fallback: bounded token search in extracted text (handles whitespace variants).
  if (hasBoundedToken(input.combinedExtractedText, proposedValue)) {
    const span2 = findEvidenceSpan(input.combinedExtractedText, proposedValue);
    if (span2) {
      const leftChar =
        span2.start > 0 ? input.combinedExtractedText[span2.start - 1]! : "";
      const rightChar =
        span2.end < input.combinedExtractedText.length
          ? input.combinedExtractedText[span2.end]!
          : "";
      const leftBoundary = span2.start === 0 || /[^A-Za-z0-9]/.test(leftChar);
      const rightBoundary =
        span2.end >= input.combinedExtractedText.length ||
        /[^A-Za-z0-9]/.test(rightChar);
      if (leftBoundary && rightBoundary) {
        return {
          sourceType: "document_evidence",
          evidenceCitationText: span2.matched,
          evidenceSpanStart: span2.start,
          evidenceSpanEnd: span2.end,
        };
      }
    }
  }

  if (findExactDispatcherAssertion(input.recentDispatcherTexts, proposedValue)) {
    return {
      sourceType: "dispatcher_assertion",
      evidenceCitationText: proposedValue,
    };
  }

  return { sourceType: null };
}
