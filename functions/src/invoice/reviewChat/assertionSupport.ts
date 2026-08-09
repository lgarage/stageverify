/**
 * Lane C C1 — deterministic assertion vs document-evidence consistency.
 * Reconciles model answers that contradict resolvable citations or extracted text.
 */
import { findEvidenceSpan } from "./reviewAgentContext";
import type {
  ReviewAgentActionType,
  ReviewChatCitation,
} from "./reviewAgentTypes";

export type AssertionSupportKind =
  | "exact"
  | "normalized"
  | "strong_substring"
  | "unsupported";

export type AssertionSupportResult = {
  assertedValue: string | null;
  support: AssertionSupportKind;
  matchedEvidenceText: string | null;
};

const PO_FIELD_CONTEXT_RE = /CUSTOMER\s*P\/?O|P\/?O\s*#|\bPO\b/i;

const UNSUPPORTED_CLAIM_RE =
  /\b(cannot find|could not find|can't find|not present|not found|cannot be verified|unsupported|do not see|don't see|doesn't appear|does not appear|no matching evidence|no evidence)\b/i;

const SUPPORTED_CLAIM_RE =
  /\b(I found|found|appears in|present in|verified in|is in the|shows in|can see|I see|confirmed in|matches the evidence)\b/i;

/** Upper case, collapse whitespace, unify P/O and #. */
export function normalizeEvidenceText(s: string): string {
  return s
    .toUpperCase()
    .replace(/P\s*\/\s*O/g, "PO")
    .replace(/#/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasPoFieldContext(text: string): boolean {
  return PO_FIELD_CONTEXT_RE.test(text);
}

function trimAssertionTail(value: string): string {
  return value
    .replace(/\.\s*check the invoice.*$/i, "")
    .replace(/\.\s*please verify.*$/i, "")
    .trim();
}

/** Extract a clear PO/reference assertion from the dispatcher message, or null. */
export function extractDispatcherAssertedValue(message: string): string | null {
  const msg = (message ?? "").trim();
  if (!msg) return null;

  const patterns: RegExp[] = [
    /I see the PO and it is\s+(.+?)(?:\.|$)/i,
    /(?:PO|P\/O|customer reference)\s*(?:#|is|:)\s*(.+?)(?:\.|$)/i,
  ];

  for (const re of patterns) {
    const m = msg.match(re);
    if (m?.[1]) {
      const trimmed = trimAssertionTail(m[1].trim());
      if (trimmed.length >= 2) return trimmed;
    }
  }
  return null;
}

function findMatchedEvidenceText(
  combinedExtractedText: string,
  assertedValue: string,
): string | null {
  const span = findEvidenceSpan(combinedExtractedText, assertedValue);
  if (span) return span.matched;

  const normAssertion = normalizeEvidenceText(assertedValue);
  const lines = combinedExtractedText.split(/\r?\n/);
  for (const line of lines) {
    if (normalizeEvidenceText(line).includes(normAssertion)) {
      return line.trim();
    }
  }
  return null;
}

function lineEqualsAssertion(line: string, normalizedAssertion: string): boolean {
  return normalizeEvidenceText(line) === normalizedAssertion;
}

function isStrongEnoughMatch(
  normalizedAssertion: string,
  matchLine: string,
): boolean {
  const hasDigitAndLetter =
    /\d/.test(normalizedAssertion) && /[A-Z]/.test(normalizedAssertion);
  if (hasDigitAndLetter) return true;
  if (normalizedAssertion.length >= 6) return true;

  if (hasPoFieldContext(matchLine)) {
    const poVal = poFieldValueOnLine(matchLine);
    if (poVal) {
      const normPoVal = normalizeEvidenceText(poVal);
      if (normPoVal === normalizedAssertion) {
        return true;
      }
      if (hasDigitAndLetter || normalizedAssertion.length >= 6) {
        if (
          normPoVal.startsWith(`${normalizedAssertion} `) ||
          normPoVal.includes(` ${normalizedAssertion} `) ||
          normPoVal.endsWith(` ${normalizedAssertion}`)
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function poFieldValueOnLine(line: string): string | null {
  const m = line.match(/(?:CUSTOMER\s*)?P\/?O\s*#?\s*(.+)/i);
  if (!m?.[1]) return null;
  return trimAssertionTail(m[1].trim());
}

function lineForMatch(
  lines: string[],
  normalizedAssertion: string,
  combinedExtractedText: string,
): string {
  for (const line of lines) {
    if (normalizeEvidenceText(line).includes(normalizedAssertion)) {
      return line;
    }
  }
  return combinedExtractedText;
}
export function classifyAssertionSupport(
  assertedValue: string,
  combinedExtractedText: string,
): AssertionSupportResult {
  const asserted = (assertedValue ?? "").trim();
  if (!asserted) {
    return { assertedValue: null, support: "unsupported", matchedEvidenceText: null };
  }

  const normalizedAssertion = normalizeEvidenceText(asserted);
  if (!normalizedAssertion) {
    return { assertedValue: asserted, support: "unsupported", matchedEvidenceText: null };
  }

  const lines = combinedExtractedText.split(/\r?\n/);

  for (const line of lines) {
    if (lineEqualsAssertion(line, normalizedAssertion)) {
      if (!isStrongEnoughMatch(normalizedAssertion, line)) {
        continue;
      }
      return {
        assertedValue: asserted,
        support: "exact",
        matchedEvidenceText: line.trim(),
      };
    }
    if (hasPoFieldContext(line)) {
      const poVal = poFieldValueOnLine(line);
      if (poVal && normalizeEvidenceText(poVal) === normalizedAssertion) {
        return {
          assertedValue: asserted,
          support: "exact",
          matchedEvidenceText: line.trim(),
        };
      }
    }
  }

  const normText = normalizeEvidenceText(combinedExtractedText);
  if (!normText.includes(normalizedAssertion)) {
    return {
      assertedValue: asserted,
      support: "unsupported",
      matchedEvidenceText: null,
    };
  }

  const matchedEvidenceText = findMatchedEvidenceText(combinedExtractedText, asserted);
  const rawMatch =
    matchedEvidenceText ??
    combinedExtractedText.slice(
      normText.indexOf(normalizedAssertion),
      normText.indexOf(normalizedAssertion) + asserted.length,
    );

  const matchLine = lineForMatch(lines, normalizedAssertion, combinedExtractedText);
  const normMatch = normalizeEvidenceText(rawMatch);

  if (normMatch === normalizedAssertion && rawMatch !== asserted) {
    const spacingOnly =
      rawMatch.replace(/\s+/g, " ").toUpperCase() ===
      asserted.replace(/\s+/g, " ").toUpperCase();
    if (spacingOnly && isStrongEnoughMatch(normalizedAssertion, matchLine)) {
      return {
        assertedValue: asserted,
        support: "normalized",
        matchedEvidenceText: rawMatch.trim(),
      };
    }
  }

  if (normMatch === normalizedAssertion && rawMatch === asserted) {
    if (isStrongEnoughMatch(normalizedAssertion, matchLine)) {
      return {
        assertedValue: asserted,
        support: "exact",
        matchedEvidenceText: rawMatch.trim(),
      };
    }
  }

  if (isStrongEnoughMatch(normalizedAssertion, matchLine)) {
    return {
      assertedValue: asserted,
      support: "strong_substring",
      matchedEvidenceText: (matchedEvidenceText ?? rawMatch).trim(),
    };
  }

  return {
    assertedValue: asserted,
    support: "unsupported",
    matchedEvidenceText: null,
  };
}

export function answerClaimsUnsupported(answerText: string): boolean {
  return UNSUPPORTED_CLAIM_RE.test(answerText ?? "");
}

export function answerClaimsSupported(answerText: string): boolean {
  const text = answerText ?? "";
  if (UNSUPPORTED_CLAIM_RE.test(text)) return false;
  return SUPPORTED_CLAIM_RE.test(text);
}

function citationContainsAssertion(
  citation: ReviewChatCitation,
  assertedValue: string,
): boolean {
  if (citation.sourceType !== "document_evidence") return false;
  const normAssertion = normalizeEvidenceText(assertedValue);
  const normCite = normalizeEvidenceText(citation.text);
  return normCite.includes(normAssertion);
}

function upsertCitation(
  citations: ReviewChatCitation[],
  citation: ReviewChatCitation,
): ReviewChatCitation[] {
  const exists = citations.some(
    (c) =>
      c.sourceType === citation.sourceType &&
      c.text === citation.text &&
      c.field === citation.field,
  );
  if (exists) return citations;
  return [...citations, citation];
}

function buildDocumentEvidenceCitation(
  combinedExtractedText: string,
  evidenceText: string,
): ReviewChatCitation {
  const span = findEvidenceSpan(combinedExtractedText, evidenceText);
  if (span) {
    return {
      sourceType: "document_evidence",
      text: span.matched,
      spanStart: span.start,
      spanEnd: span.end,
    };
  }
  return { sourceType: "document_evidence", text: evidenceText };
}

function stripUnsupportedDocumentCitations(
  citations: ReviewChatCitation[],
  assertedValue: string,
  combinedExtractedText: string,
): ReviewChatCitation[] {
  const normAssertion = normalizeEvidenceText(assertedValue);
  return citations.map((c) => {
    if (c.sourceType !== "document_evidence") return c;
    const span = findEvidenceSpan(combinedExtractedText, c.text);
    if (!span) {
      return { sourceType: "agent_interpretation", text: c.text, field: c.field };
    }
    if (normalizeEvidenceText(c.text).includes(normAssertion)) {
      return { sourceType: "agent_interpretation", text: c.text, field: c.field };
    }
    return c;
  });
}

function parserPoDiffers(
  assertedValue: string,
  parserCustomerPo?: string | null,
): boolean {
  if (parserCustomerPo == null) return false;
  const parserNorm = normalizeEvidenceText(String(parserCustomerPo));
  const assertNorm = normalizeEvidenceText(assertedValue);
  if (!parserNorm && assertNorm) return true;
  return parserNorm !== assertNorm;
}

function buildSupportedAnswer(
  assertedValue: string,
  matchedEvidenceText: string,
  parserCustomerPo?: string | null,
): string {
  const parts = [
    `I found "${assertedValue}" supported by document evidence: "${matchedEvidenceText}".`,
  ];
  if (parserPoDiffers(assertedValue, parserCustomerPo)) {
    const parserDisplay =
      parserCustomerPo != null && String(parserCustomerPo).trim()
        ? `"${String(parserCustomerPo).trim()}"`
        : "(empty)";
    parts.push(
      `The parser customerPoOrReference is ${parserDisplay}, which differs from your assertion.`,
    );
  }
  parts.push(
    "I can update the allowlisted parsed field after you confirm with Apply correction or reply “Yes, apply it.”",
  );
  return parts.join(" ");
}

function buildUnsupportedAnswer(assertedValue: string): string {
  return `I cannot find "${assertedValue}" in the document evidence. Treating that as your dispatcher assertion; I will not treat it as verified invoice text. I will not apply an unverifiable value.`;
}

/** Reconcile answer/citations when assertion support contradicts model claims. */
export function reconcileAssertionConsistency(input: {
  dispatcherMessage: string;
  answerText: string;
  citations: ReviewChatCitation[];
  actionType: ReviewAgentActionType;
  combinedExtractedText: string;
  parserCustomerPo?: string | null;
}): {
  answerText: string;
  citations: ReviewChatCitation[];
  actionType: ReviewAgentActionType;
  consistencyCorrected: boolean;
  support: AssertionSupportResult;
} {
  const assertedValue = extractDispatcherAssertedValue(input.dispatcherMessage);
  if (!assertedValue) {
    return {
      answerText: input.answerText,
      citations: input.citations,
      actionType: input.actionType,
      consistencyCorrected: false,
      support: {
        assertedValue: null,
        support: "unsupported",
        matchedEvidenceText: null,
      },
    };
  }

  const support = classifyAssertionSupport(
    assertedValue,
    input.combinedExtractedText,
  );

  const citingDocWhileUnsupported =
    input.citations.some((c) => citationContainsAssertion(c, assertedValue)) &&
    answerClaimsUnsupported(input.answerText);

  if (
    support.support !== "unsupported" &&
    (answerClaimsUnsupported(input.answerText) || citingDocWhileUnsupported)
  ) {
    const evidenceText =
      support.matchedEvidenceText ??
      findMatchedEvidenceText(input.combinedExtractedText, assertedValue) ??
      assertedValue;

    let citations = input.citations.filter(
      (c) =>
        !(
          c.sourceType === "document_evidence" &&
          answerClaimsUnsupported(input.answerText) &&
          citationContainsAssertion(c, assertedValue)
        ),
    );

    citations = upsertCitation(
      citations,
      buildDocumentEvidenceCitation(input.combinedExtractedText, evidenceText),
    );
    citations = upsertCitation(citations, {
      sourceType: "dispatcher_assertion",
      text: assertedValue,
    });
    if (input.parserCustomerPo !== undefined) {
      citations = upsertCitation(citations, {
        sourceType: "parser_value",
        text:
          input.parserCustomerPo != null && String(input.parserCustomerPo).trim()
            ? String(input.parserCustomerPo).trim()
            : "(empty)",
        field: "parsedHeader.customerPoOrReference",
      });
    }

    const actionType: ReviewAgentActionType = parserPoDiffers(
      assertedValue,
      input.parserCustomerPo,
    )
      ? "identify_mismatch"
      : "cite_evidence";

    return {
      answerText: buildSupportedAnswer(
        assertedValue,
        evidenceText,
        input.parserCustomerPo,
      ),
      citations,
      actionType,
      consistencyCorrected: true,
      support,
    };
  }

  if (support.support === "unsupported" && answerClaimsSupported(input.answerText)) {
    let citations = stripUnsupportedDocumentCitations(
      input.citations,
      assertedValue,
      input.combinedExtractedText,
    );
    citations = upsertCitation(citations, {
      sourceType: "dispatcher_assertion",
      text: assertedValue,
    });

    return {
      answerText: buildUnsupportedAnswer(assertedValue),
      citations,
      actionType: "answer",
      consistencyCorrected: true,
      support,
    };
  }

  return {
    answerText: input.answerText,
    citations: input.citations,
    actionType: input.actionType,
    consistencyCorrected: false,
    support,
  };
}
