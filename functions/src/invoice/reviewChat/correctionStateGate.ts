/**
 * Lane C C2 — deterministic post-model gate: honor authoritative corrected header.
 * Prevents next-turn answers from treating original blank/parser state as current.
 */
import {
  headerFieldAsString,
  INVOICE_CORRECTABLE_FIELD_KEYS,
  type InvoiceCorrectableFieldKey,
} from "./correctionAllowlist";
import type { FieldCorrectionLogEntry } from "./reconcileAfterFieldCorrection";
import { findEvidenceSpan } from "./reviewAgentContext";
import type {
  ReviewAgentActionType,
  ReviewChatCitation,
} from "./reviewAgentTypes";

const FIELD_DISPLAY: Record<InvoiceCorrectableFieldKey, string> = {
  customerPoOrReference: "Customer PO",
  vendorOrderNumber: "Vendor order #",
  vendorInvoiceNumber: "Invoice #",
};

const FIELD_MENTION: Record<InvoiceCorrectableFieldKey, RegExp> = {
  customerPoOrReference:
    /\b(customer\s*p\/?o|customerPoOrReference|customer\s*po|p\/?o\s*(?:#|number|ref)?|\bPO\b)/i,
  vendorOrderNumber: /\b(vendor\s*order|order\s*#|vendorOrderNumber)\b/i,
  vendorInvoiceNumber: /\b(invoice\s*#|vendorInvoiceNumber|invoice\s*number)\b/i,
};

const MISSING_OR_BLANK_RE =
  /\b(blank|empty|missing|not\s+(?:set|present|populated)|still\s+missing|currently\s+(?:blank|empty|missing)|reports?\s+as\s+blank|is\s+blank|as\s+blank)\b/i;

const DENIES_EVIDENCE_RE =
  /\b(not present|not found|cannot find|can't find|could not find|no matching evidence|not present in the provided|is not present in the provided evidence)\b/i;

function latestCorrectionForField(
  log: FieldCorrectionLogEntry[] | undefined,
  field: InvoiceCorrectableFieldKey,
): FieldCorrectionLogEntry | null {
  if (!Array.isArray(log)) return null;
  for (let i = log.length - 1; i >= 0; i -= 1) {
    const entry = log[i];
    if (entry?.field === field && entry.newValue?.trim()) return entry;
  }
  return null;
}

function mentionsField(
  answerText: string,
  field: InvoiceCorrectableFieldKey,
): boolean {
  return FIELD_MENTION[field].test(answerText);
}

function answerContradictsCurrentValue(
  answerText: string,
  field: InvoiceCorrectableFieldKey,
  currentValue: string,
): boolean {
  if (!mentionsField(answerText, field) || !currentValue.trim()) return false;
  // Claiming the field is blank/missing while CURRENT header has a value is always wrong,
  // even if the answer mentions the value while denying it ("2205 EARLY is not present").
  if (MISSING_OR_BLANK_RE.test(answerText)) return true;
  // Denying evidence for a field that currently has an authoritative value.
  return DENIES_EVIDENCE_RE.test(answerText);
}

function buildCorrectedAnswer(
  field: InvoiceCorrectableFieldKey,
  currentValue: string,
  previousValue: string | undefined,
  evidenceText: string | null,
): { answerText: string; citations: ReviewChatCitation[] } {
  const display = FIELD_DISPLAY[field];
  const prevLabel =
    typeof previousValue === "string" && previousValue.trim()
      ? previousValue.trim()
      : "blank";
  const evidenceNote = evidenceText
    ? ` Document evidence still supports “${evidenceText}”.`
    : "";
  const answerText =
    `Current authoritative ${display} is ${currentValue}` +
    (prevLabel !== currentValue
      ? ` (original parser value was ${prevLabel}).`
      : ".") +
    ` The missing/blank warning for this field is no longer a current unresolved issue.` +
    evidenceNote;
  const citations: ReviewChatCitation[] = [
    {
      sourceType: "parser_value",
      text: currentValue,
      field: `parsedHeader.${field}`,
    },
  ];
  if (evidenceText) {
    citations.push({
      sourceType: "document_evidence",
      text: evidenceText,
      field: `parsedHeader.${field}`,
    });
  }
  return { answerText, citations };
}

/**
 * If the model describes a corrected field as still blank/missing or denies
 * previously verified evidence for the current value, rewrite deterministically.
 */
export function reconcileAuthoritativeCorrectionState(input: {
  answerText: string;
  citations: ReviewChatCitation[];
  actionType: ReviewAgentActionType;
  parsedHeader: unknown;
  fieldCorrectionLog?: FieldCorrectionLogEntry[];
  combinedExtractedText: string;
}): {
  answerText: string;
  citations: ReviewChatCitation[];
  actionType: ReviewAgentActionType;
  consistencyCorrected: boolean;
} {
  const header =
    input.parsedHeader &&
    typeof input.parsedHeader === "object" &&
    !Array.isArray(input.parsedHeader)
      ? (input.parsedHeader as Record<string, unknown>)
      : {};

  for (const field of INVOICE_CORRECTABLE_FIELD_KEYS) {
    const currentValue = headerFieldAsString(header, field);
    if (!currentValue) continue;

    const correction = latestCorrectionForField(input.fieldCorrectionLog, field);
    const contradicts = answerContradictsCurrentValue(
      input.answerText,
      field,
      currentValue,
    );
    if (!contradicts) continue;

    const span = findEvidenceSpan(input.combinedExtractedText, currentValue);
    const evidenceText = span?.matched ?? correction?.newValue ?? null;
    const rewritten = buildCorrectedAnswer(
      field,
      currentValue,
      correction?.previousValue ??
        (field === "customerPoOrReference" ? "" : undefined),
      evidenceText,
    );
    return {
      answerText: rewritten.answerText,
      citations: rewritten.citations,
      actionType: "answer",
      consistencyCorrected: true,
    };
  }

  return {
    answerText: input.answerText,
    citations: input.citations,
    actionType: input.actionType,
    consistencyCorrected: false,
  };
}
